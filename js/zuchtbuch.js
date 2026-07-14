// Zuchtbuch: Verwandtschaftsübersicht (alle im sichtbaren Stammbaum
// auffindbaren Verwandten eines Pferds) + Fohlen-Vorhersage vs. Realität
// (nur GP/Int) für Pferde, deren beide Eltern selbst in der Datenbank
// stehen. Benötigt js/parser.js, js/breeding.js, js/verpaarung.js,
// js/searchableSelect.js - muss also nach diesen Scripts eingebunden
// werden.

const ZUCHTBUCH_FIELDS =
  'id,name,owner,gender,coat_color,colors,notes,pedigree,tournament_potential,exterior_genetics,exterior_descriptive,temperament,traits,disciplines,genetic_diseases,hlp_slp,breeding_allowed,breed,purebred_pct';

let allHorses = [];
let horseSelect;
let breedFilter;
let currentHorse = null;
let currentSort = { field: 'beziehung', dir: 'asc' };

document.addEventListener('DOMContentLoaded', init);

async function init() {
  horseSelect = createSearchableSelect(
    document.querySelector('#horse-search'), document.querySelector('#horse-panel'),
    { onChange: onHorseSelect },
  );
  breedFilter = createBreedFilter(document.querySelector('#breed-drop'), { onChange: populateHorseSelect });
  document.querySelector('#owner-select').addEventListener('change', onOwnerChange);
  ['filter-vater', 'filter-mutter', 'filter-kinder', 'filter-nachkommen'].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener('change', render);
  });
  document.querySelector('#filter-alle').addEventListener('change', onFilterAlleChange);
  applyFilterAlleState(); // Einzel-Häkchen passend zum Startzustand (an) deaktivieren
  wireSortableHeaders();
  await loadHorses();
}

// "Alle Verwandtschaft" ist ein Master-Häkchen: aktiviert zeigt es
// unabhängig von den anderen vier Häkchen wirklich alle Kategorien und
// graut die vier Einzel-Häkchen aus. Bei jeder Umschaltung (an ODER
// aus) werden die vier Einzel-Häkchen geleert - beim Ausschalten startet
// man also bewusst mit einer leeren Feinauswahl (nur Eltern weiterhin
// sichtbar) statt automatisch wieder alles zu zeigen.
function onFilterAlleChange() {
  applyFilterAlleState();
  render();
}

function applyFilterAlleState() {
  const alle = document.querySelector('#filter-alle').checked;
  ['filter-vater', 'filter-mutter', 'filter-kinder', 'filter-nachkommen'].forEach((id) => {
    const cb = document.querySelector(`#${id}`);
    cb.disabled = alle;
    cb.checked = false;
  });
}

function selectedRelativeFilters() {
  const alle = document.querySelector('#filter-alle').checked;
  if (alle) {
    return { vater: true, mutter: true, kinder: true, nachkommen: true, alle: true };
  }
  return {
    vater: document.querySelector('#filter-vater').checked,
    mutter: document.querySelector('#filter-mutter').checked,
    kinder: document.querySelector('#filter-kinder').checked,
    nachkommen: document.querySelector('#filter-nachkommen').checked,
    alle: false,
  };
}

// Eltern stehen in einer eigenen Karte oberhalb der Tabelle (siehe
// parentsCardHtml) und sind hier nicht mehr enthalten. Vollgeschwister
// zählen für "Gleicher Vater" UND "Gleiche Mutter" (sie erfüllen ja
// beide Kriterien) - daher sichtbar, sobald mindestens eines der beiden
// Häkchen gesetzt ist. "Kinder" zeigt nur Generation 1, "Alle
// Nachkommen" zeigt jede Generation (schließt Kinder mit ein).
function filterRelatives(relatives, filters) {
  return relatives.filter((r) => {
    if (r.beziehung === 'Vollgeschwister') return filters.vater || filters.mutter;
    if (r.beziehung === 'Halbgeschwister (väterlicherseits)') return filters.vater;
    if (r.beziehung === 'Halbgeschwister (mütterlicherseits)') return filters.mutter;
    if (r.beziehung === 'Kind') return filters.kinder || filters.nachkommen;
    return filters.nachkommen; // Enkelkind, Urenkelkind, Nachkomme (Generation N)
  });
}

// Nur bei "Alle Verwandtschaft" aktiv: darüber hinaus auch entferntere
// Verwandtschaft (Onkel, Tanten, Cousin, Cousine, ...) - operational
// definiert wie vom Nutzer vorgegeben als "jedes Pferd, das mindestens
// einen Namen mit dem sichtbaren Stammbaum des gewählten Pferds teilt".
// Stammbaum = das Pferd selbst + seine 14 sichtbaren Vorfahren. Pferde,
// die schon über Eltern/Geschwister/Nachkommen gefunden wurden, werden
// über excludeIds nicht doppelt aufgeführt.
function findExtendedRelatives(horse, horses, excludeIds) {
  const ownNames = [horse.name, ...pedigreeAncestorNames(horse)].filter((n) => n && normalizeName(n) !== 'unbekannt');
  const ownNormalized = new Set(ownNames.map(normalizeName));

  const results = [];
  for (const other of horses) {
    if (other.id === horse.id || excludeIds.has(other.id)) continue;
    const otherNames = [other.name, ...pedigreeAncestorNames(other)].filter((n) => n && normalizeName(n) !== 'unbekannt');
    const sharedName = otherNames.find((n) => ownNormalized.has(normalizeName(n)));
    if (sharedName) {
      results.push({ horse: other, beziehung: `Weitere Verwandtschaft (gemeinsam: ${sharedName})`, sortRank: 50 });
    }
  }
  return results;
}

async function loadHorses() {
  const errorEl = document.querySelector('#load-error');
  // Bewusst OHNE ZZL-/Geschlechts-Filter (anders als Zuchtplaner/
  // Turnierplaner) - im Zuchtbuch sollen auch Fohlen ohne ZZL als "Kind"
  // in der Verwandtschaftsübersicht auftauchen.
  const { data, error } = await supabaseClient.from('horses').select(ZUCHTBUCH_FIELDS).order('name');
  if (error) {
    errorEl.textContent =
      'Konnte Pferde nicht laden: ' + error.message +
      ' (falls die Seite ohne Login genutzt wird, muss dafür einmalig die Migration ' +
      '"migration_005_public_read_access.sql" im Supabase-Dashboard ausgeführt worden sein).';
    return;
  }
  allHorses = data || [];

  const owners = [...new Set(allHorses.map((h) => h.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  const ownerSel = document.querySelector('#owner-select');
  ownerSel.innerHTML = '<option value="">Alle</option>';
  for (const owner of owners) {
    const opt = document.createElement('option');
    opt.value = owner;
    opt.textContent = owner;
    ownerSel.appendChild(opt);
  }
  breedFilter.setHorses(allHorses);
  populateHorseSelect();
}

function populateHorseSelect() {
  const owner = document.querySelector('#owner-select').value;
  const filtered = allHorses.filter((h) => (!owner || h.owner === owner) && breedFilter.matches(h));
  horseSelect.setItems(filtered.map((h) => ({ id: h.id, label: h.name || '(ohne Name)' })));
}

function onOwnerChange() {
  populateHorseSelect();
  horseSelect.clear(); // löst onHorseSelect('') aus
}

function onHorseSelect(id) {
  currentHorse = allHorses.find((h) => h.id === id) || null;
  render();
}

// --- Anzeige-Helfer, 1:1 aus MDR-Datenbank/js/list.js portiert, damit die
// Verwandtschafts-Tabelle exakt dieselben Werte wie die Datenbankübersicht
// zeigt (computeDerived, hlpSlpDisplay, zzlDisplay, affectedDiseaseLabels). ---

function computeDerived(h) {
  const gpRaw = h.tournament_potential?.['Gesamtpotenzial'];
  const genes = presentGenesSummary(h.colors, h.coat_color, h.notes);
  return {
    presentGenes: genes.map((g) => g.alleles).join(' '),
    gp: gpRaw != null && gpRaw !== '' ? Number(gpRaw) : null,
    extAvg: averageScore(h.exterior_descriptive, scoreExteriorTerm),
    extPercent: h.exterior_genetics?.overall?.percent ?? null,
    intAvg: averageScore(h.temperament, scoreTemperamentTerm),
  };
}

// EKH-Anzeige: jede Krankheit mit mindestens einem Kleinbuchstaben im Wert
// (Träger ODER voll betroffen) - bewusst NICHT dasselbe wie
// isDiseaseAusgepraegt in tournamentScoring.js (das nur volle Homozygotie
// für die LP-Prüfung zählt). Hier geht es um dieselbe informative Anzeige
// wie in der Datenbankübersicht, nicht um eine Ausschluss-Prüfung.
function isDiseaseClear(value) {
  return !/[a-z]/.test(value || '');
}
function affectedDiseaseLabels(row) {
  return (row.genetic_diseases || []).filter((d) => !isDiseaseClear(d.value)).map((d) => d.label);
}

function hlpSlpDisplay(text) {
  if (!text) return '-';
  const m = text.match(/\d+([.,]\d+)?/);
  return m ? m[0] : '-';
}

function zzlDisplay(breedingAllowed) {
  if (breedingAllowed === true) return 'Ja';
  if (breedingAllowed === false) return 'Nein';
  return '-';
}

// --- Verwandtschafts-Logik ---

// Vater = Position 0, Mutter = Position 1 in pedigreeAncestorNames (fest
// durch die Reihenfolge im Spieltext, siehe js/breeding.js/js/parser.js).
function parentNames(horse) {
  const anc = pedigreeAncestorNames(horse);
  const father = anc[0] && normalizeName(anc[0]) !== 'unbekannt' ? anc[0] : null;
  const mother = anc[1] && normalizeName(anc[1]) !== 'unbekannt' ? anc[1] : null;
  return { father, mother };
}

const GENERATION_LABELS = ['Kind', 'Enkelkind', 'Urenkelkind', 'Ururenkelkind'];
function generationLabel(n) {
  return GENERATION_LABELS[n - 1] || `Nachkomme (Generation ${n})`;
}

// Liefert eine flache Liste { horse, beziehung, sortRank } aller im
// sichtbaren Stammbaum auffindbaren Verwandten von "horse" (Eltern,
// Voll-/Halbgeschwister, Nachkommen über alle Generationen rekursiv).
// Elternschaft ist ausschließlich über Namen im pedigree-Feld auflösbar
// (keine mother_id/father_id in der DB) - Treffer daher immer per
// normalizeName() gegen alle anderen geladenen Pferde.
function findRelatives(horse, horses) {
  const results = [];
  const { father, mother } = parentNames(horse);

  // Voll-/Halbgeschwister: Vollgeschwister-Treffer schließen die
  // Halbgeschwister-Kategorien aus (keine Doppel-Einträge).
  for (const other of horses) {
    if (other.id === horse.id) continue;
    const p = parentNames(other);
    const sameFather = father && p.father && normalizeName(p.father) === normalizeName(father);
    const sameMother = mother && p.mother && normalizeName(p.mother) === normalizeName(mother);
    if (sameFather && sameMother) {
      results.push({ horse: other, beziehung: 'Vollgeschwister', sortRank: 1 });
    } else if (sameFather) {
      results.push({ horse: other, beziehung: 'Halbgeschwister (väterlicherseits)', sortRank: 2 });
    } else if (sameMother) {
      results.push({ horse: other, beziehung: 'Halbgeschwister (mütterlicherseits)', sortRank: 3 });
    }
  }

  // Nachkommen (rekursiv, alle Generationen): Reverse-Index einmal vorab
  // bauen (welche Pferde nennen diesen Namen als Vater/Mutter), dann
  // Breitensuche ab horse.name. Besuchte IDs merken (Zyklenschutz).
  const childrenByParentName = new Map();
  for (const h of horses) {
    const p = parentNames(h);
    for (const parentName of [p.father, p.mother]) {
      if (!parentName) continue;
      const key = normalizeName(parentName);
      if (!childrenByParentName.has(key)) childrenByParentName.set(key, []);
      childrenByParentName.get(key).push(h);
    }
  }

  let frontier = [horse];
  const visited = new Set([horse.id]);
  for (let generation = 1; generation <= 10 && frontier.length; generation++) {
    const next = [];
    for (const parent of frontier) {
      const children = childrenByParentName.get(normalizeName(parent.name)) || [];
      for (const child of children) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        results.push({ horse: child, beziehung: generationLabel(generation), sortRank: 3 + generation });
        next.push(child);
      }
    }
    frontier = next;
  }

  return results;
}

// --- Sortierung (Muster wie js/turnierplaner.js: sortValue/applySort/
// wireSortableHeaders, nulls immer am Ende) ---

function sortValue(row, field) {
  const d = computeDerived(row.horse);
  switch (field) {
    case 'beziehung': return row.sortRank;
    case 'name': return (row.horse.name || '').toLowerCase();
    case 'gender': return (row.horse.gender || '').toLowerCase();
    case 'coat_color': return (row.horse.coat_color || '').toLowerCase();
    case 'owner': return (row.horse.owner || '').toLowerCase();
    case 'gp': return d.gp;
    case 'ext': return d.extAvg;
    case 'extpct': return d.extPercent;
    case 'int': return d.intAvg;
    case 'hlpslp': { const n = Number(hlpSlpDisplay(row.horse.hlp_slp)); return Number.isNaN(n) ? null : n; }
    case 'zzl': return row.horse.breeding_allowed === true ? 1 : row.horse.breeding_allowed === false ? 0 : null;
    default: return null;
  }
}

function applySort(rows) {
  const { field, dir } = currentSort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, field), vb = sortValue(b, field);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string') return va.localeCompare(vb, 'de') * mult;
    return (va - vb) * mult;
  });
}

// Delegiert auf document, da die <th> bei jedem Neu-Rendern der Tabelle
// neu erzeugt werden (kein erneutes Verdrahten pro Render nötig).
function wireSortableHeaders() {
  document.addEventListener('click', (e) => {
    const th = e.target.closest('#relatives-table th[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    if (currentSort.field === field) {
      currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      currentSort = { field, dir: 'asc' };
    }
    render();
  });
}

// --- Rendering ---

function render() {
  const container = document.querySelector('#zuchtbuch-result');
  if (!currentHorse) {
    container.innerHTML = '<p class="muted small">Bitte zuerst ein Pferd auswählen.</p>';
    return;
  }
  let html = horseSummaryHtml(currentHorse);
  html += parentsCardHtml(currentHorse);
  html += relativesTableHtml(currentHorse);
  html += foalTrackingHtml(currentHorse);
  container.innerHTML = html;
}

function findHorseByName(name) {
  if (!name) return null;
  const key = normalizeName(name);
  return allHorses.find((h) => normalizeName(h.name) === key) || null;
}

// Vater/Mutter stehen in einer eigenen Karte oberhalb der Tabelle (auf
// Wunsch des Nutzers nicht mehr als immer sichtbare Tabellenzeilen),
// jeweils mit denselben Werten wie die Pferdekarte selbst.
function parentsCardHtml(horse) {
  const { father, mother } = parentNames(horse);
  return parentCardHtml('Vater', father) + parentCardHtml('Mutter', mother);
}

function parentCardHtml(label, name) {
  if (!name) {
    return `<div class="result-card"><h2>${escapeHtml(label)}</h2><p class="small muted">Unbekannt.</p></div>`;
  }
  const horse = findHorseByName(name);
  if (!horse) {
    return `<div class="result-card"><h2>${escapeHtml(label)}: ${escapeHtml(name)}</h2><p class="small muted">Nicht in der Datenbank.</p></div>`;
  }
  return horseSummaryHtml(horse, label);
}

function horseSummaryHtml(h, label) {
  const d = computeDerived(h);
  const ekh = affectedDiseaseLabels(h);
  const heading = label ? `${escapeHtml(label)}: ${escapeHtml(h.name || '(ohne Name)')}` : escapeHtml(h.name || '(ohne Name)');
  return `<div class="result-card">
    <h2>${heading}</h2>
    <p class="small muted">
      GP: <strong>${d.gp != null ? d.gp : '–'}</strong>
      &nbsp;·&nbsp; Ext: <strong>${d.extAvg != null ? d.extAvg.toFixed(2) : '–'}</strong>
      &nbsp;·&nbsp; Ext%: <strong>${d.extPercent != null ? d.extPercent + '%' : '–'}</strong>
      &nbsp;·&nbsp; Int: <strong>${d.intAvg != null ? d.intAvg.toFixed(2) : '–'}</strong>
      &nbsp;·&nbsp; Genetik: <strong>${d.presentGenes ? escapeHtml(d.presentGenes) : '–'}</strong>
    </p>
    <p class="small muted">
      Geschlecht: <strong>${h.gender ? escapeHtml(h.gender) : '–'}</strong>
      &nbsp;·&nbsp; Farbe: <strong>${h.coat_color ? escapeHtml(h.coat_color) : '–'}</strong>
      &nbsp;·&nbsp; HLP/SLP: <strong>${hlpSlpDisplay(h.hlp_slp)}</strong>
      &nbsp;·&nbsp; ZZL: <strong>${zzlDisplay(h.breeding_allowed)}</strong>
      &nbsp;·&nbsp; EKH: <strong>${ekh.length ? escapeHtml(ekh.join(', ')) : '-'}</strong>
      &nbsp;·&nbsp; Besitzer: <strong>${h.owner ? escapeHtml(h.owner) : '–'}</strong>
    </p>
  </div>`;
}

function relativesTableHtml(horse) {
  const filters = selectedRelativeFilters();
  const allRelatives = findRelatives(horse, allHorses);
  let relatives = filterRelatives(allRelatives, filters);
  if (filters.alle) {
    const { father, mother } = parentNames(horse);
    const parentIds = [findHorseByName(father), findHorseByName(mother)].filter(Boolean).map((h) => h.id);
    const excludeIds = new Set([horse.id, ...parentIds, ...allRelatives.map((r) => r.horse.id)]);
    relatives = relatives.concat(findExtendedRelatives(horse, allHorses, excludeIds));
  }
  relatives = applySort(relatives);

  let html = '<div class="group-heading">Verwandtschaftsübersicht</div>';
  if (!relatives.length) {
    html += allRelatives.length
      ? '<p class="small muted">Keine Verwandten mit den aktuell aktivierten Kategorien - oben weitere Häkchen setzen.</p>'
      : '<p class="small muted">Keine Verwandten im sichtbaren Stammbaum gefunden.</p>';
    return html;
  }
  html += `<div class="table-wrap"><table id="relatives-table">
    <thead><tr>
      <th data-sort="beziehung">Beziehung</th>
      <th data-sort="name">Name</th>
      <th data-sort="gender">Geschlecht</th>
      <th data-sort="coat_color">Farbe</th>
      <th>Genetik</th>
      <th data-sort="gp">GP</th>
      <th data-sort="ext">Ext</th>
      <th data-sort="extpct">Ext%</th>
      <th data-sort="int">Int</th>
      <th data-sort="hlpslp">HLP/SLP</th>
      <th data-sort="zzl">ZZL</th>
      <th>EKH</th>
      <th data-sort="owner">Besitzer</th>
    </tr></thead>
    <tbody>${relatives.map(relativeRowHtml).join('')}</tbody>
  </table></div>`;
  return html;
}

function relativeRowHtml(r) {
  const h = r.horse;
  const d = computeDerived(h);
  const ekh = affectedDiseaseLabels(h);
  return `<tr>
    <td data-label="Beziehung">${escapeHtml(r.beziehung)}</td>
    <td data-label="Name">${escapeHtml(h.name || '(ohne Name)')}</td>
    <td data-label="Geschlecht">${escapeHtml(h.gender || '')}</td>
    <td data-label="Farbe">${escapeHtml(h.coat_color || '')}</td>
    <td data-label="Genetik" class="small" style="font-family: ui-monospace, monospace;">${escapeHtml(d.presentGenes)}</td>
    <td data-label="GP">${d.gp != null ? d.gp : ''}</td>
    <td data-label="Ext">${d.extAvg != null ? d.extAvg.toFixed(2) : ''}</td>
    <td data-label="Ext%">${d.extPercent != null ? d.extPercent + '%' : ''}</td>
    <td data-label="Int">${d.intAvg != null ? d.intAvg.toFixed(2) : ''}</td>
    <td data-label="HLP/SLP">${hlpSlpDisplay(h.hlp_slp)}</td>
    <td data-label="ZZL">${zzlDisplay(h.breeding_allowed)}</td>
    <td data-label="EKH">${ekh.length ? escapeHtml(ekh.join(', ')) : '-'}</td>
    <td data-label="Besitzer">${h.owner ? escapeHtml(h.owner) : ''}</td>
  </tr>`;
}

// Fohlen-Vorhersage vs. Realität - bewusst NUR GP und Int (Ext/Ext% auf
// Wunsch ausgeschlossen, siehe Plan). Nur sichtbar, wenn beide Eltern
// selbst als Datensatz auflösbar sind. Nutzt dieselbe Best-/Worst-Case-
// Berechnung wie der Verpaarungsratgeber (js/verpaarung.js) - Parameter
// mare/stallion sind dort geschlechtsneutral.
function foalTrackingHtml(horse) {
  const { father, mother } = parentNames(horse);
  if (!father || !mother) return '';
  const byName = new Map(allHorses.map((h) => [normalizeName(h.name), h]));
  const fatherHorse = byName.get(normalizeName(father));
  const motherHorse = byName.get(normalizeName(mother));
  if (!fatherHorse || !motherHorse) return '';

  const gp = estimateFoalGP(motherHorse, fatherHorse);
  const int = interieurFoalRange(motherHorse, fatherHorse);
  if (gp.gpBest == null && int.intBest == null) return '';

  const d = computeDerived(horse);

  let html = '<div class="group-heading">Fohlen-Vorhersage vs. Realität</div>';
  html += '<div class="result-card">';
  html += verdictRowHtml('GP', d.gp, gp.gpBest, gp.gpWorst, (v) => Math.round(v));
  html += verdictRowHtml('Int', d.intAvg, int.intBest, int.intWorst, (v) => v.toFixed(2));
  html += '<p class="small muted">⚠️ GP und Int sind noch grobe Schätzwerte – dieser Vergleich hilft, die Formeln mit der Zeit zu überprüfen, ist selbst aber noch keine gesicherte Aussage.</p>';
  html += '</div>';
  return html;
}

function verdictRowHtml(label, actual, best, worst, fmt) {
  if (actual == null || best == null || worst == null) {
    return `<p class="small muted">${escapeHtml(label)}: nicht genug Daten für einen Vergleich.</p>`;
  }
  const lo = Math.min(best, worst), hi = Math.max(best, worst);
  const inRange = actual >= lo && actual <= hi;
  const verdict = inRange
    ? '<span style="color:var(--success)">✓ im vorhergesagten Bereich</span>'
    : '<span style="color:var(--danger)">✗ außerhalb des vorhergesagten Bereichs</span>';
  return `<p class="small">${escapeHtml(label)}: tatsächlich <strong>${fmt(actual)}</strong>, vorhergesagt <strong>${fmt(lo)}–${fmt(hi)}</strong> - ${verdict}</p>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
