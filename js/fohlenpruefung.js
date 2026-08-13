// Fohlenprüfung + Aussortierhilfe: ein Werkzeug, zwei Reiter. Dieselbe
// Pferdeauswahl gilt für beide - ein Pferd wird im Reiter "Fohlenprüfung"
// als Fohlen betrachtet (Werte-/Farbvergleich mit Eltern und Voll-/
// Halbgeschwistern, Turnierwerte + LP-Prognose), im Reiter
// "Aussortierhilfe" als (potenzieller) Elternteil (eigene Fohlen,
// Werte-Vergleich, Besitzer-Verbleib). Nutzt js/parser.js, js/breeding.js,
// js/tournamentScoring.js, js/verpaarung.js, js/searchableSelect.js,
// js/breedFilter.js - muss also nach diesen Scripts eingebunden werden.

const FOHLENPRUEFUNG_FIELDS =
  'id,name,owner,gender,coat_color,colors,notes,pedigree,tournament_potential,exterior_genetics,exterior_descriptive,temperament,traits,disciplines,genetic_diseases,hlp_slp,breeding_allowed,breed,purebred_pct,tags,birthdate';

// Genau die vom Nutzer genannten 9 "Sondergene" (aus COLOR_WISH_OPTIONS in
// js/verpaarung.js gefiltert) - zeigen, wie "ausgefallen" eine Farbe ist
// und ob sie sich auf einen Elternteil zurückführen lässt. Roan/Dun/Grey/
// Appaloosa bleiben hier bewusst außen vor (nicht vom Nutzer genannt).
const SPECIAL_COLOR_LABELS = ['Champagne', 'Silver', 'Pearl (pl)', 'Flaxen (sichtbar)', 'Cream', 'Tobiano', 'Splashed', 'Sabino', 'Overo'];
const SPECIAL_COLOR_WISHES = COLOR_WISH_OPTIONS.filter((o) => SPECIAL_COLOR_LABELS.includes(o.label));

// Höher = besser für GP/Ext%, niedriger = besser für Ext/Int (1=exzellent
// ... 5=miserabel-Skala) - dieselbe Zuordnung wie SCHWERPUNKT_HIGHER_IS_BETTER
// in js/verpaarung.js (dort nicht exportiert, hier lokal dupliziert, da nur
// die Boolean-Zuordnung selbst gebraucht wird).
const METRIC_HIGHER_IS_BETTER = { gp: true, ext: false, extpct: true, int: false };

// Dieselben Schwellen wie in js/zuchtplaner.js (MAX_BREEDING_AGE/
// BREEDING_AGE_WARNING) - hier nur als Hinweis, keine Auswahl-Beschränkung
// (diese Seite hat bewusst keinen ZZL-/Alters-Zwang).
const MAX_BREEDING_AGE = 25;
const BREEDING_AGE_WARNING = 24;

let allHorses = [];
let horseSelect;
let breedFilter;
let currentHorse = null;
let activeTab = 'fohlenpruefung';
let flaxenLookup = null;
let flaxenChildrenByName = null;
let childrenByParentName = new Map();

// Unabhängige Sortierzustände je Tabelle (Werte-Vergleich, Turnierwerte,
// Fohlen-vs-Elternteil) - Muster wie js/turnierplaner.js/js/zuchtbuch.js,
// hier über eine gemeinsame kleine Hilfsfunktion (siehe wireTableSort).
let valueSort = { field: 'gp', dir: 'desc' };
let tournamentSort = { field: 'category', dir: 'asc' };
let foalsSort = { field: 'gp', dir: 'desc' };

document.addEventListener('DOMContentLoaded', init);

async function init() {
  wireTabButtons();
  horseSelect = createSearchableSelect(
    document.querySelector('#horse-search'), document.querySelector('#horse-panel'),
    { onChange: onHorseSelect },
  );
  breedFilter = createBreedFilter(document.querySelector('#breed-drop'), { onChange: populateHorseSelect });
  document.querySelector('#owner-select').addEventListener('change', onOwnerChange);
  wireTableSort('value-table', (field) => { valueSort = nextSort(valueSort, field, field === 'gp' || field === 'extpct'); renderFohlenTab(); });
  wireTableSort('tournament-table', (field) => { tournamentSort = nextSort(tournamentSort, field, false); renderFohlenTab(); });
  wireTableSort('foals-table', (field) => { foalsSort = nextSort(foalsSort, field, field === 'gp' || field === 'extpct'); renderAussortierenTab(); });
  wireTagSuggestHandlers('Fohlenprüfung');
  await initAuthStatus();
  await loadHorses();
  activateTabFromUrl();
}

async function loadHorses() {
  const errorEl = document.querySelector('#load-error');
  const { data, error } = await supabaseClient.from('horses').select(FOHLENPRUEFUNG_FIELDS).order('name');
  if (error) {
    errorEl.textContent =
      'Konnte Pferde nicht laden: ' + error.message +
      ' (falls die Seite ohne Login genutzt wird, muss dafür einmalig die Migration ' +
      '"migration_005_public_read_access.sql" im Supabase-Dashboard ausgeführt worden sein).';
    return;
  }
  allHorses = data || [];

  // Reverse-Index (wer nennt diesen Namen als Vater/Mutter) - für
  // Aussortierhilfe (eigene Fohlen) UND für die Flaxen-Trägerschaft über
  // Nachkommen (siehe hasFlaxenTrait in js/verpaarung.js) - derselbe
  // Bestand deckt beides ab.
  childrenByParentName = new Map();
  flaxenLookup = new Map();
  for (const h of allHorses) {
    const key = normalizeName(h.name);
    if (key && !flaxenLookup.has(key)) flaxenLookup.set(key, h);
  }
  for (const h of allHorses) {
    const { father, mother } = parentNames(h);
    for (const parentName of [father, mother]) {
      if (!parentName) continue;
      const key = normalizeName(parentName);
      if (!childrenByParentName.has(key)) childrenByParentName.set(key, []);
      childrenByParentName.get(key).push(h);
    }
  }
  flaxenChildrenByName = childrenByParentName;

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
  renderFohlenTab();
  renderAussortierenTab();
}

// --- Reiter-Umschaltung ---

function wireTabButtons() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
}

function activateTabFromUrl() {
  const requestedTab = new URLSearchParams(window.location.search).get('tab');
  if (requestedTab && document.querySelector(`.tab-btn[data-tab="${requestedTab}"]`)) {
    activateTab(requestedTab);
  }
}

function activateTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelector('#tab-fohlenpruefung').hidden = activeTab !== 'fohlenpruefung';
  document.querySelector('#tab-aussortierhilfe').hidden = activeTab !== 'aussortierhilfe';
}

// --- Sortier-Hilfsfunktionen (gemeinsam für alle 3 Tabellen dieser Seite) ---

function nextSort(current, field, descFirst) {
  if (current.field === field) return { field, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { field, dir: descFirst ? 'desc' : 'asc' };
}

// Delegiert auf document (Tabellen werden bei jedem Rendern neu erzeugt) -
// scoped auf die jeweilige Tabellen-ID, damit die drei Sortierzustände
// dieser Seite sich nicht gegenseitig auslösen.
function wireTableSort(tableId, onSort) {
  document.addEventListener('click', (e) => {
    const th = e.target.closest(`#${tableId} th[data-sort]`);
    if (!th) return;
    onSort(th.dataset.sort);
  });
}

function sortArrow(sort, field) {
  return sort.field === field ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
}

// Fehlende Werte landen immer am Ende, unabhängig von der Richtung
// (Muster wie überall sonst in diesem Repo).
function applySort(rows, sort, getValue) {
  const mult = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = getValue(a, sort.field);
    const vb = getValue(b, sort.field);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string') return va.localeCompare(vb, 'de') * mult;
    return (va - vb) * mult;
  });
}

// --- Stammbaum-Hilfsfunktionen (1:1 aus js/zuchtbuch.js/js/fohlen-tracker.js) ---

function parentNames(horse) {
  const anc = pedigreeAncestorNames(horse);
  const father = anc[0] && normalizeName(anc[0]) !== 'unbekannt' ? anc[0] : null;
  const mother = anc[1] && normalizeName(anc[1]) !== 'unbekannt' ? anc[1] : null;
  return { father, mother };
}

function findHorseByName(name) {
  if (!name) return null;
  const key = normalizeName(name);
  return allHorses.find((h) => normalizeName(h.name) === key) || null;
}

// Nur Voll-/Halbgeschwister (kein rekursiver Nachkommen-Aufbau nötig,
// anders als in js/zuchtbuch.js) - Vollgeschwister-Treffer schließen die
// Halbgeschwister-Kategorien aus.
function findSiblings(horse, horses) {
  const results = [];
  const { father, mother } = parentNames(horse);
  if (!father && !mother) return results;
  for (const other of horses) {
    if (other.id === horse.id) continue;
    const p = parentNames(other);
    const sameFather = father && p.father && normalizeName(p.father) === normalizeName(father);
    const sameMother = mother && p.mother && normalizeName(p.mother) === normalizeName(mother);
    if (sameFather && sameMother) {
      results.push({ horse: other, beziehung: 'Vollgeschwister' });
    } else if (sameFather) {
      results.push({ horse: other, beziehung: 'Halbgeschwister (Vater)' });
    } else if (sameMother) {
      results.push({ horse: other, beziehung: 'Halbgeschwister (Mutter)' });
    }
  }
  return results;
}

// Zeilen für Werte-/Farbvergleich: Fohlen selbst (Referenz) + Vater/Mutter
// (falls Name bekannt - "resolved: false" wenn der Name zwar bekannt, das
// Pferd aber nicht in der Datenbank auflösbar ist) + Voll-/Halbgeschwister.
function buildRelativeRows(horse) {
  const { father, mother } = parentNames(horse);
  const rows = [{ label: 'Fohlen', horse, resolved: true, isReference: true }];
  if (father) {
    const fatherHorse = findHorseByName(father);
    rows.push({ label: 'Vater', horse: fatherHorse, resolved: !!fatherHorse, name: father });
  }
  if (mother) {
    const motherHorse = findHorseByName(mother);
    rows.push({ label: 'Mutter', horse: motherHorse, resolved: !!motherHorse, name: mother });
  }
  for (const s of findSiblings(horse, allHorses)) {
    rows.push({ label: s.beziehung, horse: s.horse, resolved: true });
  }
  return rows;
}

// --- Färbung Werte-Vergleich (Nutzerwunsch: grün=besser, rot=schlechter,
// gelb=gleich, je Metrik-Richtung wie SCHWERPUNKT_HIGHER_IS_BETTER) ---

function compareColor(value, reference, metric) {
  if (value == null || reference == null) return '';
  // Gelb war auf dem hellblauen Hintergrund kaum von der unmarkierten
  // Referenzzeile zu unterscheiden (Nutzer-Feedback) - stattdessen die
  // normale (theme-abhängige) Textfarbe, bleibt aber fett wie grün/rot.
  if (value === reference) return 'var(--text)';
  const higherIsBetter = METRIC_HIGHER_IS_BETTER[metric];
  const better = higherIsBetter ? value > reference : value < reference;
  return better ? 'var(--success)' : 'var(--danger)';
}

function fmt(v, digits) {
  return v == null ? '–' : v.toFixed(digits);
}

// EKH-Anzeige: jede Krankheit, bei der mindestens ein Allel nicht "NN" ist
// (Träger ODER voll betroffen) - 1:1 aus js/zuchtbuch.js portiert, damit
// dieselbe informative Anzeige wie in der Datenbankübersicht erscheint
// (NICHT dasselbe wie isDiseaseAusgepraegt in js/tournamentScoring.js, das
// für die LP-Prüfung nur volle Homozygotie zählt).
function affectedDiseaseLabels(horse) {
  return (horse.genetic_diseases || []).filter((d) => isDiseaseCarrierOrAffected(d.value)).map((d) => d.label);
}

// Alters-Hinweis, 1:1 aus ageWarningHtml in js/zuchtplaner.js übernommen
// (gleiche Schwellen/gleicher Text), hier ohne Auswahl-Ausschluss - nur ein
// Hinweis in der Aussortierhilfe, da ein altes Zuchttier der Kernfall für
// "sollte es weiter in der Zucht bleiben?" ist.
function ageWarningHtml(horse) {
  const years = gameAgeYears(horse.birthdate);
  if (years == null || years < BREEDING_AGE_WARNING) return '';
  return `<div class="notice notice-caution">⚠️ ${escapeHtml(horse.name || 'Dieses Pferd')} ist ${years} Spieljahre alt - ab ${MAX_BREEDING_AGE} Jahren nicht mehr in der Zuchtplaner-Auswahl.</div>`;
}

// Kurze Werte-Zeile direkt unter dem Pferdenamen (wie parentSummaryHtml in
// js/zuchtplaner.js) - zeigt die eigenen Werte, Farbe/Genetik, Alter und
// EKH (falls vorhanden) des oben gewählten Pferdes auf einen Blick,
// unabhängig von seiner Rolle (Referenzzeile) in der Vergleichstabelle
// darunter.
function horseStatsLineHtml(horse) {
  const extpct = horseExtPct(horse);
  const genes = presentGenesSummary(horse.colors, horse.coat_color, horse.notes, horse.name);
  const genetik = genes.map((g) => g.alleles).join(' ');
  const ekh = affectedDiseaseLabels(horse);
  const age = horse.birthdate ? formatAge(horse.birthdate) : '';
  return `<p class="small muted">
    GP: <strong>${fmt(horseGP(horse), 0)}</strong>
    &nbsp;·&nbsp; Ext: <strong>${fmt(horseExt(horse), 2)}</strong>
    &nbsp;·&nbsp; Ext%: <strong>${extpct != null ? extpct.toFixed(1) + '%' : '–'}</strong>
    &nbsp;·&nbsp; Int: <strong>${fmt(horseInt(horse), 2)}</strong>
    &nbsp;·&nbsp; Genetik: <strong>${genetik ? escapeHtml(genetik) : '–'}</strong>
  </p>
  <p class="small muted">
    Geschlecht: <strong>${horse.gender ? escapeHtml(horse.gender) : '–'}</strong>
    &nbsp;·&nbsp; Farbe: <strong>${horse.coat_color ? escapeHtml(horse.coat_color) : '–'}</strong>
    &nbsp;·&nbsp; Alter: <strong>${age || '–'}</strong>${ekh.length ? ` &nbsp;·&nbsp; EKH: <strong style="color:var(--danger);">${escapeHtml(ekh.join(', '))}</strong>` : ''}
    &nbsp;·&nbsp; Besitzer: <strong>${horse.owner ? escapeHtml(horse.owner) : '–'}</strong>
  </p>`;
}

// Schlagwort-Zuweisung je Tabellenzeile (Nutzerwunsch) - nutzt dieselbe
// tagSuggestButtonHtml wie überall sonst in MDR-Planer, hier aber
// stillschweigend leer, wenn kein Pferd/kein Login/keine Besitzerschaft
// vorliegt (statt des Hinweistexts für Gäste) - sonst würde der
// "nur für eingeloggte Nutzer"-Hinweis in JEDER Tabellenzeile wiederholt.
// Der einmalige Hinweis oben unter dem Pferdenamen (siehe renderFohlenTab/
// renderAussortierenTab) erklärt das bereits.
function rowTagSuggestHtml(horse) {
  if (!horse || !isLoggedIn() || !isOwnerOf(horse.owner)) return '';
  return tagSuggestButtonHtml(horse.id, horse.owner);
}

// Gemeinsame Tabelle für "Werte im Vergleich" (Fohlenprüfung: Fohlen vs.
// Eltern/Geschwister) UND "Werte-Vergleich Kinder vs. Elternteil"
// (Aussortierhilfe) - referenceHorse liefert die Vergleichsbasis für die
// Einfärbung, die Referenzzeile selbst wird nicht eingefärbt. Optionales
// "ownerHighlight" (nur Aussortierhilfe): markiert Zeilen, deren Besitzer
// mit dem übergebenen Namen übereinstimmt, direkt in einer eigenen
// Besitzer-Spalte statt in separaten Listen darunter.
function valueComparisonTableHtml(tableId, rows, referenceHorse, sort, ownerHighlight) {
  const data = rows.map((r) => ({
    ...r,
    gender: r.horse ? r.horse.gender : null,
    owner: r.horse ? r.horse.owner : null,
    ekh: r.horse ? affectedDiseaseLabels(r.horse) : [],
    gp: r.horse ? horseGP(r.horse) : null,
    ext: r.horse ? horseExt(r.horse) : null,
    extpct: r.horse ? horseExtPct(r.horse) : null,
    int: r.horse ? horseInt(r.horse) : null,
    // Erwarteter Inzuchtkoeffizient eines hypothetischen gemeinsamen
    // Fohlens von referenceHorse und dieser Zeile (Wright'sche
    // Pfad-Methode über den gesamten Bestand, siehe estimateRelatedness in
    // js/breeding.js) - z.B. Fohlenprüfung: referenceHorse=Fohlen,
    // Zeile=Vater/Mutter/Geschwister (Vater/Mutter erwartungsgemäß 25%,
    // ein hypothetisches Rück-Fohlen mit dem eigenen Elternteil wäre so
    // stark eingezüchtet wie eines aus Vollgeschwister-Verpaarung).
    coiPct: r.horse ? estimateRelatedness(referenceHorse, r.horse, allHorses) : null,
  }));
  const ref = { gp: horseGP(referenceHorse), ext: horseExt(referenceHorse), extpct: horseExtPct(referenceHorse), int: horseInt(referenceHorse) };

  const sorted = applySort(data, sort, (row, field) => row[field]);

  const rowsHtml = sorted.map((row) => {
    const isRef = row.horse && referenceHorse && row.horse.id === referenceHorse.id;
    const name = row.horse ? (row.horse.name || '(ohne Name)') : `${row.name || ''} (nicht in der Datenbank)`;
    const cell = (metric, digits) => {
      const v = row[metric];
      const color = !row.resolved || isRef ? '' : compareColor(v, ref[metric], metric);
      return `<td data-label="${metric}" style="${color ? `color:${color}; font-weight:600;` : ''}">${fmt(v, digits)}</td>`;
    };
    let ownerCell = '';
    if (ownerHighlight !== undefined) {
      const matches = row.horse && (row.owner || null) === (ownerHighlight || null);
      const style = matches ? 'background:rgba(107,157,0,0.15); font-weight:600;' : '';
      ownerCell = `<td data-label="Besitzer" style="${style}">${row.owner ? escapeHtml(row.owner) : '–'}${matches ? ' ✓' : ''}</td>`;
    }
    return `<tr${isRef ? ' style="font-weight:600;"' : ''}>
      <td data-label="Beziehung">${escapeHtml(row.label)}</td>
      <td data-label="Name" class="name-with-tags">${escapeHtml(name)}${row.horse ? tagsBadgesHtml(row.horse.tags) : ''}</td>
      <td data-label="Verwandtschaftsgrad">${row.coiPct != null ? row.coiPct.toFixed(1) + '%' : '–'}</td>
      <td data-label="Geschlecht">${row.gender ? escapeHtml(row.gender) : '–'}</td>
      <td data-label="EKH" style="${row.ekh.length ? 'color:var(--danger); font-weight:600;' : ''}">${row.ekh.length ? escapeHtml(row.ekh.join(', ')) : '–'}</td>
      ${ownerCell}
      ${cell('gp', 0)}
      ${cell('ext', 2)}
      ${cell('extpct', 1)}
      ${cell('int', 2)}
      <td data-label="Schlagwort">${rowTagSuggestHtml(row.horse)}</td>
    </tr>`;
  }).join('');

  const ownerHeader = ownerHighlight !== undefined ? `<th data-sort="owner">Besitzer${sortArrow(sort, 'owner')}</th>` : '';
  return `<div class="table-wrap"><table id="${tableId}">
    <thead><tr>
      <th>Beziehung</th>
      <th>Name</th>
      <th data-sort="coiPct" title="Erwarteter Inzuchtkoeffizient eines hypothetischen gemeinsamen Fohlens (Wright'sche Pfad-Methode über den gesamten Bestand)">Verwandtschaftsgrad${sortArrow(sort, 'coiPct')}</th>
      <th data-sort="gender">Geschlecht${sortArrow(sort, 'gender')}</th>
      <th>EKH</th>
      ${ownerHeader}
      <th data-sort="gp">GP${sortArrow(sort, 'gp')}</th>
      <th data-sort="ext">Ext${sortArrow(sort, 'ext')}</th>
      <th data-sort="extpct">Ext%${sortArrow(sort, 'extpct')}</th>
      <th data-sort="int">Int${sortArrow(sort, 'int')}</th>
      <th>Schlagwort</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>`;
}

// --- Farbvergleich (die 9 vom Nutzer genannten Sondergene) ---

function colorComparisonTableHtml(rows) {
  const cells = (row) => SPECIAL_COLOR_WISHES.map((wish) => {
    const has = row.horse ? colorWishPossible(row.horse, wish, flaxenLookup, flaxenChildrenByName) : false;
    return `<td data-label="${escapeHtml(wish.label)}" style="text-align:center; ${has ? `color:${'var(--success)'}; font-weight:700;` : 'opacity:0.4;'}">${has ? '✓' : '–'}</td>`;
  }).join('');

  const rowsHtml = rows.map((row) => {
    const name = row.horse ? (row.horse.name || '(ohne Name)') : `${row.name || ''} (nicht in der Datenbank)`;
    return `<tr${row.isReference ? ' style="font-weight:600;"' : ''}>
      <td data-label="Beziehung">${escapeHtml(row.label)}</td>
      <td data-label="Name">${escapeHtml(name)}</td>
      ${cells(row)}
    </tr>`;
  }).join('');

  const header = SPECIAL_COLOR_WISHES.map((w) => `<th>${escapeHtml(w.label)}</th>`).join('');
  return `<div class="table-wrap"><table>
    <thead><tr><th>Beziehung</th><th>Name</th>${header}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>`;
}

// "X von Y Sondergenen von einem Elternteil bekannt" - Y = beim Fohlen
// vorhandene Sondergene, X = davon bei Vater und/oder Mutter ebenfalls
// vorhanden (nur Zeilen mit resolved:true zählen als "bekannt").
function colorInheritanceSummary(rows) {
  const foalRow = rows.find((r) => r.isReference);
  if (!foalRow || !foalRow.horse) return '';
  const parentRows = rows.filter((r) => (r.label === 'Vater' || r.label === 'Mutter') && r.resolved && r.horse);

  const present = SPECIAL_COLOR_WISHES.filter((wish) => colorWishPossible(foalRow.horse, wish, flaxenLookup, flaxenChildrenByName));
  if (!present.length) {
    return '<p class="small muted">Keines der geprüften Sondergene (Champagne/Silver/Pearl/Flaxen/Cream/Tobiano/Splashed/Sabino/Overo) beim Fohlen bekannt.</p>';
  }
  const traceable = present.filter((wish) => parentRows.some((p) => colorWishPossible(p.horse, wish, flaxenLookup, flaxenChildrenByName)));
  return `<p class="small">
    <strong>${traceable.length} von ${present.length}</strong> beim Fohlen vorhandene Sondergene lassen sich auf Vater und/oder Mutter zurückführen
    (${escapeHtml(present.map((w) => w.label).join(', '))}).
  </p>`;
}

// Gegenrichtung für die Aussortierhilfe: nicht "woher hat das Fohlen sein
// Sondergen", sondern "wie viele der eigenen Fohlen haben je Sondergen des
// Elternteils ebenfalls dieses Gen" - je Sondergen des Elternteils eine
// Quote. Bewusst KEINE Kausalitätsaussage ("vererbt von diesem Elternteil"),
// da ein Fohlen das Gen theoretisch auch vom anderen Elternteil haben
// könnte - nur die reine Vorkommensquote unter den eigenen Fohlen.
function colorPassOnSummary(parentHorse, foals) {
  const present = SPECIAL_COLOR_WISHES.filter((wish) => colorWishPossible(parentHorse, wish, flaxenLookup, flaxenChildrenByName));
  if (!present.length) {
    return '<p class="small muted">Elternteil trägt keines der geprüften Sondergene (Champagne/Silver/Pearl/Flaxen/Cream/Tobiano/Splashed/Sabino/Overo).</p>';
  }
  const items = present.map((wish) => {
    const count = foals.filter((f) => colorWishPossible(f, wish, flaxenLookup, flaxenChildrenByName)).length;
    const pct = foals.length ? Math.round((count / foals.length) * 100) : 0;
    return `<li>${escapeHtml(wish.label)}: <strong>${count} von ${foals.length}</strong> Fohlen (${pct}%)</li>`;
  }).join('');
  return `<p class="small">Sondergene des Elternteils - wie viele Fohlen haben dasselbe Gen ebenfalls:</p><ul class="small">${items}</ul>`;
}

// Analog zu colorPassOnSummary, aber für Erbkrankheiten (EKH) - zeigt je
// Krankheit des Elternteils, wie viele Fohlen ebenfalls Träger/betroffen
// sind (isDiseaseCarrierOrAffected, wie in affectedDiseaseLabels), als
// grobe Einschätzung für die Weiterzucht-Entscheidung.
function diseaseInheritanceSummary(parentHorse, foals) {
  const parentDiseases = affectedDiseaseLabels(parentHorse);
  if (!parentDiseases.length) return '';
  const items = parentDiseases.map((label) => {
    const count = foals.filter((f) => affectedDiseaseLabels(f).includes(label)).length;
    const pct = foals.length ? Math.round((count / foals.length) * 100) : 0;
    return `<li>${escapeHtml(label)}: <strong>${count} von ${foals.length}</strong> Fohlen (${pct}%) Träger oder betroffen</li>`;
  }).join('');
  return `<div class="group-heading">Erbkrankheiten (EKH) im Vergleich</div>
    <p class="small">Erbkrankheiten des Elternteils - wie viele Fohlen tragen dieselbe(n) ebenfalls:</p>
    <ul class="small">${items}</ul>`;
}

// --- Turnierwerte + LP (1:1 aus js/turnierplaner.js) ---

function tournamentRowHtml(v) {
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

function tournamentSectionHtml(horse) {
  const values = computeTournamentValues(horse);
  const lp = checkLP(horse);
  let html = '<div class="group-heading">Turnierwerte + LP-Prognose</div>';
  html += lpResultHtml(lp);
  if (!values.length) {
    html += '<p class="small muted">Keine Turnierdaten für dieses Pferd vorhanden.</p>';
    return html;
  }
  const sorted = applySort(values, tournamentSort, tournamentSortValue);
  html += `<div class="table-wrap"><table id="tournament-table">
    <thead><tr>
      <th data-sort="category">Kategorie${sortArrow(tournamentSort, 'category')}</th>
      <th data-sort="name">Disziplin${sortArrow(tournamentSort, 'name')}</th>
      <th data-sort="wert">Wert${sortArrow(tournamentSort, 'wert')}</th>
      <th data-sort="interieur">Interieur${sortArrow(tournamentSort, 'interieur')}</th>
      <th data-sort="lk">LK${sortArrow(tournamentSort, 'lk')}</th>
    </tr></thead>
    <tbody>${sorted.map(tournamentRowHtml).join('')}</tbody>
  </table></div>`;
  return html;
}

// --- Reiter 1: Fohlenprüfung ---

function renderFohlenTab() {
  const container = document.querySelector('#fohlen-result');
  if (!currentHorse) {
    container.innerHTML = '<p class="muted small">Bitte zuerst ein Pferd auswählen.</p>';
    return;
  }

  const rows = buildRelativeRows(currentHorse);
  const { father, mother } = parentNames(currentHorse);

  let html = `<h2 class="name-with-tags">${escapeHtml(currentHorse.name || '(ohne Name)')}${tagsBadgesHtml(currentHorse.tags)}</h2>`;
  html += horseStatsLineHtml(currentHorse);
  html += `<p class="small">${tagSuggestButtonHtml(currentHorse.id, currentHorse.owner)}</p>`;
  if (!father && !mother) {
    html += '<p class="small muted">Kein Vater/Mutter-Name im sichtbaren Stammbaum bekannt - Werte-/Farbvergleich nicht möglich.</p>';
  } else {
    html += '<div class="group-heading">Werte im Vergleich zu Eltern und Geschwistern</div>';
    html += '<p class="small muted">Vergleich gegen die eigenen Werte des Pferds oben - grün (besser), rot (schlechter) oder schwarz (gleich).</p>';
    html += valueComparisonTableHtml('value-table', rows.filter((r) => !r.isReference), currentHorse, valueSort);

    html += '<div class="group-heading">Farbvergleich (Sondergene)</div>';
    html += colorInheritanceSummary(rows);
    html += colorComparisonTableHtml(rows);
  }

  html += tournamentSectionHtml(currentHorse);
  container.innerHTML = html;
}

// --- Reiter 2: Aussortierhilfe ---

function renderAussortierenTab() {
  const container = document.querySelector('#aussortieren-result');
  if (!currentHorse) {
    container.innerHTML = '<p class="muted small">Bitte zuerst ein Pferd auswählen.</p>';
    return;
  }

  const foals = childrenByParentName.get(normalizeName(currentHorse.name)) || [];
  let html = `<h2 class="name-with-tags">${escapeHtml(currentHorse.name || '(ohne Name)')}${tagsBadgesHtml(currentHorse.tags)}</h2>`;
  html += horseStatsLineHtml(currentHorse);
  html += ageWarningHtml(currentHorse);
  html += `<p class="small">${tagSuggestButtonHtml(currentHorse.id, currentHorse.owner)}</p>`;
  html += `<div class="group-heading">${foals.length} Fohlen gefunden</div>`;

  if (!foals.length) {
    html += '<p class="small muted">Noch keine Fohlen im sichtbaren Stammbaum der übrigen Pferde gefunden.</p>';
    container.innerHTML = html;
    return;
  }

  const owner = currentHorse.owner || null;
  const stillOwned = foals.filter((f) => (f.owner || null) === owner);
  html += `<p class="small muted">Vergleich gegen die eigenen Werte des Elternteils oben - grün (besser), rot (schlechter) oder schwarz (gleich). Die Besitzer-Spalte markiert Fohlen, die noch beim aktuellen Besitzer (${owner ? escapeHtml(owner) : 'unbekannt'}) sind (<strong>${stillOwned.length} von ${foals.length}</strong>).</p>`;

  // Zusätzlich zur Zählung gegen den Besitzer DES AUSGEWÄHLTEN PFERDES
  // (oben) auch gegen das eigene, eingeloggte Konto zählen, falls das ein
  // ANDERES Konto ist - z.B. beim Durchsehen eines fremden Hengstes, um zu
  // sehen, wie viele seiner Fohlen bei einem selbst gelandet sind.
  const myIdentity = currentIdentity();
  if (myIdentity && (!owner || myIdentity.toLowerCase() !== owner.toLowerCase())) {
    const mine = foals.filter((f) => (f.owner || '').toLowerCase() === myIdentity.toLowerCase());
    html += `<p class="small muted">Davon <strong>${mine.length} von ${foals.length}</strong> bei Ihnen (${escapeHtml(myIdentity)}).</p>`;
  }

  const rows = foals.map((f) => ({ label: 'Fohlen', horse: f, resolved: true }));
  html += valueComparisonTableHtml('foals-table', rows, currentHorse, foalsSort, owner);

  html += '<div class="group-heading">Farbvergleich (Sondergene)</div>';
  html += colorPassOnSummary(currentHorse, foals);
  html += colorComparisonTableHtml([{ label: 'Ausgewähltes Pferd', horse: currentHorse, isReference: true }, ...rows]);

  html += diseaseInheritanceSummary(currentHorse, foals);

  container.innerHTML = html;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
