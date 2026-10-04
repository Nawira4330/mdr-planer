// Fohlen-Tracker: filterbare Übersichtstabelle mit Verwandten-Zählung je
// Pferd (aufklappbar zu den eigenen Fohlen), als zweiter Reiter eine
// Top 20 der Pferde mit den meisten Fohlen. Eigenständige Seite (kein
// gemeinsamer Reiter mit Zuchtbuch/Aussortierhilfe, auf Nutzerwunsch
// getrennt). Elternschaft ist ausschließlich über Namen im pedigree-Feld
// auflösbar (kein mother_id/father_id in der DB).

// exterior_genetics:exterior_genetics->overall (statt der vollen Spalte) -
// computeDerived unten liest nur .overall.percent, nie .rows
// (Egress-Audit 2026-10-04, gleicher Fix wie in MDR-Datenbank/js/list.js).
const TRACKER_FIELDS =
  'id,name,external_id,owner,gender,coat_color,colors,notes,pedigree,tournament_potential,exterior_genetics:exterior_genetics->overall,exterior_descriptive,temperament,breeding_allowed,breed,tags';

let allHorses = [];
let breedFilter;
let tagFilter;
let topBreedFilter;
let topTagFilter;
// null = keine Präferenz (Gast/kein Setting) -> APH-Standard in
// createBreedFilter; [] = "Alle Rassen" bewusst gewählt; [...] = konkrete
// Rassen - siehe loadDefaultBreeds/user_settings.preferred_breeds.
let defaultBreeds = null;
let childrenByParentName = new Map();
let trackerSort = { field: 'gp', dir: 'desc' };
let trackerSubSort = { field: 'gp', dir: 'desc' };
let trackerRelatedSort = { field: 'gp', dir: 'desc' };
let topSort = { field: 'count', dir: 'desc' };
let topSubSort = { field: 'gp', dir: 'desc' };
let expandedTrackerIds = new Set();
let expandedTopIds = new Set();

// Zwei Caches, EINMALIG aus dem vollen Bestand gebaut (nicht pro Zeile) -
// "weite" Zählung (irgendein gemeinsamer Name im 14-Ahnen-Pool, siehe
// pedigreeNamePool in js/breeding.js) und "enge" Inzucht-Zählung (Name
// doppelt im sichtbaren, max. 3 Generationen tiefen Stammbaum - exakt
// dieselbe Tiefe wie findSharedNames/foalPedigreeNodes dort, hier aber als
// vorberechnete Namensmenge statt eines Funktionsaufrufs pro Pferdepaar,
// da bei ~1000 Pferden ein naiver O(n²)-Aufruf von findRelations/
// findSharedNames spürbar hängen würde).
let ancestorPoolById = new Map();
let inzuchtNamesById = new Map();
let relatednessCachesBuilt = false;

// "Bestes Kind"-Abzeichen (Nutzerwunsch: "ob das Fohlen das beste unter
// seinen Geschwistern (selbes Geschlecht) ist und wie die Werte im
// Vergleich zu den Eltern sind") - 1:1 aus MDR-Datenbank/js/list.js
// portiert (dort seit Längerem bewährt), hier erstmals in MDR-Planer.
// bestChildBadges: Map<Pferd-Id, [{key, label, symbol, state, childValue,
// parentValue, childLabel, parentLabel}]> - pro Pferd nur die Werte, bei
// denen es unter seinen gleichgeschlechtigen Geschwistern (Söhne EINES
// Vaters bzw. Töchter EINER Mutter) den Bestwert erreicht.
let bestChildBadges = new Map();

document.addEventListener('DOMContentLoaded', init);

function wireTabButtons() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
}

function activateTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelector('#tab-uebersicht').hidden = tab !== 'uebersicht';
  document.querySelector('#tab-top').hidden = tab !== 'top';
}

async function init() {
  document.querySelector('#tag-legend').innerHTML = tagLegendHtml();
  wireTabButtons();
  breedFilter = createBreedFilter(document.querySelector('#breed-drop'), { onChange: renderTrackerTab, initialSelection: () => defaultBreeds });
  tagFilter = createTagFilter(document.querySelector('#tag-drop'), { onChange: renderTrackerTab });
  document.querySelector('#owner-select').addEventListener('change', renderTrackerTab);
  document.querySelector('#gender-select').addEventListener('change', renderTrackerTab);
  document.querySelector('#zzl-select').addEventListener('change', renderTrackerTab);
  document.querySelector('#related-own-only-toggle').addEventListener('change', renderTrackerTab);
  wireTrackerToggle();
  wireSortableHeaders();
  wireTopToggle();
  topBreedFilter = createBreedFilter(document.querySelector('#top-breed-drop'), { onChange: renderTop, initialSelection: () => defaultBreeds });
  topTagFilter = createTagFilter(document.querySelector('#top-tag-drop'), { onChange: renderTop });
  document.querySelector('#top-owner-select').addEventListener('change', renderTop);
  document.querySelector('#top-gender-select').addEventListener('change', renderTop);
  document.querySelector('#top-zzl-select').addEventListener('change', renderTop);
  wireTagSuggestHandlers('Fohlen-Tracker');
  await initAuthStatus();
  await loadDefaultBreeds();
  // "Nur eigene Pferde" bei "Alle Verwandten" ergibt ohne Login keinen
  // Sinn (isOwnerOf() ist dann immer false, die Liste wäre also stets
  // leer) - Checkbox deshalb deaktivieren statt eine irreführende leere
  // Liste zu zeigen.
  if (!isLoggedIn()) {
    const toggle = document.querySelector('#related-own-only-toggle');
    toggle.checked = false;
    toggle.disabled = true;
    toggle.title = 'Nur mit Login verfügbar';
  }
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

// Lädt die (inzwischen recht große, >1200 Zeilen) Pferdeliste bewusst NICHT
// beim Seitenaufruf, sondern erst bei der ersten Filter-Interaktion
// (Nutzerwunsch 2026-09-05, wegen Supabase-Egress-Kontingent) - anders als
// z.B. Zuchtbuch gibt es hier kein Namens-Suchfeld, das dafür herhalten
// könnte, deshalb hier über renderTrackerTab/renderTop selbst (jeder
// Filter ruft am Ende genau eine dieser beiden Funktionen auf).
let horsesLoadPromise = null;
function ensureHorsesLoaded() {
  if (!horsesLoadPromise) horsesLoadPromise = loadHorses();
  return horsesLoadPromise;
}

async function loadHorses() {
  const errorEl = document.querySelector('#load-error');
  const { data, error } = await fetchAllRows((from, to) =>
    supabaseClient.from('horses').select(TRACKER_FIELDS).order('name').range(from, to));
  if (error) {
    errorEl.textContent =
      'Konnte Pferde nicht laden: ' + error.message +
      ' (falls die Seite ohne Login genutzt wird, muss dafür einmalig die Migration ' +
      '"migration_005_public_read_access.sql" im Supabase-Dashboard ausgeführt worden sein).';
    return;
  }
  allHorses = data || [];

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
  relatednessCachesBuilt = false;

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
  breedFilter.setHorses(allHorses);
  topBreedFilter.setHorses(allHorses);
}

function parentNames(horse) {
  const anc = pedigreeAncestorNames(horse);
  const father = anc[0] && normalizeName(anc[0]) !== 'unbekannt' ? anc[0] : null;
  const mother = anc[1] && normalizeName(anc[1]) !== 'unbekannt' ? anc[1] : null;
  return { father, mother };
}

function computeDerived(h) {
  const gpRaw = h.tournament_potential?.['Gesamtpotenzial'];
  return {
    gp: gpRaw != null && gpRaw !== '' ? Number(gpRaw) : null,
    extAvg: averageScore(h.exterior_descriptive, scoreExteriorTerm),
    extPercent: h.exterior_genetics?.percent ?? null,
    intAvg: averageScore(h.temperament, scoreTemperamentTerm),
  };
}

// Farbliche Kodierung der Fohlen-Werte (GP/Ext/Ext%/Int) gegen den
// jeweils aufgeklappten Elternteil (Nutzerwunsch) - gleiche Konvention wie
// MDR-Planer/js/zuchtbuch.js (compareColor): gruen = besser als der
// Elternteil, rot = schlechter, keine Farbe = gleich oder einer der beiden
// Werte unbekannt. Hier dupliziert statt geteilt, da jede Seite in diesem
// Repo ihre kleinen Anzeige-Helfer eigenstaendig haelt (siehe escapeHtml).
const METRIC_HIGHER_IS_BETTER = { gp: true, ext: false, extpct: true, int: false };
function compareColor(value, reference, metric) {
  if (value == null || reference == null) return '';
  if (value === reference) return 'var(--text)';
  const higherIsBetter = METRIC_HIGHER_IS_BETTER[metric];
  const better = higherIsBetter ? value > reference : value < reference;
  return better ? 'var(--success)' : 'var(--danger)';
}
function metricCellStyle(value, reference, metric) {
  const color = compareColor(value, reference, metric);
  return color ? `color:${color}; font-weight:600;` : '';
}

// Schlagwort-Vorschlag-Button (js/tagSuggest.js) - nur fuer eingeloggte
// Besitzer*innen des jeweiligen Fohlens, identisch zur Einbindung in
// js/zuchtbuch.js (rowTagSuggestHtml).
function rowTagSuggestHtml(horse) {
  if (!horse || !isLoggedIn() || !isOwnerOf(horse.owner)) return '';
  return tagSuggestButtonHtml(horse.id, horse.owner);
}

function zzlDisplay(breedingAllowed) {
  if (breedingAllowed === true) return 'Ja';
  if (breedingAllowed === false) return 'Nein';
  return '–';
}

function sortArrow(sort, field) {
  return sort.field === field ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
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

function nextSort(current, field, descFirst) {
  if (current.field === field) return { field, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { field, dir: descFirst ? 'desc' : 'asc' };
}

// Sub-Tabellen liegen VERSCHACHTELT innerhalb der jeweiligen Haupttabelle
// (aufgeklappte Zeile). Ein reiner Abstammungs-Selektor wie
// "#tracker-table th[data-sort]" würde daher auch Klicks in der
// verschachtelten Sub-Tabelle fälschlich der Haupttabelle zuordnen (jede
// Sub-Tabellen-Zelle liegt ja ebenfalls IRGENDWO unterhalb von
// #tracker-table im DOM) - deshalb wird stattdessen die UNMITTELBAR
// umschließende <table> des angeklickten <th> ermittelt und anhand DERER
// eigener id/Klasse entschieden, welcher Sortier-Zustand betroffen ist.
function wireSortableHeaders() {
  document.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const table = th.closest('table');
    if (!table) return;
    const field = th.dataset.sort;
    if (table.id === 'tracker-table') {
      trackerSort = nextSort(trackerSort, field, field !== 'name');
      renderTrackerTab();
    } else if (table.classList.contains('tracker-subtable')) {
      trackerSubSort = nextSort(trackerSubSort, field, field !== 'name');
      renderTrackerTab();
    } else if (table.classList.contains('tracker-related-subtable')) {
      trackerRelatedSort = nextSort(trackerRelatedSort, field, field !== 'name');
      renderTrackerTab();
    } else if (table.classList.contains('top-table')) {
      topSort = nextSort(topSort, field, field !== 'name');
      renderTop();
    } else if (table.classList.contains('top-subtable')) {
      topSubSort = nextSort(topSubSort, field, field !== 'name');
      renderTop();
    }
  });
}

function buildRelatednessCaches() {
  if (relatednessCachesBuilt) return;
  ancestorPoolById = new Map();
  inzuchtNamesById = new Map();
  for (const h of allHorses) {
    const wideSet = new Set(pedigreeNamePool(h).map((e) => normalizeName(e.name)).filter(Boolean));
    ancestorPoolById.set(h.id, wideSet);

    const own = normalizeName(h.name);
    const names = own && own !== 'unbekannt' ? [own] : [];
    for (const a of pedigreeAncestorNames(h).slice(0, 6)) {
      const key = normalizeName(a);
      if (key && key !== 'unbekannt') names.push(key);
    }
    inzuchtNamesById.set(h.id, names);
  }
  bestChildBadges = computeBestChildBadges();
  relatednessCachesBuilt = true;
}

// Dieselben 4 Werte/Richtungen wie beim Ø-Vergleich - GP/Ext% sind besser,
// je höher, Ext/Int besser, je niedriger.
const BEST_CHILD_METRICS = [
  { key: 'gp', lowerIsBetter: false, symbol: '★', label: 'GP' },
  { key: 'extAvg', lowerIsBetter: true, symbol: '★', label: 'Ext' },
  { key: 'extPercent', lowerIsBetter: false, symbol: '★', label: 'Ext%' },
  { key: 'intAvg', lowerIsBetter: true, symbol: '★', label: 'Int' },
];

function formatBestChildValue(key, value) {
  if (value == null) return '?';
  if (key === 'gp') return String(value);
  if (key === 'extPercent') return value + '%';
  return value.toFixed(2);
}

// Geschlecht robust zuordnen (Groß-/Kleinschreibung, Leerzeichen, Bindestriche
// egal): 'male' (Hengst/Hengstfohlen/Wallach), 'female' (Stute/Stutfohlen),
// sonst null - ein exakter Textvergleich ließ Pferde mit abweichend
// geschriebenem Geschlecht aus der "Bestes Kind"-Auswertung fallen.
function genderGroupOf(gender) {
  const g = String(gender || '').trim().toLowerCase().replace(/[\s-]+/g, '');
  if (g === 'hengst' || g === 'hengstfohlen' || g === 'wallach') return 'male';
  if (g === 'stute' || g === 'stutfohlen') return 'female';
  return null;
}

// Ermittelt für eine Gruppe gleichgeschlechtiger Geschwister (Söhne EINES
// Vaters ODER Töchter EINER Mutter) je Wert einzeln, wer unter den
// Geschwistern am besten abschneidet, vergleicht diesen Bestwert mit dem
// Elternteil und trägt das Ergebnis in "badges" ein - bei echtem
// Gleichstand bekommen alle mit dem Bestwert das Symbol (nicht nur eines).
function assignBestChildBadges(children, parentStats, badges, childLabel, parentLabel) {
  for (const metric of BEST_CHILD_METRICS) {
    const values = children.map((c) => c.stats[metric.key]).filter((v) => v != null);
    if (!values.length) continue;
    const bestValue = metric.lowerIsBetter ? Math.min(...values) : Math.max(...values);
    const pv = parentStats[metric.key];
    let state;
    if (pv == null) {
      state = 'unknown';
    } else {
      const childBetter = metric.lowerIsBetter ? bestValue < pv : bestValue > pv;
      const parentBetter = metric.lowerIsBetter ? pv < bestValue : pv > bestValue;
      state = childBetter ? 'better' : (parentBetter ? 'worse' : 'equal');
    }
    for (const c of children) {
      if (c.stats[metric.key] !== bestValue) continue;
      const list = badges.get(c.id) || [];
      list.push({ ...metric, state, childValue: bestValue, parentValue: pv ?? null, childLabel, parentLabel });
      badges.set(c.id, list);
    }
  }
}

// Gruppiert den kompletten Bestand nach Söhnen EINES Vaters bzw. Töchtern
// EINER Mutter (1:1 aus MDR-Datenbank/js/list.js/loadBestChildBadges) und
// weist je Gruppe die Bestes-Kind-Abzeichen zu. Fehlt der Elternteil selbst
// in der Datenbank, wird die beste/n Geschwister trotzdem ermittelt, nur
// ohne Farbaussage besser/gleich/schlechter (state "unknown").
function computeBestChildBadges() {
  const byName = new Map(allHorses.map((h) => [h.name, h]));
  const sonsByFather = new Map();
  const daughtersByMother = new Map();
  for (const h of allHorses) {
    const { father, mother } = parentNames(h);
    const group = genderGroupOf(h.gender);
    if (group === 'male') {
      if (!father) continue;
      const list = sonsByFather.get(father) || [];
      list.push({ id: h.id, stats: computeDerived(h) });
      sonsByFather.set(father, list);
    } else if (group === 'female') {
      if (!mother) continue;
      const list = daughtersByMother.get(mother) || [];
      list.push({ id: h.id, stats: computeDerived(h) });
      daughtersByMother.set(mother, list);
    }
  }
  const badges = new Map();
  for (const [fatherName, sons] of sonsByFather) {
    const father = byName.get(fatherName);
    assignBestChildBadges(sons, father ? computeDerived(father) : {}, badges, 'Sohn', 'Vater');
  }
  for (const [motherName, daughters] of daughtersByMother) {
    const mother = byName.get(motherName);
    assignBestChildBadges(daughters, mother ? computeDerived(mother) : {}, badges, 'Tochter', 'Mutter');
  }
  return badges;
}

function hasInternalDuplicate(names) {
  const seen = new Set();
  for (const n of names) {
    if (seen.has(n)) return true;
    seen.add(n);
  }
  return false;
}

function countRelatedWide(horse, pool) {
  return findRelatedWide(horse, pool).length;
}

// Wie countRelatedWide, liefert aber die tatsächlichen Pferde zurück statt
// nur die Anzahl (Nutzerwunsch: "nicht nur Kinder, alle Verwandten aus
// derselben Linie ansehen können") - dieselbe Logik/derselbe Cache
// (ancestorPoolById), nur zusätzlich mit den gefundenen Pferden statt nur
// mitgezählt.
function findRelatedWide(horse, pool) {
  const own = ancestorPoolById.get(horse.id);
  if (!own || !own.size) return [];
  const related = [];
  for (const other of pool) {
    if (other.id === horse.id) continue;
    const otherSet = ancestorPoolById.get(other.id);
    if (!otherSet) continue;
    for (const name of own) { if (otherSet.has(name)) { related.push(other); break; } }
  }
  return related;
}

function countRelatedInzucht(horse, pool) {
  const namesA = inzuchtNamesById.get(horse.id) || [];
  if (hasInternalDuplicate(namesA)) return null;
  const setA = new Set(namesA);
  let n = 0;
  for (const other of pool) {
    if (other.id === horse.id) continue;
    const namesB = inzuchtNamesById.get(other.id) || [];
    // Bugfix (Nutzerfeedback: "Inzucht und verwandt haut nicht hin" -
    // Inzucht-Zahl lag höher als Verwandte-Zahl): war bisher ein
    // "||" statt "&&" - zählte "other" fälschlich schon als Inzucht-Risiko
    // für "horse" mit, wenn "other" SELBST bereits irgendwo unabhängig
    // eingezüchtet ist (interner Namens-Duplikat in dessen EIGENEM Pool),
    // völlig unabhängig davon, ob überhaupt eine Namensüberschneidung mit
    // "horse" bestand - dadurch wurden auch komplett unverwandte, aber
    // selbst schon eingezüchtete Pferde im ganzen Bestand mitgezählt.
    // Genau wie bei "horse" selbst (siehe namesA oben) wird ein bereits
    // selbst eingezüchtetes "other" jetzt komplett übersprungen, statt es
    // als Treffer gegen "horse" gegenzurechnen.
    if (hasInternalDuplicate(namesB)) continue;
    if (namesB.some((name) => setA.has(name))) n++;
  }
  return n;
}

function wireTrackerToggle() {
  document.addEventListener('click', (e) => {
    const row = e.target.closest('#tracker-table tr.tracker-row[data-id]');
    if (!row) return;
    // Klicks im "Schlagwort vorschlagen"-Formular dürfen die Zeile nicht
    // auf-/zuklappen: das Neu-Rendern würde das gerade geöffnete Formular
    // sofort wieder zerstören (Bugreport: Tag vorschlagen ging im
    // Fohlen-Tracker nicht).
    if (e.target.closest('.tag-suggest-wrap')) return;
    const id = row.dataset.id;
    if (expandedTrackerIds.has(id)) expandedTrackerIds.delete(id);
    else expandedTrackerIds.add(id);
    renderTrackerTab();
  });
}

function wireTopToggle() {
  document.addEventListener('click', (e) => {
    const row = e.target.closest('#top-result tr.top-row[data-id]');
    if (!row) return;
    if (e.target.closest('.tag-suggest-wrap')) return;
    const id = row.dataset.id;
    if (expandedTopIds.has(id)) expandedTopIds.delete(id);
    else expandedTopIds.add(id);
    renderTop();
  });
}

function trackerSortValue(row, field) {
  switch (field) {
    case 'name': return (row.horse.name || '').toLowerCase();
    case 'gender': return (row.horse.gender || '').toLowerCase();
    case 'coat_color': return (row.horse.coat_color || '').toLowerCase();
    case 'owner': return (row.horse.owner || '').toLowerCase();
    case 'gp': return row.d.gp;
    case 'ext': return row.d.extAvg;
    case 'extpct': return row.d.extPercent;
    case 'int': return row.d.intAvg;
    case 'hf': return row.hf;
    case 'sf': return row.sf;
    case 'verwandte': return row.verwandte;
    case 'inzucht': return row.inzucht;
    case 'tag': return tagSortValue(row.horse.tags);
    default: return null;
  }
}

// Nutzerwunsch: einstellbar, ob die "Alle Verwandten"-Liste (aufgeklappte
// Zeile) nur die eigenen Pferde des eingeloggten Nutzers zeigt oder alle -
// die Verwandten-/Inzucht-ZAHLEN in der Haupttabelle (row.verwandte/
// row.inzucht, siehe renderTrackerTab) laufen davon unberührt IMMER gegen
// den kompletten Bestand.
function relatedOwnOnlyEnabled() {
  return isLoggedIn() && document.querySelector('#related-own-only-toggle').checked;
}

function trackerFilteredHorses() {
  const owner = document.querySelector('#owner-select').value;
  const gender = document.querySelector('#gender-select').value;
  const zzl = document.querySelector('#zzl-select').value;
  return allHorses.filter((h) => {
    if (owner && h.owner !== owner) return false;
    if (gender && h.gender !== gender) return false;
    if (zzl === 'zzl' && h.breeding_allowed !== true) return false;
    if (zzl === 'ohne' && h.breeding_allowed === true) return false;
    return breedFilter.matches(h) && tagFilter.matches(h);
  });
}

async function renderTrackerTab() {
  await ensureHorsesLoaded();
  const container = document.querySelector('#tracker-result');
  buildRelatednessCaches();
  const filtered = trackerFilteredHorses();
  if (!filtered.length) {
    container.innerHTML = '<p class="muted small">Keine Pferde für diese Auswahl gefunden - Filter oben anpassen.</p>';
    return;
  }

  const rows = filtered.map((h) => {
    const foals = childrenByParentName.get(normalizeName(h.name)) || [];
    return {
      horse: h,
      d: computeDerived(h),
      hf: foals.filter((f) => f.gender === 'Hengst').length,
      sf: foals.filter((f) => f.gender === 'Stute').length,
      // Nutzerwunsch: gegen den KOMPLETTEN Bestand zaehlen (nicht nur die
      // gerade gefilterte Tabelle), damit die Zahlen mit dem Zuchtbuch-
      // Reiter der MDR-Datenbank vergleichbar sind - der zaehlt ebenfalls
      // gegen alle Pferde aller Zuechter, nicht gegen eine Teilmenge.
      verwandte: countRelatedWide(h, allHorses),
      inzucht: countRelatedInzucht(h, allHorses),
    };
  });
  const sorted = applySortGeneric(rows, trackerSort, trackerSortValue);

  let html = `<p class="small muted">Zeigt ${filtered.length} Pferde entsprechend der Auswahl oben. Verwandten-/Inzucht-Zählung bezieht sich auf den KOMPLETTEN Bestand (alle Züchter), nicht nur diese gefilterte Menge - vergleichbar mit dem Zuchtbuch-Reiter der MDR-Datenbank. <span class="best-child-symbol" style="font-size:0.9em;">★</span> hinter GP/Ext/Ext%/Int: dieses Pferd ist bei diesem Wert das Beste unter seinen gleichgeschlechtigen Geschwistern (Söhne desselben Vaters bzw. Töchter derselben Mutter) - Farbe zeigt besser (grün) / gleichauf (gelb) / schlechter (rot) als der jeweilige Elternteil, hellblau = kein Vergleich möglich (Elternteil nicht in der Datenbank oder ohne diesen Wert).</p>`;
  html += `<div class="table-wrap"><table id="tracker-table">
    <thead><tr>
      <th data-sort="name" class="sticky-name">Pferdename${sortArrow(trackerSort, 'name')}</th>
      <th data-sort="gender">Geschlecht${sortArrow(trackerSort, 'gender')}</th>
      <th data-sort="gp">GP${sortArrow(trackerSort, 'gp')}</th>
      <th data-sort="ext">Ext${sortArrow(trackerSort, 'ext')}</th>
      <th data-sort="extpct">Ext%${sortArrow(trackerSort, 'extpct')}</th>
      <th data-sort="int">Int${sortArrow(trackerSort, 'int')}</th>
      <th data-sort="coat_color">Farbe${sortArrow(trackerSort, 'coat_color')}</th>
      <th data-sort="hf" title="Hengstfohlen">HF${sortArrow(trackerSort, 'hf')}</th>
      <th data-sort="sf" title="Stutfohlen">SF${sortArrow(trackerSort, 'sf')}</th>
      <th data-sort="verwandte" title="Jedes andere Pferd im gefilterten Bestand, das mindestens einen Namen mit dem sichtbaren Stammbaum teilt">Verwandte${sortArrow(trackerSort, 'verwandte')}</th>
      <th data-sort="inzucht" title="Nur Pferde, bei denen sich ein Name im sichtbaren Stammbaum eines hypothetischen gemeinsamen Fohlens tatsächlich doppeln würde (Inzucht-relevante Verwandtschaft)">Inzucht${sortArrow(trackerSort, 'inzucht')}</th>
      <th data-sort="owner">Besitzer${sortArrow(trackerSort, 'owner')}</th>
      <th data-sort="tag">Schlagwort${sortArrow(trackerSort, 'tag')}</th>
    </tr></thead>
    <tbody>${sorted.map(trackerRowHtml).join('')}</tbody>
  </table></div>`;
  container.innerHTML = html;
  applyStickyOffsets(container);
}

// Misst pro Tabelle den Breiten-Versatz der Name-Spalte (steht nicht bei
// jeder Tabelle an erster Stelle) und setzt ihn als CSS-Variable, damit
// .sticky-name beim horizontalen Scrollen sauber am linken Rand klebt.
function applyStickyOffsets(root) {
  root.querySelectorAll('table').forEach((table) => {
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return;
    const idx = Array.from(headerRow.children).findIndex((th) => th.classList.contains('sticky-name'));
    if (idx < 0) return;
    let left = 0;
    for (let i = 0; i < idx; i++) left += headerRow.children[i].getBoundingClientRect().width;
    table.querySelectorAll('tr').forEach((tr) => {
      const cell = tr.children[idx];
      if (cell && cell.classList.contains('sticky-name')) cell.style.setProperty('--sticky-left', `${left}px`);
    });
  });
}

const TRACKER_COLSPAN = 13;

// "Bestes Kind"-Symbol für eine einzelne Wert-Zelle (siehe
// computeBestChildBadges) - leeres Ergebnis, wenn dieses Pferd bei diesem
// Wert kein "Bestes Kind" ist.
const BEST_CHILD_STATE_LABELS = { better: 'besser', equal: 'gleichauf', worse: 'schlechter' };
function bestChildStar(horseId, key) {
  const m = (bestChildBadges.get(horseId) || []).find((b) => b.key === key);
  if (!m) return '';
  const title = m.state === 'unknown'
    ? `${m.label}: ${m.childLabel} beste(r) unter den Geschwistern (Vergleich mit ${m.parentLabel} nicht möglich - fehlt in der Datenbank oder ohne diesen Wert)`
    : `${m.label}: ${m.childLabel} ${formatBestChildValue(m.key, m.childValue)} ${BEST_CHILD_STATE_LABELS[m.state]} als ${m.parentLabel} ${formatBestChildValue(m.key, m.parentValue)}`;
  return ` <span class="best-child-symbol best-child-${m.state}" title="${escapeHtml(title)}">${m.symbol}</span>`;
}

function trackerRowHtml(row) {
  const h = row.horse;
  const d = row.d;
  const expanded = expandedTrackerIds.has(h.id);
  const inzuchtCell = row.inzucht == null
    ? '<td data-label="Inzucht" title="Dieses Pferd hat bereits eine Namensdopplung im eigenen sichtbaren Stammbaum - die Zahl gegen alle anderen Pferde wäre dadurch trivial und irreführend.">Selbst bereits eingezüchtet</td>'
    : `<td data-label="Inzucht">${row.inzucht}</td>`;
  let html = `<tr class="tracker-row" data-id="${escapeHtml(h.id)}" style="cursor:pointer;">
    <td data-label="Pferdename" class="sticky-name" style="${tagCellStyle(h.tags)}">${expanded ? '▾ ' : '▸ '}${linkedName(h, '(ohne Name)')}</td>
    <td data-label="Geschlecht">${escapeHtml(h.gender || '–')}</td>
    <td data-label="GP">${d.gp != null ? d.gp : '–'}${bestChildStar(h.id, 'gp')}</td>
    <td data-label="Ext">${d.extAvg != null ? d.extAvg.toFixed(2) : '–'}${bestChildStar(h.id, 'extAvg')}</td>
    <td data-label="Ext%">${d.extPercent != null ? d.extPercent + '%' : '–'}${bestChildStar(h.id, 'extPercent')}</td>
    <td data-label="Int">${d.intAvg != null ? d.intAvg.toFixed(2) : '–'}${bestChildStar(h.id, 'intAvg')}</td>
    <td data-label="Farbe">${escapeHtml(h.coat_color || '–')}</td>
    <td data-label="HF">${row.hf}</td>
    <td data-label="SF">${row.sf}</td>
    <td data-label="Verwandte">${row.verwandte}</td>
    ${inzuchtCell}
    <td data-label="Besitzer">${h.owner ? escapeHtml(h.owner) : '–'}</td>
    <td data-label="Schlagwort" style="${tagCellStyle(h.tags)}">${tagCellText(h.tags)}${rowTagSuggestHtml(h)}</td>
  </tr>`;
  if (expanded) {
    const foals = childrenByParentName.get(normalizeName(h.name)) || [];
    html += `<tr class="tracker-subrow"><td colspan="${TRACKER_COLSPAN}">
      <div class="group-heading" style="font-size:0.9rem;">Eigene Fohlen (${foals.length})</div>
      ${trackerSubTableHtml(foals, h)}
    </td></tr>`;
    // Nutzerwunsch: nicht nur die direkten Fohlen, sondern ALLE Verwandten
    // aus derselben Linie (dieselbe Zahl wie in der "Verwandte"-Spalte,
    // siehe countRelatedWide/findRelatedWide) direkt mit Werten/Eltern/
    // Farbe einsehbar, statt nur als reine Zahl.
    const related = findRelatedWide(h, allHorses);
    const visibleRelated = relatedOwnOnlyEnabled() ? related.filter((r) => isOwnerOf(r.owner)) : related;
    const countLabel = visibleRelated.length === related.length ? `${related.length}` : `${visibleRelated.length} von ${related.length}`;
    html += `<tr class="tracker-subrow"><td colspan="${TRACKER_COLSPAN}">
      <div class="group-heading" style="font-size:0.9rem;">Alle Verwandten im sichtbaren Stammbaum (${countLabel})</div>
      ${trackerRelatedTableHtml(visibleRelated, h)}
    </td></tr>`;
  }
  return html;
}

// Ein Pferd kann Fohlen mit mehreren verschiedenen Partnern haben - welcher
// das jeweils war, ist in der Fohlen-Unterliste sonst nicht ersichtlich.
// Ermittelt zum bekannten (aufgeklappten) Elternteil den jeweils ANDEREN
// Elternteil des Fohlens (analog zur Halbgeschwister-Anzeige in
// js/zuchtbuch.js/js/fohlenpruefung.js).
function otherParentOf(foal, knownParent) {
  const { father, mother } = parentNames(foal);
  const isFather = father && normalizeName(father) === normalizeName(knownParent.name);
  const otherName = isFather ? mother : father;
  return otherName ? { label: isFather ? 'Mutter' : 'Vater', name: otherName } : null;
}

function trackerSubSortValue(row, field) {
  switch (field) {
    case 'name': return (row.horse.name || '').toLowerCase();
    case 'gender': return (row.horse.gender || '').toLowerCase();
    case 'coat_color': return (row.horse.coat_color || '').toLowerCase();
    case 'owner': return (row.horse.owner || '').toLowerCase();
    case 'gp': return row.d.gp;
    case 'ext': return row.d.extAvg;
    case 'extpct': return row.d.extPercent;
    case 'int': return row.d.intAvg;
    case 'verwandte': return row.verwandte;
    case 'inzucht': return row.inzucht;
    case 'otherParent': return (row.otherParent?.name || '').toLowerCase();
    case 'tag': return tagSortValue(row.horse.tags);
    default: return null;
  }
}

function trackerSubTableHtml(foals, parentHorse) {
  if (!foals.length) return '<p class="small muted" style="margin:0.3rem 0;">Keine eigenen Fohlen im sichtbaren Stammbaum der übrigen Pferde gefunden.</p>';
  const parentD = computeDerived(parentHorse);
  // Gegen den kompletten Bestand zaehlen, nicht nur die gefilterte Tabelle
  // - siehe renderTrackerTab (gleiche Begruendung: Vergleichbarkeit mit
  // dem Zuchtbuch-Reiter der MDR-Datenbank).
  const rows = foals.map((h) => ({ horse: h, d: computeDerived(h), parentD, verwandte: countRelatedWide(h, allHorses), inzucht: countRelatedInzucht(h, allHorses), otherParent: otherParentOf(h, parentHorse) }));
  const sorted = applySortGeneric(rows, trackerSubSort, trackerSubSortValue);
  const th = (field, label, extra) => `<th data-sort="${field}"${extra || ''}>${label}${sortArrow(trackerSubSort, field)}</th>`;
  return `<div class="table-wrap"><table class="tracker-subtable">
    <thead><tr>
      ${th('name', 'Pferdename', ' class="sticky-name"')}
      ${th('otherParent', 'Anderer Elternteil')}
      ${th('gender', 'Geschlecht')}
      ${th('gp', 'GP')}
      ${th('ext', 'Ext')}
      ${th('extpct', 'Ext%')}
      ${th('int', 'Int')}
      ${th('coat_color', 'Farbe')}
      ${th('verwandte', 'Verwandte')}
      ${th('inzucht', 'Inzucht')}
      ${th('owner', 'Besitzer')}
      ${th('tag', 'Schlagwort')}
    </tr></thead>
    <tbody>${sorted.map(trackerSubRowHtml).join('')}</tbody>
  </table></div>`;
}

function trackerSubRowHtml(row) {
  const h = row.horse;
  const d = row.d;
  const p = row.parentD;
  return `<tr>
    <td data-label="Pferdename" class="sticky-name" style="${tagCellStyle(h.tags)}">${linkedName(h, '(ohne Name)')}</td>
    <td data-label="Anderer Elternteil">${row.otherParent ? `${escapeHtml(row.otherParent.label)}: ${escapeHtml(row.otherParent.name)}` : '–'}</td>
    <td data-label="Geschlecht">${escapeHtml(h.gender || '–')}</td>
    <td data-label="GP" style="${metricCellStyle(d.gp, p.gp, 'gp')}">${d.gp != null ? Math.round(d.gp) : '–'}${bestChildStar(h.id, 'gp')}</td>
    <td data-label="Ext" style="${metricCellStyle(d.extAvg, p.extAvg, 'ext')}">${d.extAvg != null ? d.extAvg.toFixed(2) : '–'}${bestChildStar(h.id, 'extAvg')}</td>
    <td data-label="Ext%" style="${metricCellStyle(d.extPercent, p.extPercent, 'extpct')}">${d.extPercent != null ? d.extPercent.toFixed(2) : '–'}${bestChildStar(h.id, 'extPercent')}</td>
    <td data-label="Int" style="${metricCellStyle(d.intAvg, p.intAvg, 'int')}">${d.intAvg != null ? d.intAvg.toFixed(2) : '–'}${bestChildStar(h.id, 'intAvg')}</td>
    <td data-label="Farbe">${escapeHtml(h.coat_color || '–')}</td>
    <td data-label="Verwandte">${row.verwandte}</td>
    <td data-label="Inzucht">${row.inzucht == null ? 'Selbst bereits eingezüchtet' : row.inzucht}</td>
    <td data-label="Besitzer">${h.owner ? escapeHtml(h.owner) : '–'}</td>
    <td data-label="Schlagwort" style="${tagCellStyle(h.tags)}">${tagCellText(h.tags)}${rowTagSuggestHtml(h)}</td>
  </tr>`;
}

function trackerRelatedSortValue(row, field) {
  switch (field) {
    case 'name': return (row.horse.name || '').toLowerCase();
    case 'gender': return (row.horse.gender || '').toLowerCase();
    case 'coat_color': return (row.horse.coat_color || '').toLowerCase();
    case 'owner': return (row.horse.owner || '').toLowerCase();
    case 'gp': return row.d.gp;
    case 'ext': return row.d.extAvg;
    case 'extpct': return row.d.extPercent;
    case 'int': return row.d.intAvg;
    case 'inbreeding': return row.inbreeding ? 1 : 0;
    case 'tag': return tagSortValue(row.horse.tags);
    default: return null;
  }
}

// Nutzerwunsch: nicht nur die direkten Fohlen, sondern ALLE Verwandten aus
// derselben Linie (dieselbe Zahl wie in der "Verwandte"-Spalte, siehe
// countRelatedWide/findRelatedWide) direkt mit Werten/Eltern/Farbe
// einsehbar statt nur als reine Zahl - eigene, separat sortierbare
// Unter-Tabelle (siehe wireSortableHeaders/trackerRelatedSort),
// unabhängig von der Fohlen-Unter-Tabelle. Ohne Vergleichsfarbe gegen
// EINEN Elternteil (anders als bei den Fohlen) - bei "allen Verwandten"
// gibt es keinen einzelnen Bezugs-Elternteil, das "Bestes Kind"-★-Symbol
// bleibt aber (global ermittelt, unabhängig von dieser Ansicht). Zusätzlich
// pro Zeile die Inzucht-Gefahr GEGENÜBER dem aufgeklappten Pferd (referenceHorse)
// via findSharedNames (js/breeding.js) - derselbe geprüfte Ansatz wie in
// js/verwandtschaft.js/js/zuchtbuch.js.
function trackerRelatedTableHtml(relatedHorses, referenceHorse) {
  if (!relatedHorses.length) return '<p class="small muted" style="margin:0.3rem 0;">Keine Verwandten im sichtbaren Stammbaum gefunden.</p>';
  const refD = computeDerived(referenceHorse);
  const rows = relatedHorses.map((h) => ({ horse: h, d: computeDerived(h), refD, inbreeding: findSharedNames(referenceHorse, h).length > 0 }));
  const sorted = applySortGeneric(rows, trackerRelatedSort, trackerRelatedSortValue);
  const th = (field, label, extra) => `<th data-sort="${field}"${extra || ''}>${label}${sortArrow(trackerRelatedSort, field)}</th>`;
  return `<p class="small muted" style="margin:0.2rem 0;">Werte farbig gegen ${escapeHtml(referenceHorse.name || 'das aufgeklappte Pferd')}: <span style="color:var(--success); font-weight:600;">grün</span> = besser, <span style="color:var(--danger); font-weight:600;">rot</span> = schlechter.</p>
  <div class="table-wrap"><table class="tracker-related-subtable">
    <thead><tr>
      ${th('name', 'Pferdename', ' class="sticky-name"')}
      ${th('gender', 'Geschlecht')}
      <th>Eltern</th>
      ${th('gp', 'GP')}
      ${th('ext', 'Ext')}
      ${th('extpct', 'Ext%')}
      ${th('int', 'Int')}
      ${th('coat_color', 'Farbe')}
      ${th('owner', 'Besitzer')}
      ${th('inbreeding', 'Verpaarung')}
      ${th('tag', 'Schlagwort')}
    </tr></thead>
    <tbody>${sorted.map(trackerRelatedRowHtml).join('')}</tbody>
  </table></div>`;
}

function trackerRelatedRowHtml(row) {
  const h = row.horse;
  const d = row.d;
  const p = row.refD;
  const { father, mother } = parentNames(h);
  const parentsText = (father || mother)
    ? [father ? `Vater: ${father}` : null, mother ? `Mutter: ${mother}` : null].filter(Boolean).join(', ')
    : '–';
  const inbreedingPill = row.inbreeding
    ? '<span class="pill no">Inzucht-Gefahr</span>'
    : '<span class="pill yes">Unbedenklich</span>';
  return `<tr>
    <td data-label="Pferdename" class="sticky-name" style="${tagCellStyle(h.tags)}">${linkedName(h, '(ohne Name)')}</td>
    <td data-label="Geschlecht">${escapeHtml(h.gender || '–')}</td>
    <td data-label="Eltern">${escapeHtml(parentsText)}</td>
    <td data-label="GP" style="${metricCellStyle(d.gp, p.gp, 'gp')}">${d.gp != null ? Math.round(d.gp) : '–'}${bestChildStar(h.id, 'gp')}</td>
    <td data-label="Ext" style="${metricCellStyle(d.extAvg, p.extAvg, 'ext')}">${d.extAvg != null ? d.extAvg.toFixed(2) : '–'}${bestChildStar(h.id, 'extAvg')}</td>
    <td data-label="Ext%" style="${metricCellStyle(d.extPercent, p.extPercent, 'extpct')}">${d.extPercent != null ? d.extPercent + '%' : '–'}${bestChildStar(h.id, 'extPercent')}</td>
    <td data-label="Int" style="${metricCellStyle(d.intAvg, p.intAvg, 'int')}">${d.intAvg != null ? d.intAvg.toFixed(2) : '–'}${bestChildStar(h.id, 'intAvg')}</td>
    <td data-label="Farbe">${escapeHtml(h.coat_color || '–')}</td>
    <td data-label="Besitzer">${h.owner ? escapeHtml(h.owner) : '–'}</td>
    <td data-label="Verpaarung">${inbreedingPill}</td>
    <td data-label="Schlagwort" style="${tagCellStyle(h.tags)}">${tagCellText(h.tags)}${rowTagSuggestHtml(h)}</td>
  </tr>`;
}

// --- Top 20 meiste Fohlen ---

async function renderTop() {
  await ensureHorsesLoaded();
  const container = document.querySelector('#top-result');
  const owner = document.querySelector('#top-owner-select').value;
  const gender = document.querySelector('#top-gender-select').value;
  const zzl = document.querySelector('#top-zzl-select').value;

  const candidates = allHorses.filter((h) => {
    if (owner && h.owner !== owner) return false;
    if (gender && h.gender !== gender) return false;
    if (zzl === 'zzl' && h.breeding_allowed !== true) return false;
    if (zzl === 'ohne' && h.breeding_allowed === true) return false;
    if (!topBreedFilter.matches(h)) return false;
    if (!topTagFilter.matches(h)) return false;
    return true;
  });

  const ranked = candidates
    .map((h) => ({ horse: h, count: (childrenByParentName.get(normalizeName(h.name)) || []).length }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || (a.horse.name || '').localeCompare(b.horse.name || '', 'de'))
    .slice(0, 20);

  if (!ranked.length) {
    container.innerHTML = '<p class="muted small">Keine Pferde mit Fohlen für diese Auswahl gefunden - Filter anpassen.</p>';
    return;
  }

  // "Rang" bleibt an der ursprünglichen Fohlenanzahl-Reihenfolge hängen
  // (das IST die Top-10-Auswahl) - der Spaltenklick sortiert nur die
  // ANZEIGE-Reihenfolge der bereits feststehenden Top 20 um.
  const rankedWithRank = ranked.map((r, i) => ({ ...r, rank: i + 1 }));
  const sorted = applySortGeneric(rankedWithRank, topSort, topSortValue);

  const th = (field, label, extra) => `<th data-sort="${field}"${extra || ''}>${label}${sortArrow(topSort, field)}</th>`;
  let html = `<div class="table-wrap"><table class="top-table">
    <thead><tr>
      <th></th>
      ${th('rank', 'Rang')}
      ${th('name', 'Name', ' class="sticky-name"')}
      ${th('gender', 'Geschlecht')}
      ${th('breed', 'Rasse')}
      ${th('owner', 'Besitzer')}
      ${th('zzl', 'ZZL')}
      ${th('count', 'Fohlen')}
      ${th('tag', 'Schlagwort')}
    </tr></thead>
    <tbody>${sorted.map(topRowHtml).join('')}</tbody>
  </table></div>`;
  container.innerHTML = html;
  applyStickyOffsets(container);
}

function topSortValue(row, field) {
  switch (field) {
    case 'rank': return row.rank;
    case 'name': return (row.horse.name || '').toLowerCase();
    case 'gender': return (row.horse.gender || '').toLowerCase();
    case 'breed': return (row.horse.breed || '').toLowerCase();
    case 'owner': return (row.horse.owner || '').toLowerCase();
    case 'zzl': return row.horse.breeding_allowed === true ? 1 : row.horse.breeding_allowed === false ? 0 : null;
    case 'count': return row.count;
    case 'tag': return tagSortValue(row.horse.tags);
    default: return null;
  }
}

const TOP_ROW_COLSPAN = 9;

function topRowHtml(r) {
  const h = r.horse;
  const expanded = expandedTopIds.has(h.id);
  let html = `<tr class="top-row" data-id="${escapeHtml(h.id)}" style="cursor:pointer;">
    <td>${expanded ? '▾' : '▸'}</td>
    <td data-label="Rang">${r.rank}</td>
    <td data-label="Name" class="sticky-name" style="${tagCellStyle(h.tags)}">${linkedName(h, '(ohne Name)')}</td>
    <td data-label="Geschlecht">${escapeHtml(h.gender || '–')}</td>
    <td data-label="Rasse">${escapeHtml(h.breed || '–')}</td>
    <td data-label="Besitzer">${h.owner ? escapeHtml(h.owner) : '–'}</td>
    <td data-label="ZZL">${zzlDisplay(h.breeding_allowed)}</td>
    <td data-label="Fohlen">${r.count}</td>
    <td data-label="Schlagwort" style="${tagCellStyle(h.tags)}">${tagCellText(h.tags)}${rowTagSuggestHtml(h)}</td>
  </tr>`;
  if (expanded) {
    const foals = childrenByParentName.get(normalizeName(h.name)) || [];
    html += `<tr class="foal-subrow"><td colspan="${TOP_ROW_COLSPAN}">${topFoalSubTableHtml(foals, h)}</td></tr>`;
  }
  return html;
}

function topFoalSubSortValue(row, field) {
  switch (field) {
    case 'name': return (row.horse.name || '').toLowerCase();
    case 'breed': return (row.horse.breed || '').toLowerCase();
    case 'gender': return (row.horse.gender || '').toLowerCase();
    case 'zzl': return row.horse.breeding_allowed === true ? 1 : row.horse.breeding_allowed === false ? 0 : null;
    case 'coat_color': return (row.horse.coat_color || '').toLowerCase();
    case 'owner': return (row.horse.owner || '').toLowerCase();
    case 'gp': return row.d.gp;
    case 'ext': return row.d.extAvg;
    case 'extpct': return row.d.extPercent;
    case 'int': return row.d.intAvg;
    case 'otherParent': return (row.otherParent?.name || '').toLowerCase();
    case 'tag': return tagSortValue(row.horse.tags);
    default: return null;
  }
}

function topFoalSubTableHtml(foals, parentHorse) {
  const parentD = computeDerived(parentHorse);
  const rows = foals.map((h) => ({ horse: h, d: computeDerived(h), parentD, otherParent: otherParentOf(h, parentHorse) }));
  const sorted = applySortGeneric(rows, topSubSort, topFoalSubSortValue);
  const th = (field, label, extra) => `<th data-sort="${field}"${extra || ''}>${label}${sortArrow(topSubSort, field)}</th>`;
  return `<div class="table-wrap"><table class="top-subtable">
    <thead><tr>
      ${th('name', 'Name', ' class="sticky-name"')}
      ${th('otherParent', 'Anderer Elternteil')}
      ${th('breed', 'Rasse')}
      ${th('gender', 'Geschlecht')}
      ${th('gp', 'GP')}
      ${th('ext', 'Ext')}
      ${th('extpct', 'Ext%')}
      ${th('int', 'Int')}
      ${th('zzl', 'ZZL')}
      ${th('coat_color', 'Farbe')}
      ${th('owner', 'Besitzer')}
      ${th('tag', 'Schlagwort')}
    </tr></thead>
    <tbody>${sorted.map(topFoalSubRowHtml).join('')}</tbody>
  </table></div>`;
}

function topFoalSubRowHtml(row) {
  const h = row.horse;
  const d = row.d;
  const p = row.parentD;
  return `<tr>
    <td data-label="Name" class="sticky-name" style="${tagCellStyle(h.tags)}">${linkedName(h, '(ohne Name)')}</td>
    <td data-label="Anderer Elternteil">${row.otherParent ? `${escapeHtml(row.otherParent.label)}: ${escapeHtml(row.otherParent.name)}` : '–'}</td>
    <td data-label="Rasse">${escapeHtml(h.breed || '–')}</td>
    <td data-label="Geschlecht">${escapeHtml(h.gender || '–')}</td>
    <td data-label="GP" style="${metricCellStyle(d.gp, p.gp, 'gp')}">${d.gp != null ? Math.round(d.gp) : '–'}${bestChildStar(h.id, 'gp')}</td>
    <td data-label="Ext" style="${metricCellStyle(d.extAvg, p.extAvg, 'ext')}">${d.extAvg != null ? d.extAvg.toFixed(2) : '–'}${bestChildStar(h.id, 'extAvg')}</td>
    <td data-label="Ext%" style="${metricCellStyle(d.extPercent, p.extPercent, 'extpct')}">${d.extPercent != null ? d.extPercent.toFixed(2) : '–'}${bestChildStar(h.id, 'extPercent')}</td>
    <td data-label="Int" style="${metricCellStyle(d.intAvg, p.intAvg, 'int')}">${d.intAvg != null ? d.intAvg.toFixed(2) : '–'}${bestChildStar(h.id, 'intAvg')}</td>
    <td data-label="ZZL">${zzlDisplay(h.breeding_allowed)}</td>
    <td data-label="Farbe">${escapeHtml(h.coat_color || '–')}</td>
    <td data-label="Besitzer">${h.owner ? escapeHtml(h.owner) : '–'}</td>
    <td data-label="Schlagwort" style="${tagCellStyle(h.tags)}">${tagCellText(h.tags)}${rowTagSuggestHtml(h)}</td>
  </tr>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Nutzerwunsch: vor jedem angezeigten Pferdenamen einen Link zum echten
// Spielprofil setzen (1:1 dieselbe URL-Konvention wie der 🔗-Button in
// MDR-Datenbank/js/list.js bzw. den Verwaltungs-Tools dort). Ohne bekannte
// externe ID (external_id) gibt es keinen Link, nur den (escapten) Namen.
function gameLinkPrefix(horse) {
  if (!horse?.external_id) return '';
  return `<a href="https://www.morning-dust-ranch.de/index2.php?site=pferd&id=${encodeURIComponent(horse.external_id)}" target="_blank" rel="noopener" title="Zum Pferd im Spiel">🔗</a> `;
}

function linkedName(horse, fallbackName) {
  const name = horse?.name ?? fallbackName ?? '';
  return `${gameLinkPrefix(horse)}${escapeHtml(name)}`;
}
