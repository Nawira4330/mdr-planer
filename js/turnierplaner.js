const TOURNAMENT_SELECT_FIELDS =
  'id,name,owner,gender,coat_color,breeding_allowed,disciplines,traits,tournament_potential,exterior_genetics,exterior_descriptive,temperament,genetic_diseases,breed,purebred_pct';

let horses = [];
let currentMode = 'db';
let currentProfile = null;
let currentSort = { field: 'category', dir: 'asc' };
let horseSelect;
let breedFilter;
let tagFilter;
// null = keine Präferenz (Gast/kein Setting) -> APH-Standard in
// createBreedFilter; [] = "Alle Rassen" bewusst gewählt; [...] = konkrete
// Rassen - siehe loadDefaultBreeds/user_settings.preferred_breeds.
let defaultBreeds = null;

const TOURNAMENT_SORT_FIELDS = [
  { field: 'category', label: 'Kategorie' },
  { field: 'name', label: 'Disziplin' },
  { field: 'wert', label: 'Wert' },
  { field: 'interieur', label: 'Interieur' },
  { field: 'lk', label: 'LK' },
];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  wireModeTabs();
  wireSortableHeaders();
  wireMobileSort('tournament-mobile-sort-select', (field, dir) => { currentSort = { field, dir }; renderProfile(); });
  horseSelect = createSearchableSelect(
    document.querySelector('#horse-search'), document.querySelector('#horse-panel'),
    { onChange: onHorseSelect },
  );
  breedFilter = createBreedFilter(document.querySelector('#breed-drop'), { onChange: populateHorseSelect, initialSelection: () => defaultBreeds });
  tagFilter = createTagFilter(document.querySelector('#tag-drop'), { onChange: populateHorseSelect });
  document.querySelector('#owner-select').addEventListener('change', onOwnerChange);
  document.querySelector('#parse-btn').addEventListener('click', onParse);
  await initAuthStatus();
  await loadDefaultBreeds();
  document.querySelector('#horse-search').addEventListener('input', onFirstSearchInput, { once: true });
}

// Übernimmt dieselbe Rassen-Präferenz wie die Einstellungen in der
// MDR-Datenbank (user_settings.preferred_breeds), damit der Rassen-Filter
// hier nicht mehr fest auf APH steht. Kein eigener gespeicherter Zustand
// hier - reine Übernahme.
async function loadDefaultBreeds() {
  if (!isLoggedIn()) { defaultBreeds = null; return; }
  const { data, error } = await supabaseClient
    .from('user_settings')
    .select('preferred_breeds')
    .eq('user_id', currentAuthSession.user.id)
    .maybeSingle();
  defaultBreeds = (!error && data) ? (data.preferred_breeds || []) : null;
}

// Lädt die (inzwischen recht große, >1200 Zeilen) Pferdeliste bewusst NICHT
// beim Seitenaufruf, sondern erst bei der ersten Eingabe ins Namens-
// Suchfeld (Nutzerwunsch 2026-09-05, wegen Supabase-Egress-Kontingent) -
// Besitzer-/Rasse-/Schlagwort-Filter bleiben bis dahin leer/wirkungslos,
// das ist so in Kauf genommen.
let horsesLoadPromise = null;
function ensureHorsesLoaded() {
  if (!horsesLoadPromise) horsesLoadPromise = loadHorses();
  return horsesLoadPromise;
}
async function onFirstSearchInput() {
  await ensureHorsesLoaded();
  document.querySelector('#horse-search').dispatchEvent(new Event('input', { bubbles: true }));
}

async function loadHorses() {
  const errorEl = document.querySelector('#load-error');
  const { data, error } = await fetchAllRows((from, to) =>
    supabaseClient.from('horses').select(TOURNAMENT_SELECT_FIELDS).order('name').range(from, to));
  if (error) {
    errorEl.textContent =
      'Konnte Pferde nicht laden: ' + error.message +
      ' (falls die Seite ohne Login genutzt wird, muss dafür einmalig die Migration ' +
      '"migration_005_public_read_access.sql" im Supabase-Dashboard ausgeführt worden sein).';
    return;
  }
  // Nur Pferde ohne ZZL (Zuchtzulassung/Leistungsprüfung) - der
  // Turnierplaner soll ja gerade helfen abzuschätzen, ob ein Pferd seine
  // Leistungsprüfung bestehen könnte, das ist für bereits zugelassene
  // Pferde nicht mehr relevant.
  horses = (data || []).filter((h) => h.breeding_allowed !== true);

  const ownerSel = document.querySelector('#owner-select');
  const owners = [...new Set(horses.map((h) => h.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  ownerSel.innerHTML = '<option value="">Alle</option>';
  for (const owner of owners) {
    const opt = document.createElement('option');
    opt.value = owner;
    opt.textContent = owner;
    ownerSel.appendChild(opt);
  }

  breedFilter.setHorses(horses);
  populateHorseSelect();
}

function populateHorseSelect() {
  const owner = document.querySelector('#owner-select').value;
  const filtered = horses.filter((h) => (!owner || h.owner === owner) && breedFilter.matches(h) && tagFilter.matches(h));
  horseSelect.setItems(filtered.map((h) => ({ id: h.id, label: h.name || '(ohne Name)' })));
  document.querySelector('#horse-select-empty-hint').hidden = horses.length > 0;
}

function onOwnerChange() {
  populateHorseSelect();
  horseSelect.clear(); // löst onHorseSelect('') aus und rendert damit die geleerte Auswahl
}

function wireModeTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentMode = btn.dataset.mode;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelector('#mode-db').hidden = currentMode !== 'db';
      document.querySelector('#mode-freetext').hidden = currentMode !== 'freetext';
      currentProfile = null;
      document.querySelector('#profile-result').innerHTML = '';
    });
  });
}

function onHorseSelect(id) {
  const horse = horses.find((h) => h.id === id) || null;
  currentProfile = horse;
  renderProfile();
}

function onParse() {
  const text = document.querySelector('#raw-text').value;
  const statusEl = document.querySelector('#parse-status');
  if (!text.trim()) {
    statusEl.textContent = 'Bitte zuerst Text einfügen.';
    return;
  }
  currentProfile = parseHorseText(text);
  statusEl.textContent = 'Erkannt: ' + (currentProfile.name || 'kein Name gefunden');
  renderProfile();
}

function renderProfile() {
  const container = document.querySelector('#profile-result');
  const wrap = document.querySelector('#tournament-wrap');
  const tbody = document.querySelector('#tournament-table tbody');
  const mobileSort = document.querySelector('#tournament-mobile-sort');

  if (!currentProfile) {
    container.innerHTML = '';
    wrap.hidden = true;
    mobileSort.innerHTML = '';
    return;
  }

  const values = computeTournamentValues(currentProfile);
  const lp = checkLP(currentProfile);

  const gp = currentProfile.tournament_potential?.['Gesamtpotenzial'];
  const extAvg = averageScore(currentProfile.exterior_descriptive, scoreExteriorTerm);
  const extPct = currentProfile.exterior_genetics?.overall?.percent;
  const intAvg = averageScore(currentProfile.temperament, scoreTemperamentTerm);

  let html = `<div class="result-card">`;
  html += `<h2>${escapeHtml(currentProfile.name || '(ohne Name)')}</h2>`;
  html += `<p class="small muted">`;
  html += `GP: <strong>${gp != null ? gp : '–'}</strong>`;
  html += ` &nbsp;·&nbsp; Ext: <strong>${extAvg != null ? extAvg.toFixed(2) : '–'}</strong>`;
  html += ` &nbsp;·&nbsp; Ext%: <strong>${extPct != null ? extPct + '%' : '–'}</strong>`;
  html += ` &nbsp;·&nbsp; Int: <strong>${intAvg != null ? intAvg.toFixed(2) : '–'}</strong>`;
  html += `</p>`;
  html += lpResultHtml(lp);
  html += '</div>';
  container.innerHTML = html;

  if (!values.length) {
    wrap.hidden = true;
    mobileSort.innerHTML = '';
    return;
  }

  wrap.hidden = false;
  mobileSort.innerHTML = mobileSortSelectHtml('tournament-mobile-sort-select', TOURNAMENT_SORT_FIELDS, currentSort);
  tbody.innerHTML = applySort(values).map(rowHtml).join('');
}

function lpResultHtml(lp) {
  let html = '<div style="margin-top:0.5rem;">';
  if (lp.possible === true) {
    html += '<div class="pill yes">Leistungsprüfung (LP): voraussichtlich bestanden</div>';
  } else if (lp.possible === false) {
    html += '<div class="pill no">Leistungsprüfung (LP): voraussichtlich NICHT bestanden</div>';
  } else {
    html += '<div class="pill">Leistungsprüfung (LP): nicht sicher prüfbar (zu wenig Daten)</div>';
  }
  if (lp.reasons.length) {
    html += '<ul class="small">' + lp.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('') + '</ul>';
  }
  if (lp.warnings.length) {
    html += '<p class="small muted">' + lp.warnings.map(escapeHtml).join('<br>') + '</p>';
  }
  html += '</div>';
  return html;
}

function rowHtml(v) {
  // data-label wird auf schmalen Bildschirmen als Spaltenbeschriftung vor
  // jedem Wert eingeblendet (siehe #tournament-table in css/style.css) -
  // die Tabelle wird dort zu einer Kartenliste statt seitlich zu scrollen.
  return `<tr>
    <td data-label="Kategorie">${escapeHtml(v.category)}</td>
    <td data-label="Disziplin">${escapeHtml(v.name)}</td>
    <td data-label="Wert">${v.wert != null ? v.wert : '–'}</td>
    <td data-label="Interieur">${v.interieur != null ? v.interieur.toFixed(2) : '–'}</td>
    <td data-label="LK">${v.complete && v.lk != null ? 'LK' + v.lk : '–'}</td>
  </tr>`;
}

function sortValue(row, field) {
  switch (field) {
    case 'category': return (row.category || '').toLowerCase();
    case 'name': return (row.name || '').toLowerCase();
    case 'wert': return row.wert;
    case 'interieur': return row.interieur;
    case 'lk': return row.complete ? row.lk : null;
    default: return null;
  }
}

// Fehlende Werte (null) landen unabhängig von der Richtung immer am Ende,
// gleiches Muster wie in js/list.js (MDR-Datenbank).
function applySort(rows) {
  const { field, dir } = currentSort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, field);
    const vb = sortValue(b, field);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string') return va.localeCompare(vb, 'de') * mult;
    return (va - vb) * mult;
  });
}

function wireSortableHeaders() {
  document.querySelectorAll('#tournament-table th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (currentSort.field === field) {
        currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort = { field, dir: 'asc' };
      }
      renderProfile();
    });
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
