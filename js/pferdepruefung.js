// Pferdeprüfung: kombiniert für EIN datenbankfremdes Pferd (nur Freitext,
// keine Datenbank-Auswahl - dafür gibt es bereits Turnierplaner/Zuchtbuch/
// Verwandtschaftsmatrix einzeln) die Turnierwerte + LP-Prognose (1:1 aus
// js/turnierplaner.js portiert) und die Verwandtschaft zum gespeicherten
// Bestand (1:1 aus der Freitext-Einzelnachschlage in
// js/verwandtschaft.js portiert) - beide Male auf Basis desselben
// parseHorseText()-Aufrufs, damit derselbe kopierte Text nur einmal
// eingefügt werden muss. Benötigt js/parser.js, js/breeding.js,
// js/tournamentScoring.js - muss also nach diesen Scripts eingebunden
// werden.

const RELATION_FIELDS =
  'id,name,owner,breed,pedigree,tags,tournament_potential,exterior_genetics,exterior_descriptive,temperament';

let allHorses = [];
let currentProfile = null;
let tournamentSort = { field: 'category', dir: 'asc' };
let relatedSort = { field: 'name', dir: 'asc' };

const TOURNAMENT_SORT_FIELDS = [
  { field: 'category', label: 'Kategorie' },
  { field: 'name', label: 'Disziplin' },
  { field: 'wert', label: 'Wert' },
  { field: 'interieur', label: 'Interieur' },
  { field: 'lk', label: 'LK' },
];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  document.querySelector('#tag-legend').innerHTML = tagLegendHtml();
  wireSortableHeaders();
  wireMobileSort('tournament-mobile-sort-select', (field, dir) => { tournamentSort = { field, dir }; renderProfile(); });
  wireRelatedSortableHeaders();
  document.querySelector('#parse-btn').addEventListener('click', onParse);
  await initAuthStatus();
}

// Lädt die (inzwischen recht große, >1200 Zeilen) Pferdeliste bewusst NICHT
// beim Seitenaufruf, sondern erst nach dem ersten "Auslesen" (Nutzerwunsch
// 2026-09-05, wegen Supabase-Egress-Kontingent, hier übertragen auf den
// einzig vorhandenen Auslöser dieser Seite - es gibt kein Namens-Suchfeld,
// da ausschließlich datenbankfremde Pferde geprüft werden).
let horsesLoadPromise = null;
function ensureHorsesLoaded() {
  if (!horsesLoadPromise) horsesLoadPromise = loadHorses();
  return horsesLoadPromise;
}

async function loadHorses() {
  const errorEl = document.querySelector('#load-error');
  const { data, error } = await fetchAllRows((from, to) =>
    supabaseClient.from('horses').select(RELATION_FIELDS).order('name').range(from, to));
  if (error) {
    errorEl.textContent =
      'Konnte Pferde für den Verwandtschafts-Abgleich nicht laden: ' + error.message +
      ' (falls die Seite ohne Login genutzt wird, muss dafür einmalig die Migration ' +
      '"migration_005_public_read_access.sql" im Supabase-Dashboard ausgeführt worden sein).';
    return;
  }
  allHorses = data || [];
}

async function onParse() {
  const text = document.querySelector('#raw-text').value;
  const statusEl = document.querySelector('#parse-status');
  if (!text.trim()) {
    statusEl.textContent = 'Bitte zuerst Text einfügen.';
    return;
  }
  currentProfile = parseHorseText(text);
  const name = currentProfile.name || 'kein Name gefunden';
  statusEl.textContent = 'Erkannt: ' + name + ' – lade Verwandtschafts-Abgleich…';
  renderProfile();
  document.querySelector('#related-result').innerHTML = '<p class="muted small">Lädt Verwandtschafts-Abgleich…</p>';
  await ensureHorsesLoaded();
  statusEl.textContent = 'Erkannt: ' + name;
  renderRelated();
}

// --- Turnierwerte + LP-Prognose (1:1 aus js/turnierplaner.js) ---

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
  mobileSort.innerHTML = mobileSortSelectHtml('tournament-mobile-sort-select', TOURNAMENT_SORT_FIELDS, tournamentSort);
  tbody.innerHTML = applyTournamentSort(values).map(tournamentRowHtml).join('');
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

function tournamentRowHtml(v) {
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

function tournamentSortValue(row, field) {
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
// gleiches Muster wie in js/turnierplaner.js.
function applyTournamentSort(rows) {
  const { field, dir } = tournamentSort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = tournamentSortValue(a, field);
    const vb = tournamentSortValue(b, field);
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
      if (tournamentSort.field === field) {
        tournamentSort.dir = tournamentSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        tournamentSort = { field, dir: 'asc' };
      }
      renderProfile();
    });
  });
}

// --- Verwandtschaft zum Bestand (1:1 aus der Freitext-Einzelnachschlage
// in js/verwandtschaft.js) ---

// "Nähe" einer Übereinstimmung: je kleiner, desto enger verwandt. Ist z.B.
// die Mutter (oder Tochter) eines Pferds gefunden, teilen sich fast
// zwangsläufig auch viele weitere Vorfahren dahinter - deshalb wird pro
// verwandtem Pferd nur die EINE engste Übereinstimmung angezeigt statt
// aller.
const POSITION_RANK = { 'Pferd selbst': 0, 'Elternteil': 1, 'Großeltern': 2, 'Urgroßeltern': 3 };
function relationCloseness(m) {
  return POSITION_RANK[m.positionA] + POSITION_RANK[m.positionB];
}
function closestRelation(matches) {
  return matches.reduce((best, m) => (relationCloseness(m) < relationCloseness(best) ? m : best));
}

function applySortGeneric(rows, sort, getValue) {
  const mult = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = getValue(a, sort.field), vb = getValue(b, sort.field);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string') return va.localeCompare(vb, 'de') * mult;
    return (va - vb) * mult;
  });
}

function relatedSortValue(row, field) {
  switch (field) {
    case 'name': return (row.horse.name || '').toLowerCase();
    case 'owner': return (row.horse.owner || '').toLowerCase();
    case 'ancestor': return (row.closest.name || '').toLowerCase();
    case 'inbreeding': return row.inbreeding ? 1 : 0;
    case 'tag': return tagSortValue(row.horse.tags);
    default: return null;
  }
}

function sortArrowGeneric(sort, field) {
  return sort.field === field ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
}

function wireRelatedSortableHeaders() {
  document.addEventListener('click', (e) => {
    const th = e.target.closest('#related-table th[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    if (relatedSort.field === field) relatedSort.dir = relatedSort.dir === 'asc' ? 'desc' : 'asc';
    else relatedSort = { field, dir: field === 'inbreeding' ? 'desc' : 'asc' };
    renderRelated();
  });
}

function renderRelated() {
  const container = document.querySelector('#related-result');
  if (!currentProfile) {
    container.innerHTML = '';
    return;
  }

  // Zusätzlich zur reinen Verwandtschaft (findRelations) wird je Pferd
  // geprüft, ob der gemeinsame Vorfahre bei Verpaarung auch tatsächlich im
  // sichtbaren Stammbaum eines gemeinsamen Fohlens doppelt auftauchen
  // würde (findSharedNames) - dieselbe Unterscheidung wie in der
  // Verwandtschaftsmatrix.
  const related = allHorses
    .map((h) => {
      const matches = findRelations(currentProfile, h);
      if (!matches.length) return null;
      const inbreeding = findSharedNames(currentProfile, h).length > 0;
      return { horse: h, closest: closestRelation(matches), inbreeding };
    })
    .filter(Boolean)
    .sort((a, b) => relationCloseness(a.closest) - relationCloseness(b.closest) || (a.horse.name || '').localeCompare(b.horse.name || '', 'de'));
  const inbreedingCount = related.filter((r) => r.inbreeding).length;

  const heading = `${related.length} verwandte Pferde (${inbreedingCount} davon mit Inzucht-Gefahr bei Verpaarung) im Bestand gefunden`;
  let html = `<div class="group-heading">${heading}</div>`;

  // Ø-Verwandtschaftsgrad gegen ALLE Pferde DERSELBEN RASSE im Bestand -
  // EIN einziger, zusammenfassender Wert (siehe estimateBreedRelatedness in
  // js/breeding.js), nicht je einzelnem verwandten Pferd.
  const breedCoiPct = estimateBreedRelatedness(currentProfile, allHorses);
  if (breedCoiPct != null) {
    html += `<p class="small">Ø Verwandtschaftsgrad zu allen ${escapeHtml(currentProfile.breed || 'derselben Rasse')}-Pferden im Bestand: <strong>${breedCoiPct.toFixed(1)}%</strong></p>`;
  }

  if (!related.length) {
    html += '<p class="small muted">Keine Verwandtschaft im sichtbaren Stammbaum gefunden.</p>';
    container.innerHTML = html;
    return;
  }

  const sortedRelated = applySortGeneric(related, relatedSort, relatedSortValue);
  const th = (field, label) => `<th data-sort="${field}">${label}${sortArrowGeneric(relatedSort, field)}</th>`;
  html += `<div class="table-wrap"><table id="related-table">
    <thead><tr>
      ${th('name', 'Pferd')}
      ${th('owner', 'Besitzer')}
      ${th('ancestor', 'Nächster gemeinsamer Vorfahre')}
      ${th('inbreeding', 'Bei Verpaarung')}
      ${th('tag', 'Schlagwort')}
    </tr></thead>
    <tbody>${sortedRelated.map(relatedRowHtml).join('')}</tbody>
  </table></div>`;
  container.innerHTML = html;
}

function relatedRowHtml(r) {
  const targetName = escapeHtml(currentProfile.name || '(ohne Name)');
  const otherName = escapeHtml(r.horse.name || '(ohne Name)');
  const m = r.closest;
  const pill = r.inbreeding
    ? '<span class="pill no">Inzucht-Gefahr</span>'
    : '<span class="pill yes">Unbedenklich</span>';
  return `<tr>
    <td data-label="Pferd" style="${tagCellStyle(r.horse.tags)}">${otherName}</td>
    <td data-label="Besitzer">${r.horse.owner ? escapeHtml(r.horse.owner) : '–'}</td>
    <td data-label="Nächster gemeinsamer Vorfahre">${escapeHtml(m.name)} (bei ${targetName}: ${escapeHtml(m.positionA)}, bei ${otherName}: ${escapeHtml(m.positionB)})</td>
    <td data-label="Bei Verpaarung">${pill}</td>
    <td data-label="Schlagwort" style="${tagCellStyle(r.horse.tags)}">${tagCellText(r.horse.tags)}</td>
  </tr>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
