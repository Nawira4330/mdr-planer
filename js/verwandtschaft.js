// Verwandtschaftsmatrix: Freitext-Nachschlage für ein einzelnes Pferd
// (alle verwandten Pferde + Position im Stammbaum) und eine Matrix-Ansicht
// über mehrere Pferde gleichzeitig (Stuten/Hengste in beliebiger
// Kombination). Nutzt findRelations/areRelated aus js/breeding.js - muss
// also nach parser.js/breeding.js eingebunden werden.

const RELATION_FIELDS = 'id,name,owner,gender,breed,purebred_pct,pedigree,breeding_allowed';

// Ab wie vielen Zellen (Zeilen × Spalten) die Matrix aus Performance- und
// Übersichtlichkeitsgründen nicht mehr gerendert wird.
const MAX_MATRIX_CELLS = 4000;

// Größe der alphabetischen Häppchen für die Beschränkungs-Auswahl (1-30,
// 31-60, ...) - je Achse unabhängig wählbar, um auch bei vielen Pferden
// gezielt einen Ausschnitt statt "Alle" darzustellen.
const LIMIT_CHUNK_SIZE = 30;

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
let matrixRowBreedFilter, matrixColBreedFilter;
let matrixSort = { field: 'count', dir: 'desc' };

document.addEventListener('DOMContentLoaded', init);

async function init() {
  horseSelect = createSearchableSelect(
    document.querySelector('#relation-search'), document.querySelector('#relation-panel'),
    { onChange: onTargetChange },
  );
  document.querySelector('#owner-select').addEventListener('change', onOwnerChange);
  document.querySelector('#foreign-horse-parse-btn').addEventListener('click', onForeignHorseParse);
  // Zeilen (1. Spalte) und Spalten (1. Zeile) der Matrix lassen sich
  // unabhängig voneinander filtern - z.B. "Stuten von Besitzer A" gegen
  // "Stuten von Besitzer B" statt zwangsweise derselben Auswahl auf
  // beiden Seiten.
  matrixRowBreedFilter = createBreedFilter(document.querySelector('#matrix-row-breed-drop'), { onChange: renderMatrix });
  matrixColBreedFilter = createBreedFilter(document.querySelector('#matrix-col-breed-drop'), { onChange: renderMatrix });
  document.querySelector('#matrix-row-owner-select').addEventListener('change', renderMatrix);
  document.querySelector('#matrix-col-owner-select').addEventListener('change', renderMatrix);
  document.querySelector('#matrix-row-zzl-select').addEventListener('change', renderMatrix);
  document.querySelector('#matrix-col-zzl-select').addEventListener('change', renderMatrix);
  document.querySelector('#matrix-row-limit-select').addEventListener('change', renderMatrix);
  document.querySelector('#matrix-col-limit-select').addEventListener('change', renderMatrix);
  document.querySelector('#matrix-modus-select').addEventListener('change', renderMatrix);
  document.querySelector('#matrix-inzucht-filter-select').addEventListener('change', renderMatrix);
  wireMatrixSortableHeaders();
  await loadHorses();
}

// Delegiert auf document, da die <th> bei jedem Neu-Rendern der Matrix neu
// erzeugt werden (kein erneutes Verdrahten pro Render nötig) - Muster wie
// js/turnierplaner.js/js/zuchtbuch.js.
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
  populateHorseSelect();
  renderMatrix();
}

function populateHorseSelect() {
  const owner = document.querySelector('#owner-select').value;
  const filtered = owner ? allHorses.filter((h) => h.owner === owner) : allHorses;
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
  if (!related.length) {
    html += '<p class="small muted">Keine Verwandtschaft im sichtbaren Stammbaum gefunden.</p>';
    container.innerHTML = html;
    return;
  }

  html += `<div class="table-wrap"><table id="freitext-table">
    <thead><tr>
      <th>Pferd</th>
      <th>Besitzer</th>
      <th>Nächster gemeinsamer Vorfahre</th>
      <th>Bei Verpaarung</th>
    </tr></thead>
    <tbody>${related.map((r) => relationRowHtml(r, target)).join('')}</tbody>
  </table></div>`;
  container.innerHTML = html;
}

function relationRowHtml(r, target) {
  const targetName = escapeHtml(target.name || '(ohne Name)');
  const otherName = escapeHtml(r.horse.name || '(ohne Name)');
  const m = r.closest;
  const pill = r.inbreeding
    ? '<span class="pill no">Inzucht-Gefahr</span>'
    : '<span class="pill yes">Unbedenklich</span>';
  return `<tr>
    <td data-label="Pferd">${otherName}</td>
    <td data-label="Besitzer">${r.horse.owner ? escapeHtml(r.horse.owner) : '–'}</td>
    <td data-label="Nächster gemeinsamer Vorfahre">${escapeHtml(m.name)} (bei ${targetName}: ${escapeHtml(m.positionA)}, bei ${otherName}: ${escapeHtml(m.positionB)})</td>
    <td data-label="Bei Verpaarung">${pill}</td>
  </tr>`;
}

// --- Verwandtschaftsmatrix ---

// axis: "row" (Zeilen, 1. Spalte) oder "col" (Spalten, 1. Zeile) - jede
// Achse hat ihren eigenen Besitzer-/Rasse-/ZZL-Filter.
function matrixCandidates(gender, axis) {
  const ownerSel = axis === 'row' ? '#matrix-row-owner-select' : '#matrix-col-owner-select';
  const zzlSel = axis === 'row' ? '#matrix-row-zzl-select' : '#matrix-col-zzl-select';
  const breedFilter = axis === 'row' ? matrixRowBreedFilter : matrixColBreedFilter;
  const owner = document.querySelector(ownerSel).value;
  const zzl = document.querySelector(zzlSel).value;
  return allHorses.filter((h) => {
    if (gender && h.gender !== gender) return false;
    if (owner && h.owner !== owner) return false;
    if (!breedFilter.matches(h)) return false;
    if (zzl === 'zzl' && h.breeding_allowed !== true) return false;
    if (zzl === 'ohne' && h.breeding_allowed === true) return false;
    return true;
  });
}

// Baut die "1-30 / 31-60 / ..."-Optionen passend zur aktuellen Trefferzahl
// (nach Besitzer-/Rasse-/ZZL-Filter, vor der Beschränkung selbst) neu auf.
// Die bisherige Auswahl bleibt erhalten, wenn sie weiterhin existiert -
// sonst (z. B. weil ein anderer Filter die Liste verkürzt hat) fällt die
// Auswahl zurück auf "Alle".
function updateLimitOptions(selectEl, total) {
  const prevValue = selectEl.value;
  const chunkCount = Math.ceil(total / LIMIT_CHUNK_SIZE);
  let html = '<option value="">Alle</option>';
  for (let i = 0; i < chunkCount; i++) {
    const start = i * LIMIT_CHUNK_SIZE + 1;
    const end = Math.min((i + 1) * LIMIT_CHUNK_SIZE, total);
    html += `<option value="${i}">${start}–${end}</option>`;
  }
  selectEl.innerHTML = html;
  selectEl.value = [...selectEl.options].some((o) => o.value === prevValue) ? prevValue : '';
}

// Start-/Endindex des gewählten alphabetischen Häppchens - leer/"Alle"
// liefert die volle Spanne [0, total].
function limitRange(selectEl, total) {
  if (selectEl.value === '') return [0, total];
  const idx = parseInt(selectEl.value, 10);
  return [idx * LIMIT_CHUNK_SIZE, Math.min((idx + 1) * LIMIT_CHUNK_SIZE, total)];
}

// Wendet die gewählte alphabetische Beschränkung auf eine (bereits nach
// Name sortierte) Kandidatenliste an - leer/"Alle" lässt die Liste
// unverändert.
function applyLimit(list, selectEl) {
  const [start, end] = limitRange(selectEl, list.length);
  return list.slice(start, end);
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
  } else {
    rowsFull = matrixCandidates('Stute', 'row');
    colsFull = matrixCandidates('Hengst', 'col');
  }

  const rowLimitSelect = document.querySelector('#matrix-row-limit-select');
  const colLimitSelect = document.querySelector('#matrix-col-limit-select');
  updateLimitOptions(rowLimitSelect, rowsFull.length);
  updateLimitOptions(colLimitSelect, colsFull.length);
  const rows = applyLimit(rowsFull, rowLimitSelect);
  const [colStart, colEnd] = limitRange(colLimitSelect, colsFull.length);
  const cols = colsFull.slice(colStart, colEnd);

  if (!rows.length || !cols.length) {
    hintEl.textContent = '';
    container.innerHTML = '<p class="muted small">Keine Pferde für diese Auswahl gefunden - Filter anpassen.</p>';
    return;
  }

  const cellCount = rows.length * cols.length;
  if (cellCount > MAX_MATRIX_CELLS) {
    hintEl.textContent = '';
    container.innerHTML = `<p class="muted small">Die Auswahl ergibt ${rows.length} × ${cols.length} = ${cellCount.toLocaleString('de')} Zellen - das ist zu groß, um sinnvoll dargestellt zu werden (Grenze: ${MAX_MATRIX_CELLS.toLocaleString('de')}). Bitte über Besitzer, Rasse, ZZL oder die Beschränkung weiter eingrenzen.</p>`;
    return;
  }

  const inzuchtFilter = document.querySelector('#matrix-inzucht-filter-select').value; // '' | 'inzucht' | 'sicher'

  const rowHint = rows.length < rowsFull.length ? `${rows.length} von ${rowsFull.length}` : `${rows.length}`;
  const colHint = cols.length < colsFull.length ? `${cols.length} von ${colsFull.length}` : `${cols.length}`;
  hintEl.textContent = `${rowHint} × ${colHint} Pferde ausgewählt. "Anzahl" = Gesamt verwandt, "Inzucht" = davon mit Inzucht-Gefahr bei einem gemeinsamen Fohlen.`
    + (cols.length < colsFull.length
      ? ' Beide Spalten zählen gegen alle gefilterten Spalten-Pferde, nicht nur den hier angezeigten Ausschnitt.'
      : '')
    + (inzuchtFilter ? ' Zellen-Markierungen sind auf "Bei Verpaarung" gefiltert - die Zahlen-Spalten bleiben davon unberührt.' : '');

  // "Anzahl" zählt IMMER gegen alle gefilterten Spalten (colsFull), nicht
  // nur gegen den aktuell angezeigten Spalten-Ausschnitt - sonst würde die
  // Zahl je nach gewählter Beschränkung schwanken, obwohl sich an der
  // eigentlichen Verwandtschaft nichts geändert hat. Die angezeigten
  // Zellen-Markierungen sind trotzdem nur der sichtbare Ausschnitt davon
  // (colStart..colEnd), damit Anzahl und Marker konsistent aus derselben
  // Berechnung stammen.
  //
  // Je sichtbarer Zelle wird zusätzlich zwischen zwei Verwandtschafts-Arten
  // unterschieden: findSharedNames(r, c) prüft (wie die Inzuchtprüfung im
  // Zuchtplaner), ob der gemeinsame Vorfahre auch tatsächlich im sichtbaren
  // Stammbaum eines gemeinsamen Fohlens doppelt auftauchen würde (nur
  // Eltern + Großeltern + Urgroßeltern DES FOHLENS zählen, siehe
  // foalPedigreeNodes in js/breeding.js - die jeweils eigenen
  // Urgroßeltern beider Pferde fallen dafür schon raus). Rot = echte
  // Inzucht-Gefahr bei gemeinsamem Fohlen, Grün = verwandt, aber der
  // gemeinsame Vorfahre liegt zu weit zurück, um im Fohlen-Stammbaum
  // aufzutauchen.
  const rowData = rows.map((r) => {
    // Je Spalten-Pferd einmal berechnet: 'none' (nicht verwandt), 'safe'
    // (verwandt, aber gemeinsamer Vorfahre zu weit zurück für ein Fohlen)
    // oder 'inbreeding' (würde bei Verpaarung Inzucht im Fohlen
    // verursachen, per findSharedNames wie in der Inzuchtprüfung).
    const statesFull = colsFull.map((c) => {
      if (!areRelated(r, c)) return 'none';
      return findSharedNames(r, c).length > 0 ? 'inbreeding' : 'safe';
    });
    const count = statesFull.filter((s) => s !== 'none').length;
    const inbreedingCount = statesFull.filter((s) => s === 'inbreeding').length;
    const cellStates = statesFull.slice(colStart, colEnd);
    return { horse: r, cellStates, count, inbreedingCount };
  });
  applyMatrixSort(rowData);

  let html = '<div class="table-wrap"><table id="matrix-table"><thead><tr>';
  html += sortableMatrixHeaderHtml('name', 'Name') + '<th>Besitzer</th>'
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
