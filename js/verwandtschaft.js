// Verwandtschaftsmatrix: Freitext-Nachschlage für ein einzelnes Pferd
// (alle verwandten Pferde + Position im Stammbaum) und eine Matrix-Ansicht
// über mehrere Pferde gleichzeitig (Stuten/Hengste in beliebiger
// Kombination). Nutzt findRelations/areRelated aus js/breeding.js - muss
// also nach parser.js/breeding.js eingebunden werden.

const RELATION_FIELDS = 'id,name,owner,gender,breed,purebred_pct,pedigree,breeding_allowed';

// Ab wie vielen Zellen (Zeilen × Spalten) die Matrix aus Performance- und
// Übersichtlichkeitsgründen nicht mehr gerendert wird.
const MAX_MATRIX_CELLS = 4000;

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
let matrixBreedFilter;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  horseSelect = createSearchableSelect(
    document.querySelector('#relation-search'), document.querySelector('#relation-panel'),
    { onChange: onTargetChange },
  );
  document.querySelector('#owner-select').addEventListener('change', onOwnerChange);
  matrixBreedFilter = createBreedFilter(document.querySelector('#matrix-breed-drop'), { onChange: renderMatrix });
  document.querySelector('#matrix-owner-select').addEventListener('change', renderMatrix);
  document.querySelector('#matrix-zzl-select').addEventListener('change', renderMatrix);
  document.querySelector('#matrix-modus-select').addEventListener('change', renderMatrix);
  await loadHorses();
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
  for (const selector of ['#owner-select', '#matrix-owner-select']) {
    const sel = document.querySelector(selector);
    sel.innerHTML = '<option value="">Alle</option>';
    for (const owner of owners) {
      const opt = document.createElement('option');
      opt.value = owner;
      opt.textContent = owner;
      sel.appendChild(opt);
    }
  }

  matrixBreedFilter.setHorses(allHorses);
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

function onTargetChange(id) {
  currentTarget = allHorses.find((h) => h.id === id) || null;
  renderFreitext();
}

// --- Einzelnes Pferd nachschlagen ---

function renderFreitext() {
  const container = document.querySelector('#freitext-result');
  if (!currentTarget) {
    container.innerHTML = '<p class="muted small">Bitte zuerst ein Pferd auswählen.</p>';
    return;
  }

  const related = allHorses
    .filter((h) => h.id !== currentTarget.id)
    .map((h) => ({ horse: h, matches: findRelations(currentTarget, h) }))
    .filter((r) => r.matches.length > 0)
    .sort((a, b) => b.matches.length - a.matches.length || (a.horse.name || '').localeCompare(b.horse.name || '', 'de'));

  let html = `<div class="group-heading">${related.length} verwandte Pferde gefunden</div>`;
  if (!related.length) {
    html += '<p class="small muted">Keine Verwandtschaft im sichtbaren Stammbaum gefunden.</p>';
    container.innerHTML = html;
    return;
  }

  html += `<div class="table-wrap"><table id="freitext-table">
    <thead><tr>
      <th>Pferd</th>
      <th>Besitzer</th>
      <th>Gemeinsame Vorfahren</th>
    </tr></thead>
    <tbody>${related.map((r) => relationRowHtml(r)).join('')}</tbody>
  </table></div>`;
  container.innerHTML = html;
}

function relationRowHtml(r) {
  const targetName = escapeHtml(currentTarget.name || '(ohne Name)');
  const otherName = escapeHtml(r.horse.name || '(ohne Name)');
  const list = r.matches.map((m) => `<li>${escapeHtml(m.name)} (bei ${targetName}: ${escapeHtml(m.positionA)}, bei ${otherName}: ${escapeHtml(m.positionB)})</li>`).join('');
  return `<tr>
    <td data-label="Pferd">${otherName}</td>
    <td data-label="Besitzer">${r.horse.owner ? escapeHtml(r.horse.owner) : '–'}</td>
    <td data-label="Gemeinsame Vorfahren"><ul class="small" style="margin:0; padding-left:1.1rem;">${list}</ul></td>
  </tr>`;
}

// --- Verwandtschaftsmatrix ---

function matrixCandidates(gender) {
  const owner = document.querySelector('#matrix-owner-select').value;
  const zzl = document.querySelector('#matrix-zzl-select').value;
  return allHorses.filter((h) => {
    if (gender && h.gender !== gender) return false;
    if (owner && h.owner !== owner) return false;
    if (!matrixBreedFilter.matches(h)) return false;
    if (zzl === 'zzl' && h.breeding_allowed !== true) return false;
    if (zzl === 'ohne' && h.breeding_allowed === true) return false;
    return true;
  });
}

function renderMatrix() {
  const container = document.querySelector('#matrix-result');
  const hintEl = document.querySelector('#matrix-hint');
  const modus = document.querySelector('#matrix-modus-select').value;

  let rows, cols;
  if (modus === 'stute-stute') {
    rows = cols = matrixCandidates('Stute');
  } else if (modus === 'hengst-hengst') {
    rows = cols = matrixCandidates('Hengst');
  } else {
    rows = matrixCandidates('Stute');
    cols = matrixCandidates('Hengst');
  }

  if (!rows.length || !cols.length) {
    hintEl.textContent = '';
    container.innerHTML = '<p class="muted small">Keine Pferde für diese Auswahl gefunden - Filter anpassen.</p>';
    return;
  }

  const cellCount = rows.length * cols.length;
  if (cellCount > MAX_MATRIX_CELLS) {
    hintEl.textContent = '';
    container.innerHTML = `<p class="muted small">Die Auswahl ergibt ${rows.length} × ${cols.length} = ${cellCount.toLocaleString('de')} Zellen - das ist zu groß, um sinnvoll dargestellt zu werden (Grenze: ${MAX_MATRIX_CELLS.toLocaleString('de')}). Bitte über Besitzer, Rasse oder ZZL weiter eingrenzen.</p>`;
    return;
  }

  hintEl.textContent = `${rows.length} × ${cols.length} Pferde ausgewählt.`;

  const rowData = rows.map((r) => {
    const related = cols.map((c) => areRelated(r, c));
    const count = related.filter(Boolean).length;
    return { horse: r, related, count };
  });
  rowData.sort((a, b) => b.count - a.count || (a.horse.name || '').localeCompare(b.horse.name || '', 'de'));

  let html = '<div class="table-wrap"><table id="matrix-table"><thead><tr>';
  html += '<th>Name</th><th>Besitzer</th><th>Rasse</th><th>Anzahl</th>';
  html += cols.map((c) => `<th class="col-header" title="${escapeHtml(c.owner || '')}">${escapeHtml(c.name || '(ohne Name)')}</th>`).join('');
  html += '</tr></thead><tbody>';
  html += rowData.map((rd) => `<tr>
    <td data-label="Name">${escapeHtml(rd.horse.name || '(ohne Name)')}</td>
    <td data-label="Besitzer">${rd.horse.owner ? escapeHtml(rd.horse.owner) : '–'}</td>
    <td data-label="Rasse" title="${escapeHtml(rd.horse.breed || '')}">${escapeHtml(breedAbbreviation(rd.horse.breed))}</td>
    <td data-label="Anzahl">${rd.count}</td>
    ${rd.related.map((isRel) => `<td class="${isRel ? 'related-cell' : ''}">${isRel ? '✕' : ''}</td>`).join('')}
  </tr>`).join('');
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
