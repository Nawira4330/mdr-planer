// Verwandtschaftsmatrix: Freitext-Nachschlage für ein einzelnes Pferd
// (alle verwandten Pferde + Position im Stammbaum) und eine Matrix-Ansicht
// über mehrere Pferde gleichzeitig (Stuten/Hengste in beliebiger
// Kombination). Nutzt findRelations/areRelated aus js/breeding.js - muss
// also nach parser.js/breeding.js eingebunden werden.

const RELATION_FIELDS =
  'id,name,owner,gender,coat_color,breed,purebred_pct,pedigree,breeding_allowed,tags,tournament_potential,exterior_genetics,exterior_descriptive,temperament';

// Ab wie vielen Zellen (Zeilen × Spalten) die Matrix aus Performance- und
// Übersichtlichkeitsgründen nicht mehr gerendert wird.
const MAX_MATRIX_CELLS = 4000;

// Seitengröße fürs Umblättern je Achse (siehe wireMatrixPagination) -
// ersetzt die frühere "1-30/31-60/..."-Dropdown-Auswahl.
const PAGE_SIZE = 30;

// Kurze Kürzel für die Rasse-Spalte der Matrix (spart Platz bei vielen
// Zeilen) - unbekannte Rassen fallen auf die ersten 3 Buchstaben zurück.
const BREED_ABBREVIATIONS = {
  'American Paint Horse': 'APH',
  'Andalusier': 'And',
  'Rasselos': 'Mix',
};
function breedAbbreviation(breed) {
  if (!breed) return '–';
  return BREED_ABBREVIATIONS[breed] || breed.slice(0, 3);
}

let allHorses = [];
let horseSelect;
let currentTarget = null;
let foreignTarget = null; // per Freitext eingelesenes, nicht in der DB gespeichertes Pferd
let matrixRowBreedFilter, matrixColBreedFilter, relationBreedFilter;
let matrixRowTagFilter, matrixColTagFilter, relationTagFilter;
// null = keine Präferenz (Gast/kein Setting) -> APH-Standard in
// createBreedFilter; [] = "Alle Rassen" bewusst gewählt; [...] = konkrete
// Rassen - siehe loadDefaultBreeds/user_settings.preferred_breeds.
let defaultBreeds = null;
let matrixSort = { field: 'count', dir: 'desc' };
let freitextSort = { field: 'name', dir: 'asc' };
// Aktuelle Seite je Achse (0-indexiert), bleibt beim Umblättern erhalten
// und wird beim Rendern auf die jeweils gültige Spanne begrenzt (z.B.
// nach einer Filteränderung, die die Trefferzahl verkleinert hat).
let matrixRowPage = 0;
let matrixColPage = 0;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  document.querySelector('#tag-legend').innerHTML = tagLegendHtml();
  horseSelect = createSearchableSelect(
    document.querySelector('#relation-search'), document.querySelector('#relation-panel'),
    { onChange: onTargetChange },
  );
  document.querySelector('#owner-select').addEventListener('change', onOwnerChange);
  relationBreedFilter = createBreedFilter(document.querySelector('#relation-breed-drop'), { onChange: populateHorseSelect, initialSelection: () => defaultBreeds });
  relationTagFilter = createTagFilter(document.querySelector('#relation-tag-drop'), { onChange: populateHorseSelect });
  document.querySelector('#relation-gender-select').addEventListener('change', populateHorseSelect);
  document.querySelector('#relation-zzl-select').addEventListener('change', populateHorseSelect);
  document.querySelector('#foreign-horse-parse-btn').addEventListener('click', onForeignHorseParse);
  // Zeilen (1. Spalte) und Spalten (1. Zeile) der Matrix lassen sich
  // unabhängig voneinander filtern - z.B. "Stuten von Besitzer A" gegen
  // "Stuten von Besitzer B" statt zwangsweise derselben Auswahl auf
  // beiden Seiten.
  matrixRowBreedFilter = createBreedFilter(document.querySelector('#matrix-row-breed-drop'), { onChange: renderMatrix, initialSelection: () => defaultBreeds });
  matrixColBreedFilter = createBreedFilter(document.querySelector('#matrix-col-breed-drop'), { onChange: renderMatrix, initialSelection: () => defaultBreeds });
  matrixRowTagFilter = createTagFilter(document.querySelector('#matrix-row-tag-drop'), { onChange: renderMatrix });
  matrixColTagFilter = createTagFilter(document.querySelector('#matrix-col-tag-drop'), { onChange: renderMatrix });
  document.querySelector('#matrix-row-owner-select').addEventListener('change', renderMatrix);
  document.querySelector('#matrix-col-owner-select').addEventListener('change', renderMatrix);
  document.querySelector('#matrix-row-zzl-select').addEventListener('change', renderMatrix);
  document.querySelector('#matrix-col-zzl-select').addEventListener('change', renderMatrix);
  document.querySelector('#matrix-modus-select').addEventListener('change', renderMatrix);
  document.querySelector('#matrix-inzucht-filter-select').addEventListener('change', renderMatrix);
  wireMatrixPagination();
  wireMatrixSortableHeaders();
  wireFreitextSortableHeaders();
  wireTagSuggestHandlers('Verwandtschaftsmatrix');
  await initAuthStatus();
  await loadDefaultBreeds();
  await loadHorses();
}

// Übernimmt dieselbe Rassen-Präferenz wie die Einstellungen in der
// MDR-Datenbank (user_settings.preferred_breeds), damit die Rassen-Filter
// hier nicht mehr fest auf APH stehen. Kein eigener gespeicherter Zustand
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

// Delegiert auf document, da die <th> bei jedem Neu-Rendern der Matrix neu
// erzeugt werden (kein erneutes Verdrahten pro Render nötig) - Muster wie
// js/turnierplaner.js/js/zuchtbuch.js.
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

// GP/Ext/Ext%/Int fürs nachgeschlagene Pferd (Werte-Zeile in
// renderFreitext) - 1:1 aus js/zuchtbuch.js portiert (dort computeDerived),
// hier ohne die dort zusätzlich berechnete Genetik-Zusammenfassung, da nur
// nach "Werte und Farbe" gefragt wurde.
function targetValues(h) {
  const gpRaw = h.tournament_potential?.['Gesamtpotenzial'];
  return {
    gp: gpRaw != null && gpRaw !== '' ? Number(gpRaw) : null,
    extAvg: averageScore(h.exterior_descriptive, scoreExteriorTerm),
    extPercent: h.exterior_genetics?.overall?.percent ?? null,
    intAvg: averageScore(h.temperament, scoreTemperamentTerm),
  };
}

function freitextSortValue(row, field) {
  switch (field) {
    case 'name': return (row.horse.name || '').toLowerCase();
    case 'owner': return (row.horse.owner || '').toLowerCase();
    case 'ancestor': return (row.closest.name || '').toLowerCase();
    case 'inbreeding': return row.inbreeding ? 1 : 0;
    case 'tag': return tagSortValue(row.horse.tags);
    default: return null;
  }
}

function wireFreitextSortableHeaders() {
  document.addEventListener('click', (e) => {
    const th = e.target.closest('#freitext-table th[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    if (freitextSort.field === field) freitextSort.dir = freitextSort.dir === 'asc' ? 'desc' : 'asc';
    else freitextSort = { field, dir: field === 'inbreeding' ? 'desc' : 'asc' };
    renderFreitext();
  });
}

function wireMatrixSortableHeaders() {
  document.addEventListener('click', (e) => {
    const th = e.target.closest('#matrix-table th[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    if (matrixSort.field === field) {
      matrixSort.dir = matrixSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      // Bei "Anzahl"/"Inzucht" ist absteigend (meiste zuerst) der
      // sinnvollere Start, bei Name/Rasse aufsteigend (alphabetisch).
      matrixSort = { field, dir: (field === 'count' || field === 'inbreedingCount') ? 'desc' : 'asc' };
    }
    // Sortierung wirkt nur auf die Zeilen (siehe applyMatrixSort) - nach
    // einer neuen Sortierung wieder bei Seite 1 der Zeilen starten, damit
    // man nicht mitten in der neu sortierten Liste landet.
    matrixRowPage = 0;
    renderMatrix();
  });
}

async function loadHorses() {
  const errorEl = document.querySelector('#load-error');
  // Bewusst ohne ZZL-/Geschlechtsfilter beim Laden (wie js/zuchtbuch.js) -
  // die ZZL-Einschränkung ist hier nur ein optionaler Filter für die
  // Matrix, die Einzel-Nachschlage soll alle Pferde finden können.
  const { data, error } = await supabaseClient.from('horses').select(RELATION_FIELDS).order('name');
  if (error) {
    errorEl.textContent =
      'Konnte Pferde nicht laden: ' + error.message +
      ' (falls die Seite ohne Login genutzt wird, muss dafür einmalig die Migration ' +
      '"migration_005_public_read_access.sql" im Supabase-Dashboard ausgeführt worden sein).';
    return;
  }
  allHorses = data || [];

  const owners = [...new Set(allHorses.map((h) => h.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  for (const selector of ['#owner-select', '#matrix-row-owner-select', '#matrix-col-owner-select']) {
    const sel = document.querySelector(selector);
    sel.innerHTML = '<option value="">Alle</option>';
    for (const owner of owners) {
      const opt = document.createElement('option');
      opt.value = owner;
      opt.textContent = owner;
      sel.appendChild(opt);
    }
  }

  matrixRowBreedFilter.setHorses(allHorses);
  matrixColBreedFilter.setHorses(allHorses);
  relationBreedFilter.setHorses(allHorses);
  populateHorseSelect();
  renderMatrix();
}

function populateHorseSelect() {
  const owner = document.querySelector('#owner-select').value;
  const gender = document.querySelector('#relation-gender-select').value;
  const zzl = document.querySelector('#relation-zzl-select').value;
  const filtered = allHorses.filter((h) => {
    if (owner && h.owner !== owner) return false;
    if (gender && h.gender !== gender) return false;
    if (zzl === 'zzl' && h.breeding_allowed !== true) return false;
    if (zzl === 'ohne' && h.breeding_allowed === true) return false;
    return relationBreedFilter.matches(h) && relationTagFilter.matches(h);
  });
  horseSelect.setItems(filtered.map((h) => ({ id: h.id, label: h.name || '(ohne Name)' })));
}

function onOwnerChange() {
  populateHorseSelect();
  horseSelect.clear(); // löst onTargetChange('') aus
}

// Auswahl per Dropdown ersetzt ein zuvor per Freitext eingelesenes
// datenbankfremdes Pferd wieder (Muster wie js/zuchtplaner.js beim
// "Fremder Hengst"-Freitext).
function onTargetChange(id) {
  if (id) {
    foreignTarget = null;
    document.querySelector('#foreign-horse-raw-text').value = '';
    document.querySelector('#foreign-horse-parse-status').textContent = '';
  }
  currentTarget = allHorses.find((h) => h.id === id) || null;
  renderFreitext();
}

function onForeignHorseParse() {
  const text = document.querySelector('#foreign-horse-raw-text').value;
  const statusEl = document.querySelector('#foreign-horse-parse-status');
  if (!text.trim()) {
    statusEl.textContent = 'Bitte zuerst Text einfügen.';
    return;
  }
  foreignTarget = parseHorseText(text);
  horseSelect.clear(); // löst onTargetChange('') aus - foreignTarget bleibt erhalten (id ist leer)
  statusEl.textContent = 'Erkannt: ' + (foreignTarget.name || 'kein Name gefunden');
  renderFreitext();
}

// --- Einzelnes Pferd nachschlagen ---

// "Nähe" einer Übereinstimmung: je kleiner, desto enger verwandt. Ist z.B.
// die Mutter (oder Tochter) eines Pferds gefunden, teilen sich fast
// zwangsläufig auch viele weitere Vorfahren dahinter - deshalb wird pro
// verwandtem Pferd nur die EINE engste Übereinstimmung angezeigt statt
// aller (sonst würde bei einer Mutter/Tochter-Beziehung eine lange, wenig
// hilfreiche Liste mit fast der Hälfte des Stammbaums entstehen).
const POSITION_RANK = { 'Pferd selbst': 0, 'Elternteil': 1, 'Großeltern': 2, 'Urgroßeltern': 3 };
function relationCloseness(m) {
  return POSITION_RANK[m.positionA] + POSITION_RANK[m.positionB];
}
function closestRelation(matches) {
  return matches.reduce((best, m) => (relationCloseness(m) < relationCloseness(best) ? m : best));
}

function renderFreitext() {
  const container = document.querySelector('#freitext-result');
  // Ein per Freitext eingelesenes datenbankfremdes Pferd hat Vorrang vor
  // der Dropdown-Auswahl (siehe onForeignHorseParse/onTargetChange).
  const target = foreignTarget || currentTarget;
  if (!target) {
    container.innerHTML = '<p class="muted small">Bitte zuerst ein Pferd auswählen.</p>';
    return;
  }

  // Zusätzlich zur reinen Verwandtschaft (findRelations) wird je Pferd
  // geprüft, ob der gemeinsame Vorfahre bei Verpaarung auch tatsächlich im
  // sichtbaren Stammbaum eines gemeinsamen Fohlens doppelt auftauchen
  // würde (findSharedNames) - dieselbe Unterscheidung wie in der Matrix.
  const related = allHorses
    .filter((h) => h.id !== target.id)
    .map((h) => {
      const matches = findRelations(target, h);
      if (!matches.length) return null;
      const inbreeding = findSharedNames(target, h).length > 0;
      return { horse: h, closest: closestRelation(matches), inbreeding };
    })
    .filter(Boolean)
    .sort((a, b) => relationCloseness(a.closest) - relationCloseness(b.closest) || (a.horse.name || '').localeCompare(b.horse.name || '', 'de'));
  const inbreedingCount = related.filter((r) => r.inbreeding).length;

  const countLabel = `${related.length} verwandte Pferde (${inbreedingCount} davon mit Inzucht-Gefahr bei Verpaarung)`;
  const heading = foreignTarget
    ? `${countLabel} für "${escapeHtml(target.name || '(ohne Name)')}" gefunden (datenbankfremdes Pferd)`
    : `${countLabel} gefunden`;
  let html = `<div class="group-heading">${heading}</div>`;
  const d = targetValues(target);
  html += `<p class="small muted">
    GP: <strong>${d.gp != null ? d.gp : '–'}</strong>
     &nbsp;·&nbsp; Ext: <strong>${d.extAvg != null ? d.extAvg.toFixed(2) : '–'}</strong>
     &nbsp;·&nbsp; Ext%: <strong>${d.extPercent != null ? d.extPercent + '%' : '–'}</strong>
     &nbsp;·&nbsp; Int: <strong>${d.intAvg != null ? d.intAvg.toFixed(2) : '–'}</strong>
     &nbsp;·&nbsp; Farbe: <strong>${target.coat_color ? escapeHtml(target.coat_color) : '–'}</strong>
  </p>`;
  // Ein einziger, zusammenfassender Wert (siehe estimateBreedRelatedness in
  // js/breeding.js) - Ø-Verwandtschaftsgrad gegen ALLE anderen Pferde
  // DERSELBEN RASSE im Bestand. Bewusst NICHT je einzelnem verwandten
  // Pferd (das wäre schnell unübersichtlich) - nur dieser eine Wert pro
  // nachgeschlagenem Pferd.
  const breedCoiPct = estimateBreedRelatedness(target, allHorses);
  if (breedCoiPct != null) {
    html += `<p class="small">Ø Verwandtschaftsgrad zu allen ${escapeHtml(target.breed || 'derselben Rasse')}-Pferden im Bestand: <strong>${breedCoiPct.toFixed(1)}%</strong></p>`;
  }
  html += `<p class="small">${tagSuggestButtonHtml(target.id, target.owner)}</p>`;
  if (!related.length) {
    html += '<p class="small muted">Keine Verwandtschaft im sichtbaren Stammbaum gefunden.</p>';
    container.innerHTML = html;
    return;
  }

  const sortedRelated = applySortGeneric(related, freitextSort, freitextSortValue);
  const th = (field, label) => `<th data-sort="${field}">${label}${sortArrowGeneric(freitextSort, field)}</th>`;
  html += `<div class="table-wrap"><table id="freitext-table">
    <thead><tr>
      ${th('name', 'Pferd')}
      ${th('owner', 'Besitzer')}
      ${th('ancestor', 'Nächster gemeinsamer Vorfahre')}
      ${th('inbreeding', 'Bei Verpaarung')}
      ${th('tag', 'Schlagwort')}
    </tr></thead>
    <tbody>${sortedRelated.map((r) => relationRowHtml(r, target)).join('')}</tbody>
  </table></div>`;
  container.innerHTML = html;
}

function sortArrowGeneric(sort, field) {
  return sort.field === field ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
}

function relationRowHtml(r, target) {
  const targetName = escapeHtml(target.name || '(ohne Name)');
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

// --- Verwandtschaftsmatrix ---

// axis: "row" (Zeilen, 1. Spalte) oder "col" (Spalten, 1. Zeile) - jede
// Achse hat ihren eigenen Besitzer-/Rasse-/ZZL-Filter.
function matrixCandidates(gender, axis) {
  const ownerSel = axis === 'row' ? '#matrix-row-owner-select' : '#matrix-col-owner-select';
  const zzlSel = axis === 'row' ? '#matrix-row-zzl-select' : '#matrix-col-zzl-select';
  const breedFilter = axis === 'row' ? matrixRowBreedFilter : matrixColBreedFilter;
  const tagFilter = axis === 'row' ? matrixRowTagFilter : matrixColTagFilter;
  const owner = document.querySelector(ownerSel).value;
  const zzl = document.querySelector(zzlSel).value;
  return allHorses.filter((h) => {
    if (gender && h.gender !== gender) return false;
    if (owner && h.owner !== owner) return false;
    if (!breedFilter.matches(h)) return false;
    if (!tagFilter.matches(h)) return false;
    if (zzl === 'zzl' && h.breeding_allowed !== true) return false;
    if (zzl === 'ohne' && h.breeding_allowed === true) return false;
    return true;
  });
}

// Umblättern statt "1-30/31-60/..."-Dropdown (siehe matrixRowPage/
// matrixColPage) - Seitengröße PAGE_SIZE, 0-indexiert.
function totalPages(total) {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

// Hält eine Seitenzahl im gültigen Bereich - z.B. nach einer
// Filteränderung, die die Trefferzahl verkleinert hat.
function clampPage(page, total) {
  return Math.min(Math.max(page, 0), totalPages(total) - 1);
}

function pageRange(page, total) {
  const start = page * PAGE_SIZE;
  return [start, Math.min(start + PAGE_SIZE, total)];
}

// Sortiert die rohen Pferdedaten nach Name/Rasse OHNE die teure
// Zellen-Berechnung (computeRowData) - für "Anzahl"/"Inzucht" reicht das
// nicht (die Werte existieren erst nach der Berechnung), aber bei
// Name/Rasse lässt sich so die komplette, gefilterte Liste günstig global
// sortieren, bevor nur noch die sichtbare Seite berechnet wird (siehe
// renderMatrix - vorher wurde bei einer gewählten Beschränkung nur
// INNERHALB des bereits alphabetisch zugeschnittenen Häppchens sortiert,
// was bei Rasse-Sortierung falsche Ergebnisse lieferte).
function sortHorsesByField(horses, field, dir) {
  const mult = dir === 'asc' ? 1 : -1;
  const key = (h) => {
    if (field === 'breed') return (h.breed || '').toLowerCase();
    if (field === 'owner') return (h.owner || '').toLowerCase();
    return (h.name || '').toLowerCase();
  };
  return [...horses].sort((a, b) => {
    const va = key(a), vb = key(b);
    if (va === vb) return (a.name || '').localeCompare(b.name || '', 'de');
    return va.localeCompare(vb, 'de') * mult;
  });
}

function wireMatrixPagination() {
  document.querySelector('#matrix-row-prev').addEventListener('click', () => { matrixRowPage--; renderMatrix(); });
  document.querySelector('#matrix-row-next').addEventListener('click', () => { matrixRowPage++; renderMatrix(); });
  document.querySelector('#matrix-col-prev').addEventListener('click', () => { matrixColPage--; renderMatrix(); });
  document.querySelector('#matrix-col-next').addEventListener('click', () => { matrixColPage++; renderMatrix(); });
  document.querySelector('#matrix-row-page-select').addEventListener('change', (e) => {
    matrixRowPage = parseInt(e.target.value, 10);
    renderMatrix();
  });
  document.querySelector('#matrix-col-page-select').addEventListener('change', (e) => {
    matrixColPage = parseInt(e.target.value, 10);
    renderMatrix();
  });
}

// Baut die Seiten-Dropdowns neu auf (Trefferzahl kann sich durch Filter
// jederzeit ändern) und hält sie mit der aktuellen Seite + den
// Vor/Zurück-Buttons synchron.
function renderMatrixPagination(rowTotal, colTotal) {
  fillPageSelect(document.querySelector('#matrix-row-page-select'), matrixRowPage, totalPages(rowTotal));
  fillPageSelect(document.querySelector('#matrix-col-page-select'), matrixColPage, totalPages(colTotal));
  document.querySelector('#matrix-row-prev').disabled = matrixRowPage <= 0;
  document.querySelector('#matrix-row-next').disabled = matrixRowPage >= totalPages(rowTotal) - 1;
  document.querySelector('#matrix-col-prev').disabled = matrixColPage <= 0;
  document.querySelector('#matrix-col-next').disabled = matrixColPage >= totalPages(colTotal) - 1;
}

function fillPageSelect(selectEl, currentPage, pageCount) {
  let html = '';
  for (let i = 0; i < pageCount; i++) {
    html += `<option value="${i}">Seite ${i + 1} von ${pageCount}</option>`;
  }
  selectEl.innerHTML = html;
  selectEl.value = String(currentPage);
}

function sortableMatrixHeaderHtml(field, label) {
  const arrow = matrixSort.field === field ? (matrixSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return `<th data-sort="${field}">${escapeHtml(label)}${arrow}</th>`;
}

function matrixSortValue(rd, field) {
  if (field === 'name') return (rd.horse.name || '').toLowerCase();
  if (field === 'breed') return (rd.horse.breed || '').toLowerCase();
  if (field === 'inbreedingCount') return rd.inbreedingCount;
  return rd.count;
}

// Fehlende Werte landen wie überall sonst am Ende, unabhängig von der
// Sortierrichtung (Muster wie js/turnierplaner.js/js/zuchtbuch.js).
function applyMatrixSort(rowData) {
  const { field, dir } = matrixSort;
  const mult = dir === 'asc' ? 1 : -1;
  rowData.sort((a, b) => {
    const va = matrixSortValue(a, field);
    const vb = matrixSortValue(b, field);
    if (va === vb) return (a.horse.name || '').localeCompare(b.horse.name || '', 'de');
    if (typeof va === 'string') return va.localeCompare(vb, 'de') * mult;
    return (va - vb) * mult;
  });
}

// "Anzahl" zählt IMMER gegen ALLE gefilterten Spalten (colsFull), nicht nur
// gegen den aktuell angezeigten Spalten-Ausschnitt - sonst würde die Zahl
// je nach gewählter Beschränkung schwanken, obwohl sich an der
// eigentlichen Verwandtschaft nichts geändert hat. Die zurückgegebenen
// Zellen-Markierungen (cellStates) sind trotzdem nur der sichtbare
// Ausschnitt davon (colStart..colEnd), damit Anzahl und Marker konsistent
// aus derselben Berechnung stammen.
//
// Je Zelle wird zwischen zwei Verwandtschafts-Arten unterschieden:
// findSharedNames(r, c) prüft (wie die Inzuchtprüfung im Zuchtplaner), ob
// der gemeinsame Vorfahre auch tatsächlich im sichtbaren Stammbaum eines
// gemeinsamen Fohlens doppelt auftauchen würde (nur Eltern + Großeltern +
// Urgroßeltern DES FOHLENS zählen, siehe foalPedigreeNodes in
// js/breeding.js - die jeweils eigenen Urgroßeltern beider Pferde fallen
// dafür schon raus). 'inbreeding' = echte Inzucht-Gefahr bei gemeinsamem
// Fohlen, 'safe' = verwandt, aber der gemeinsame Vorfahre liegt zu weit
// zurück, um im Fohlen-Stammbaum aufzutauchen.
function computeRowData(rowsSubset, colsFull, colStart, colEnd) {
  return rowsSubset.map((r) => {
    const statesFull = colsFull.map((c) => {
      if (!areRelated(r, c)) return 'none';
      return findSharedNames(r, c).length > 0 ? 'inbreeding' : 'safe';
    });
    const count = statesFull.filter((s) => s !== 'none').length;
    const inbreedingCount = statesFull.filter((s) => s === 'inbreeding').length;
    const cellStates = statesFull.slice(colStart, colEnd);
    return { horse: r, cellStates, count, inbreedingCount };
  });
}

function renderMatrix() {
  const container = document.querySelector('#matrix-result');
  const hintEl = document.querySelector('#matrix-hint');
  const modus = document.querySelector('#matrix-modus-select').value;

  let rowsFull, colsFull;
  if (modus === 'stute-stute') {
    rowsFull = matrixCandidates('Stute', 'row');
    colsFull = matrixCandidates('Stute', 'col');
  } else if (modus === 'hengst-hengst') {
    rowsFull = matrixCandidates('Hengst', 'row');
    colsFull = matrixCandidates('Hengst', 'col');
  } else if (modus === 'hengst-stute') {
    rowsFull = matrixCandidates('Hengst', 'row');
    colsFull = matrixCandidates('Stute', 'col');
  } else {
    rowsFull = matrixCandidates('Stute', 'row');
    colsFull = matrixCandidates('Hengst', 'col');
  }

  matrixRowPage = clampPage(matrixRowPage, rowsFull.length);
  matrixColPage = clampPage(matrixColPage, colsFull.length);
  const [colStart, colEnd] = pageRange(matrixColPage, colsFull.length);
  const cols = colsFull.slice(colStart, colEnd);

  // Sortierung wirkt IMMER global über alle gefilterten Zeilen-Pferde,
  // nicht nur die aktuell sichtbare Seite (Nutzerwunsch). Bei "Anzahl"/
  // "Inzucht" ist dafür zwingend die volle Zellen-Berechnung nötig (die
  // Werte entstehen erst dabei, siehe computeRowData) - bei Name/Rasse
  // reicht ein günstiger direkter Sortier-Vergleich auf den rohen
  // Pferdedaten (siehe sortHorsesByField), die teure Zellen-Berechnung
  // läuft dann erst NACH dem Umblättern nur noch für die sichtbaren
  // (max. PAGE_SIZE) Zeilen.
  const isRankedSort = matrixSort.field === 'count' || matrixSort.field === 'inbreedingCount';
  let rowData;
  if (isRankedSort) {
    const allRowData = computeRowData(rowsFull, colsFull, colStart, colEnd);
    applyMatrixSort(allRowData);
    const [rowStart, rowEnd] = pageRange(matrixRowPage, allRowData.length);
    rowData = allRowData.slice(rowStart, rowEnd);
  } else {
    const sortedRows = sortHorsesByField(rowsFull, matrixSort.field, matrixSort.dir);
    const [rowStart, rowEnd] = pageRange(matrixRowPage, sortedRows.length);
    rowData = computeRowData(sortedRows.slice(rowStart, rowEnd), colsFull, colStart, colEnd);
  }

  renderMatrixPagination(rowsFull.length, colsFull.length);

  if (!rowData.length || !cols.length) {
    hintEl.textContent = '';
    container.innerHTML = '<p class="muted small">Keine Pferde für diese Auswahl gefunden - Filter anpassen.</p>';
    return;
  }

  const cellCount = rowData.length * cols.length;
  if (cellCount > MAX_MATRIX_CELLS) {
    hintEl.textContent = '';
    container.innerHTML = `<p class="muted small">Die Auswahl ergibt ${rowData.length} × ${cols.length} = ${cellCount.toLocaleString('de')} Zellen - das ist zu groß, um sinnvoll dargestellt zu werden (Grenze: ${MAX_MATRIX_CELLS.toLocaleString('de')}). Bitte über Besitzer, Rasse oder ZZL weiter eingrenzen.</p>`;
    return;
  }

  const inzuchtFilter = document.querySelector('#matrix-inzucht-filter-select').value; // '' | 'inzucht' | 'sicher'

  const rowHint = `${rowData.length} von ${rowsFull.length}`;
  const colHint = `${cols.length} von ${colsFull.length}`;
  hintEl.textContent = `${rowHint} × ${colHint} Pferde auf dieser Seite. "Anzahl" = Gesamt verwandt, "Inzucht" = davon mit Inzucht-Gefahr bei einem gemeinsamen Fohlen.`
    + (cols.length < colsFull.length
      ? ' Beide Spalten zählen gegen alle gefilterten Spalten-Pferde, nicht nur den hier angezeigten Ausschnitt.'
      : '')
    + (inzuchtFilter ? ' Zellen-Markierungen sind auf "Bei Verpaarung" gefiltert - die Zahlen-Spalten bleiben davon unberührt.' : '');

  let html = '<div class="table-wrap"><table id="matrix-table"><thead><tr>';
  html += sortableMatrixHeaderHtml('name', 'Name') + sortableMatrixHeaderHtml('owner', 'Besitzer')
    + sortableMatrixHeaderHtml('breed', 'Rasse') + sortableMatrixHeaderHtml('count', 'Anzahl')
    + sortableMatrixHeaderHtml('inbreedingCount', 'Inzucht');
  html += cols.map((c) => `<th class="col-header" title="${escapeHtml(c.owner || '')}">${escapeHtml(c.name || '(ohne Name)')}</th>`).join('');
  html += '</tr></thead><tbody>';
  html += rowData.map((rd) => `<tr>
    <td data-label="Name">${escapeHtml(rd.horse.name || '(ohne Name)')}</td>
    <td data-label="Besitzer">${rd.horse.owner ? escapeHtml(rd.horse.owner) : '–'}</td>
    <td data-label="Rasse" title="${escapeHtml(rd.horse.breed || '')}">${escapeHtml(breedAbbreviation(rd.horse.breed))}</td>
    <td data-label="Anzahl">${rd.count}</td>
    <td data-label="Inzucht" title="Würde bei Verpaarung mit diesen Pferden Inzucht im gemeinsamen Fohlen verursachen">${rd.inbreedingCount}</td>
    ${rd.cellStates.map((state) => matrixCellHtml(state, inzuchtFilter)).join('')}
  </tr>`).join('');
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

// inzuchtFilter: '' (alle zeigen), 'inzucht' (nur rote Zellen zeigen, grüne
// ausblenden) oder 'sicher' (nur grüne zeigen, rote ausblenden) - filtert
// bewusst nur die Zellen-Markierungen, nicht die Zeilen/Spalten selbst oder
// die Anzahl-/Inzucht-Zahlenspalten (die bleiben immer die vollen, echten
// Zahlen, unabhängig vom Filter).
function matrixCellHtml(state, inzuchtFilter) {
  if (inzuchtFilter === 'inzucht' && state !== 'inbreeding') state = 'none';
  if (inzuchtFilter === 'sicher' && state !== 'safe') state = 'none';
  if (state === 'inbreeding') return '<td class="related-cell" title="Würde bei einem gemeinsamen Fohlen Inzucht verursachen">✕</td>';
  if (state === 'safe') return '<td class="related-cell-safe" title="Verwandt, aber zu weit entfernt - würde bei einem gemeinsamen Fohlen keine Inzucht verursachen">✕</td>';
  return '<td></td>';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
