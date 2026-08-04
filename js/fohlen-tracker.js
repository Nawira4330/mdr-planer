// Fohlen-Tracker: zählt für ein gewähltes Pferd (mit ZZL) die Anzahl
// seiner Fohlen im sichtbaren Stammbaum der übrigen Pferde, und zeigt eine
// Top 10 der Pferde mit den meisten Fohlen. Elternschaft ist ausschließlich
// über Namen im pedigree-Feld auflösbar (kein mother_id/father_id in der
// DB) - selbes Muster wie js/zuchtbuch.js.

const FOAL_FIELDS =
  'id,name,owner,gender,breed,pedigree,breeding_allowed,coat_color,colors,notes,' +
  'tournament_potential,exterior_genetics,exterior_descriptive,temperament';

let allHorses = [];
let horseSelect;
let currentHorse = null;
let childrenByParentName = new Map();
let topBreedFilter;
let expandedIds = new Set(); // welche Top-10-Zeilen aktuell aufgeklappt sind

document.addEventListener('DOMContentLoaded', init);

async function init() {
  horseSelect = createSearchableSelect(
    document.querySelector('#horse-search'), document.querySelector('#horse-panel'),
    { onChange: onHorseChange },
  );
  document.querySelector('#owner-select').addEventListener('change', onOwnerChange);
  document.querySelector('#top-owner-select').addEventListener('change', renderTop);
  document.querySelector('#top-gender-select').addEventListener('change', renderTop);
  topBreedFilter = createBreedFilter(document.querySelector('#top-breed-drop'), { onChange: renderTop });
  wireTopToggle();
  wireTagSuggestHandlers('Fohlen-Tracker');
  await initAuthStatus();
  await loadHorses();
}

// Delegiert auf document, da die Zeilen bei jedem Neu-Rendern der Top 10
// neu erzeugt werden (Muster wie die sortierbaren Matrix-Header in
// js/verwandtschaft.js).
function wireTopToggle() {
  document.addEventListener('click', (e) => {
    const row = e.target.closest('#top-result tr.top-row[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    if (expandedIds.has(id)) expandedIds.delete(id);
    else expandedIds.add(id);
    renderTop();
  });
}

// Werte-Anzeige (GP/Ext/Ext%/Int), 1:1 aus js/zuchtbuch.js portiert, damit
// dieselben Zahlen wie im Zuchtbuch/der Datenbankübersicht erscheinen.
function computeDerived(h) {
  const gpRaw = h.tournament_potential?.['Gesamtpotenzial'];
  return {
    gp: gpRaw != null && gpRaw !== '' ? Number(gpRaw) : null,
    extAvg: averageScore(h.exterior_descriptive, scoreExteriorTerm),
    extPercent: h.exterior_genetics?.overall?.percent ?? null,
    intAvg: averageScore(h.temperament, scoreTemperamentTerm),
  };
}

// Vater = Position 0, Mutter = Position 1 in pedigreeAncestorNames (fest
// durch die Reihenfolge im Spieltext, siehe js/breeding.js/js/parser.js) -
// gleiches Muster wie js/zuchtbuch.js.
function parentNames(horse) {
  const anc = pedigreeAncestorNames(horse);
  const father = anc[0] && normalizeName(anc[0]) !== 'unbekannt' ? anc[0] : null;
  const mother = anc[1] && normalizeName(anc[1]) !== 'unbekannt' ? anc[1] : null;
  return { father, mother };
}

function zzlDisplay(breedingAllowed) {
  if (breedingAllowed === true) return 'Ja';
  if (breedingAllowed === false) return 'Nein';
  return '–';
}

async function loadHorses() {
  const errorEl = document.querySelector('#load-error');
  // Bewusst ohne ZZL-/Geschlechtsfilter beim Laden (wie js/zuchtbuch.js) -
  // die Fohlen selbst haben oft (noch) keine ZZL, sollen aber trotzdem in
  // der Fohlenliste/Top 10 auftauchen.
  const { data, error } = await supabaseClient.from('horses').select(FOAL_FIELDS).order('name');
  if (error) {
    errorEl.textContent =
      'Konnte Pferde nicht laden: ' + error.message +
      ' (falls die Seite ohne Login genutzt wird, muss dafür einmalig die Migration ' +
      '"migration_005_public_read_access.sql" im Supabase-Dashboard ausgeführt worden sein).';
    return;
  }
  allHorses = data || [];

  // Reverse-Index einmal vorab bauen: welche Pferde nennen diesen Namen
  // als Vater/Mutter (Muster wie js/zuchtbuch.js findRelatives).
  childrenByParentName = new Map();
  for (const h of allHorses) {
    const { father, mother } = parentNames(h);
    for (const parentName of [father, mother]) {
      if (!parentName) continue;
      const key = normalizeName(parentName);
      if (!childrenByParentName.has(key)) childrenByParentName.set(key, []);
      childrenByParentName.get(key).push(h);
    }
  }

  const owners = [...new Set(allHorses.map((h) => h.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  for (const selector of ['#owner-select', '#top-owner-select']) {
    const sel = document.querySelector(selector);
    sel.innerHTML = '<option value="">Alle</option>';
    for (const owner of owners) {
      const opt = document.createElement('option');
      opt.value = owner;
      opt.textContent = owner;
      sel.appendChild(opt);
    }
  }

  topBreedFilter.setHorses(allHorses);
  populateHorseSelect();
  renderTop();
}

// Suchfeld zeigt nur Pferde MIT ZZL (breeding_allowed === true), wie vom
// Nutzer gewünscht - unabhängig davon zählen deren Fohlen selbst
// natürlich unabhängig von ihrer eigenen ZZL.
function populateHorseSelect() {
  const owner = document.querySelector('#owner-select').value;
  const filtered = allHorses.filter((h) => h.breeding_allowed === true && (!owner || h.owner === owner));
  horseSelect.setItems(filtered.map((h) => ({ id: h.id, label: h.name || '(ohne Name)' })));
}

function onOwnerChange() {
  populateHorseSelect();
  horseSelect.clear(); // löst onHorseChange('') aus
}

function onHorseChange(id) {
  currentHorse = allHorses.find((h) => h.id === id) || null;
  renderFoalResult();
}

function renderFoalResult() {
  const container = document.querySelector('#foal-result');
  if (!currentHorse) {
    container.innerHTML = '<p class="muted small">Bitte zuerst ein Pferd auswählen.</p>';
    return;
  }

  const foals = childrenByParentName.get(normalizeName(currentHorse.name)) || [];
  let html = `<div class="group-heading">${foals.length} Fohlen gefunden</div>`;
  html += `<p class="small">${tagSuggestButtonHtml(currentHorse.id, currentHorse.owner)}</p>`;
  if (!foals.length) {
    html += '<p class="small muted">Keine Fohlen im sichtbaren Stammbaum der übrigen Pferde gefunden.</p>';
    container.innerHTML = html;
    return;
  }

  html += `<div class="table-wrap"><table>
    <thead><tr>
      <th>Name</th>
      <th>Geschlecht</th>
      <th>Rasse</th>
      <th>Besitzer</th>
      <th>ZZL</th>
    </tr></thead>
    <tbody>${foals.map(foalRowHtml).join('')}</tbody>
  </table></div>`;
  container.innerHTML = html;
}

function foalRowHtml(h) {
  return `<tr>
    <td data-label="Name">${escapeHtml(h.name || '(ohne Name)')}</td>
    <td data-label="Geschlecht">${escapeHtml(h.gender || '–')}</td>
    <td data-label="Rasse">${escapeHtml(h.breed || '–')}</td>
    <td data-label="Besitzer">${h.owner ? escapeHtml(h.owner) : '–'}</td>
    <td data-label="ZZL">${zzlDisplay(h.breeding_allowed)}</td>
  </tr>`;
}

function renderTop() {
  const container = document.querySelector('#top-result');
  const owner = document.querySelector('#top-owner-select').value;
  const gender = document.querySelector('#top-gender-select').value;

  const candidates = allHorses.filter((h) => {
    if (owner && h.owner !== owner) return false;
    if (gender && h.gender !== gender) return false;
    if (!topBreedFilter.matches(h)) return false;
    return true;
  });

  const ranked = candidates
    .map((h) => ({ horse: h, count: (childrenByParentName.get(normalizeName(h.name)) || []).length }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || (a.horse.name || '').localeCompare(b.horse.name || '', 'de'))
    .slice(0, 10);

  if (!ranked.length) {
    container.innerHTML = '<p class="muted small">Keine Pferde mit Fohlen für diese Auswahl gefunden - Filter anpassen.</p>';
    return;
  }

  let html = `<div class="table-wrap"><table>
    <thead><tr>
      <th></th>
      <th>Rang</th>
      <th>Name</th>
      <th>Geschlecht</th>
      <th>Rasse</th>
      <th>Besitzer</th>
      <th>ZZL</th>
      <th>Fohlen</th>
    </tr></thead>
    <tbody>${ranked.map((r, i) => topRowHtml(r, i + 1)).join('')}</tbody>
  </table></div>`;
  container.innerHTML = html;
}

const TOP_ROW_COLSPAN = 8;

function topRowHtml(r, rank) {
  const h = r.horse;
  const expanded = expandedIds.has(h.id);
  let html = `<tr class="top-row" data-id="${escapeHtml(h.id)}" style="cursor:pointer;">
    <td>${expanded ? '▾' : '▸'}</td>
    <td data-label="Rang">${rank}</td>
    <td data-label="Name">${escapeHtml(h.name || '(ohne Name)')}</td>
    <td data-label="Geschlecht">${escapeHtml(h.gender || '–')}</td>
    <td data-label="Rasse">${escapeHtml(h.breed || '–')}</td>
    <td data-label="Besitzer">${h.owner ? escapeHtml(h.owner) : '–'}</td>
    <td data-label="ZZL">${zzlDisplay(h.breeding_allowed)}</td>
    <td data-label="Fohlen">${r.count}</td>
  </tr>`;
  if (expanded) {
    const foals = childrenByParentName.get(normalizeName(h.name)) || [];
    html += `<tr class="foal-subrow"><td colspan="${TOP_ROW_COLSPAN}">${foalSubTableHtml(foals)}</td></tr>`;
  }
  return html;
}

function foalSubTableHtml(foals) {
  return `<div class="table-wrap"><table>
    <thead><tr>
      <th>Name</th>
      <th>Rasse</th>
      <th>Geschlecht</th>
      <th>GP</th>
      <th>Ext</th>
      <th>Ext%</th>
      <th>Int</th>
      <th>ZZL</th>
      <th>Farbe</th>
      <th>Besitzer</th>
    </tr></thead>
    <tbody>${foals.map(foalSubRowHtml).join('')}</tbody>
  </table></div>`;
}

function foalSubRowHtml(h) {
  const d = computeDerived(h);
  return `<tr>
    <td data-label="Name">${escapeHtml(h.name || '(ohne Name)')}</td>
    <td data-label="Rasse">${escapeHtml(h.breed || '–')}</td>
    <td data-label="Geschlecht">${escapeHtml(h.gender || '–')}</td>
    <td data-label="GP">${d.gp != null ? Math.round(d.gp) : '–'}</td>
    <td data-label="Ext">${d.extAvg != null ? d.extAvg.toFixed(2) : '–'}</td>
    <td data-label="Ext%">${d.extPercent != null ? d.extPercent.toFixed(2) : '–'}</td>
    <td data-label="Int">${d.intAvg != null ? d.intAvg.toFixed(2) : '–'}</td>
    <td data-label="ZZL">${zzlDisplay(h.breeding_allowed)}</td>
    <td data-label="Farbe">${escapeHtml(h.coat_color || '–')}</td>
    <td data-label="Besitzer">${h.owner ? escapeHtml(h.owner) : '–'}</td>
  </tr>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
