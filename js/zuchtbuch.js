// Zuchtbuch + Aussortierhilfe: EIN gemeinsamer Blick auf ein ausgewähltes
// Pferd, ohne Reiter-Umschalter - Verwandtschaftsübersicht (Zuchtbuch) und
// eigene Fohlen im Vergleich (Aussortierhilfe) stehen untereinander auf
// derselben Seite (Nutzerwunsch: beide gehören eng zusammen, anders als
// der separate Fohlen-Tracker). Zusätzlich: Schlagwort-Vorschlag pro
// Tabellenzeile und ein Ø-Vergleich (Vorbild: MDR-Datenbank/js/list.js).
// Benötigt js/parser.js, js/breeding.js, js/tournamentScoring.js,
// js/verpaarung.js, js/searchableSelect.js, js/breedFilter.js,
// js/tagSuggest.js - muss also nach diesen Scripts eingebunden werden.

const ZUCHTBUCH_FIELDS =
  'id,name,owner,gender,coat_color,colors,notes,pedigree,tournament_potential,exterior_genetics,exterior_descriptive,temperament,traits,disciplines,genetic_diseases,hlp_slp,breeding_allowed,breed,purebred_pct,tags,birthdate,color_gene_overrides';

// Genau die vom Nutzer genannten 9 "Sondergene" (aus COLOR_WISH_OPTIONS in
// js/verpaarung.js gefiltert) - siehe Aussortierhilfe-Farbvergleich.
const SPECIAL_COLOR_LABELS = ['Champagne', 'Silver', 'Pearl (pl)', 'Flaxen (sichtbar)', 'Cream', 'Tobiano', 'Splashed', 'Sabino', 'Overo'];
const SPECIAL_COLOR_WISHES = COLOR_WISH_OPTIONS.filter((o) => SPECIAL_COLOR_LABELS.includes(o.label));

// Höher = besser für GP/Ext%, niedriger = besser für Ext/Int.
const METRIC_HIGHER_IS_BETTER = { gp: true, ext: false, extpct: true, int: false };

// Dieselben Schwellen wie in js/zuchtplaner.js (MAX_BREEDING_AGE/
// BREEDING_AGE_WARNING) - hier nur als Hinweis, keine Auswahl-Beschränkung.
const MAX_BREEDING_AGE = 25;
const BREEDING_AGE_WARNING = 24;

let allHorses = [];
let horseSelect;
let breedFilter;
let tagFilter;
// null = keine Präferenz hinterlegt (Gast oder kein Setting gespeichert) ->
// createBreedFilter fällt auf den APH-Standard zurück; [] = "Alle Rassen"
// bewusst gewählt (siehe user_settings.preferred_breeds in der
// MDR-Datenbank, dort dieselbe NULL-vs-leer-Unterscheidung); [...] =
// konkrete Rassen.
let defaultBreeds = null;
let currentHorse = null;
let foreignHorse = null; // per Freitext eingelesenes, nicht gespeichertes Pferd
let flaxenLookup = null;
let flaxenChildrenByName = null;
let childrenByParentName = new Map();

// --- Ø-Vergleich (Vorbild: MDR-Datenbank/js/list.js) - EIN gemeinsamer
// Umschalter für die ganze Seite. Bewusst vereinfacht gegenüber der
// Datenbank-Version: der Basiswert ist der Durchschnitt über ALLE aktuell
// geladenen Pferde (kein eigenes Rasse/Besitzer-Filter-Panel, keine
// zusätzliche Datenbankabfrage) - lokale, synchrone Berechnung. Ist er
// aktiv, kommt er als Hintergrundfarbe ZUSÄTZLICH zur sonst
// standardmäßigen Textfarben-Einfärbung gegen das ausgewählte Pferd selbst
// hinzu (siehe cellStyling) - zwei getrennte visuelle Kanäle für zwei
// unabhängige Fragen. ---
let compareBaseline = null; // null=aus, sonst {gp, ext, extPercent, int}
let compareTolerances = {}; // aus user_settings.compare_tolerances, {} für Gäste
let compareToleranceEnabled = true;

let relativesSort = { field: 'beziehung', dir: 'asc' };
let foalsSort = { field: 'gp', dir: 'desc' };
let colorSort = { field: 'label', dir: 'asc' };

document.addEventListener('DOMContentLoaded', init);

async function init() {
  document.querySelector('#tag-legend').innerHTML = tagLegendHtml();
  horseSelect = createSearchableSelect(
    document.querySelector('#horse-search'), document.querySelector('#horse-panel'),
    { onChange: onHorseSelect },
  );
  breedFilter = createBreedFilter(document.querySelector('#breed-drop'), { onChange: populateHorseSelect, initialSelection: () => defaultBreeds });
  tagFilter = createTagFilter(document.querySelector('#tag-drop'), { onChange: populateHorseSelect });
  document.querySelector('#owner-select').addEventListener('change', onOwnerChange);
  document.querySelector('#gender-select').addEventListener('change', populateHorseSelect);
  document.querySelector('#zzl-select').addEventListener('change', populateHorseSelect);
  ['filter-vater', 'filter-mutter', 'filter-kinder', 'filter-nachkommen'].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener('change', render);
  });
  document.querySelector('#filter-alle').addEventListener('change', onFilterAlleChange);
  applyFilterAlleState();
  document.querySelector('#rassefremde-select').addEventListener('change', render);
  document.querySelector('#foreign-horse-parse-btn').addEventListener('click', onForeignHorseParse);
  wireSortableHeaders();
  wireCompareAvg();
  wireTagSuggestHandlers('Zuchtbuch');
  await initAuthStatus();
  await loadCompareTolerances();
  await loadDefaultBreeds();
  await loadHorses();
  scrollToHashTarget();
}

// Springt die Startseiten-Karte "Aussortierhilfe" mit #aussortierhilfe-
// abschnitt in der URL ein, ist der native Browser-Sprung (passiert schon
// vor dem asynchronen Laden der Pferdeliste, bei noch leerem Ziel-Element)
// bereits ins Leere gelaufen - holt das nach dem Laden einmalig nach.
function scrollToHashTarget() {
  if (!window.location.hash) return;
  const target = document.querySelector(window.location.hash);
  if (target) target.scrollIntoView();
}

// --- Gemeinsame Pferdeauswahl ---

async function loadHorses() {
  const errorEl = document.querySelector('#load-error');
  const { data, error } = await supabaseClient.from('horses').select(ZUCHTBUCH_FIELDS).order('name');
  if (error) {
    errorEl.textContent =
      'Konnte Pferde nicht laden: ' + error.message +
      ' (falls die Seite ohne Login genutzt wird, muss dafür einmalig die Migration ' +
      '"migration_005_public_read_access.sql" im Supabase-Dashboard ausgeführt worden sein).';
    return;
  }
  allHorses = data || [];

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
  const gender = document.querySelector('#gender-select').value;
  const zzl = document.querySelector('#zzl-select').value;
  const filtered = allHorses.filter((h) => {
    if (owner && h.owner !== owner) return false;
    if (gender && h.gender !== gender) return false;
    if (zzl === 'zzl' && h.breeding_allowed !== true) return false;
    if (zzl === 'ohne' && h.breeding_allowed === true) return false;
    return breedFilter.matches(h) && tagFilter.matches(h);
  });
  horseSelect.setItems(filtered.map((h) => ({ id: h.id, label: h.name || '(ohne Name)' })));
}

function onOwnerChange() {
  populateHorseSelect();
  horseSelect.clear(); // löst onHorseSelect('') aus
}

// Auswahl per Dropdown ersetzt ein zuvor per Freitext eingelesenes
// datenbankfremdes Pferd wieder (Muster wie js/verwandtschaft.js beim
// "Datenbankfremdes Pferd"-Freitext).
function onHorseSelect(id) {
  if (id) {
    foreignHorse = null;
    document.querySelector('#foreign-horse-raw-text').value = '';
    document.querySelector('#foreign-horse-parse-status').textContent = '';
  }
  currentHorse = allHorses.find((h) => h.id === id) || null;
  render();
}

function onForeignHorseParse() {
  const text = document.querySelector('#foreign-horse-raw-text').value;
  const statusEl = document.querySelector('#foreign-horse-parse-status');
  if (!text.trim()) {
    statusEl.textContent = 'Bitte zuerst Text einfügen.';
    return;
  }
  foreignHorse = parseHorseText(text);
  horseSelect.clear(); // löst onHorseSelect('') aus - foreignHorse bleibt erhalten (id ist leer)
  statusEl.textContent = 'Erkannt: ' + (foreignHorse.name || 'kein Name gefunden');
  render();
}

// --- Ø-Vergleich ---

async function loadCompareTolerances() {
  if (!isLoggedIn()) { compareTolerances = {}; return; }
  const { data, error } = await supabaseClient
    .from('user_settings')
    .select('compare_tolerances')
    .eq('user_id', currentAuthSession.user.id)
    .maybeSingle();
  compareTolerances = (!error && data?.compare_tolerances) || {};
}

// Übernimmt dieselbe Rassen-Präferenz wie die Einstellungen in der
// MDR-Datenbank (user_settings.preferred_breeds - dort "Sichtbare Rassen
// in der Übersicht"), damit der Rassen-Filter hier nicht mehr fest auf
// APH steht, sondern für eingeloggte Nutzer die dort gewählten Rassen
// (oder "Alle", wenn preferred_breeds NULL ist). Kein eigener
// gespeicherter Zustand hier - reine Übernahme.
async function loadDefaultBreeds() {
  if (!isLoggedIn()) { defaultBreeds = null; return; }
  const { data, error } = await supabaseClient
    .from('user_settings')
    .select('preferred_breeds')
    .eq('user_id', currentAuthSession.user.id)
    .maybeSingle();
  defaultBreeds = (!error && data) ? (data.preferred_breeds || []) : null;
}

function effectiveTolerance(key) {
  return compareToleranceEnabled ? (compareTolerances[key] || 0) : 0;
}

// Durchschnitt über ALLE aktuell geladenen Pferde (bewusst vereinfachte
// v1, siehe Kopfkommentar) - synchron, ohne Datenbankabfrage.
function computeCompareBaseline() {
  const avg = (values) => {
    const nums = values.filter((v) => v != null && !Number.isNaN(v));
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  };
  return {
    gp: avg(allHorses.map((h) => horseGP(h))),
    ext: avg(allHorses.map((h) => horseExt(h))),
    extPercent: avg(allHorses.map((h) => horseExtPct(h))),
    int: avg(allHorses.map((h) => horseInt(h))),
  };
}

// Drei Stufen: cmp-good (besser als Basis), cmp-tolerance (schlechter, aber
// innerhalb der persönlichen Toleranz), cmp-bad (darüber hinaus schlechter).
function cmpClass(value, baseline, lowerIsBetter, tolerance = 0) {
  if (value == null || baseline == null) return '';
  const better = lowerIsBetter ? value < baseline : value > baseline;
  if (better) return 'cmp-good';
  const worse = lowerIsBetter ? value > baseline : value < baseline;
  if (!worse) return '';
  const beyondTolerance = lowerIsBetter ? value > baseline + tolerance : value < baseline - tolerance;
  return beyondTolerance ? 'cmp-bad' : 'cmp-tolerance';
}

function wireCompareAvg() {
  const toggle = document.querySelector('#compare-avg-toggle');
  const toleranceToggle = document.querySelector('#compare-tolerance-toggle');
  toggle.addEventListener('change', () => {
    compareBaseline = toggle.checked ? computeCompareBaseline() : null;
    render();
  });
  toleranceToggle.addEventListener('change', () => {
    compareToleranceEnabled = toleranceToggle.checked;
    render();
  });
}

// Zell-Einfärbung: Vergleich gegen das AUSGEWÄHLTE Pferd (Textfarbe) läuft
// immer. Ist der Ø-Vergleich zusätzlich aktiv, kommt die Bestands-
// Durchschnitts-Einfärbung als Hintergrundfarbe/Klasse HINZU (kombiniert
// statt ersetzt) - zwei getrennte visuelle Kanäle für zwei unabhängige
// Fragen ("besser als DIESES Pferd?" per Textfarbe, "besser als der
// Durchschnitt?" per Hintergrund), daher keine Überlagerung/Verwechslung.
function cellStyling(value, refValue, metric) {
  const color = compareColor(value, refValue, metric);
  const style = color ? `color:${color}; font-weight:600;` : '';
  let cls = '';
  if (compareBaseline) {
    const baseKey = metric === 'extpct' ? 'extPercent' : metric;
    const lowerIsBetter = metric === 'ext' || metric === 'int';
    cls = cmpClass(value, compareBaseline[baseKey], lowerIsBetter, effectiveTolerance(baseKey));
  }
  return { cls, style };
}

function compareColor(value, reference, metric) {
  if (value == null || reference == null) return '';
  if (value === reference) return 'var(--text)';
  const higherIsBetter = METRIC_HIGHER_IS_BETTER[metric];
  const better = higherIsBetter ? value > reference : value < reference;
  return better ? 'var(--success)' : 'var(--danger)';
}

// --- Gemeinsame Anzeige-Helfer ---

function computeDerived(h) {
  const gpRaw = h.tournament_potential?.['Gesamtpotenzial'];
  const genes = presentGenesSummary(h.colors, h.coat_color, h.notes, h.name, h.color_gene_overrides);
  return {
    presentGenes: genes.map((g) => g.alleles).join(' '),
    gp: gpRaw != null && gpRaw !== '' ? Number(gpRaw) : null,
    extAvg: averageScore(h.exterior_descriptive, scoreExteriorTerm),
    extPercent: h.exterior_genetics?.overall?.percent ?? null,
    intAvg: averageScore(h.temperament, scoreTemperamentTerm),
  };
}

function affectedDiseaseLabels(row) {
  return (row.genetic_diseases || []).filter((d) => isDiseaseCarrierOrAffected(d.value)).map((d) => d.label);
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

function nextSort(current, field, descFirst) {
  if (current.field === field) return { field, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { field, dir: descFirst ? 'desc' : 'asc' };
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

function wireTableSort(tableId, onSort) {
  document.addEventListener('click', (e) => {
    const th = e.target.closest(`#${tableId} th[data-sort]`);
    if (!th) return;
    onSort(th.dataset.sort);
  });
}

function wireSortableHeaders() {
  wireTableSort('relatives-table', (field) => { relativesSort = nextSort(relativesSort, field, false); render(); });
  wireTableSort('foals-table', (field) => { foalsSort = nextSort(foalsSort, field, field === 'gp' || field === 'extpct'); render(); });
  wireTableSort('color-table', (field) => { colorSort = nextSort(colorSort, field, false); render(); });
  wireMobileSort('relatives-mobile-sort', (field, dir) => { relativesSort = { field, dir }; render(); });
}

// Feld/Beschriftungs-Liste für das Handy-Sortier-Dropdown der Verwandten-
// Tabelle (siehe mobileSortSelectHtml) - muss zu den th[data-sort] oben in
// relativesTableHtml() passen, wird aber bewusst separat gehalten statt aus
// dem Header-HTML abgeleitet, da die Header-Zelle "Name" zusätzlich die
// sticky-name-Klasse trägt.
const RELATIVES_SORT_FIELDS = [
  { field: 'name', label: 'Name' },
  { field: 'beziehung', label: 'Beziehung' },
  { field: 'gender', label: 'Geschlecht' },
  { field: 'coat_color', label: 'Farbe' },
  { field: 'genetik', label: 'Genetik' },
  { field: 'gp', label: 'GP' },
  { field: 'ext', label: 'Ext' },
  { field: 'extpct', label: 'Ext%' },
  { field: 'int', label: 'Int' },
  { field: 'hlpslp', label: 'HLP/SLP' },
  { field: 'zzl', label: 'ZZL' },
  { field: 'ekh', label: 'EKH' },
  { field: 'owner', label: 'Besitzer' },
  { field: 'tag', label: 'Schlagwort' },
];

function rowTagSuggestHtml(horse) {
  if (!horse || !isLoggedIn() || !isOwnerOf(horse.owner)) return '';
  return tagSuggestButtonHtml(horse.id, horse.owner);
}

function fmt(v, digits) {
  return v == null ? '–' : v.toFixed(digits);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// --- Gemeinsamer Render-Einstieg (kein Reiter-Umschalter mehr) ---

function render() {
  const zbContainer = document.querySelector('#zuchtbuch-result');
  const ahContainer = document.querySelector('#aussortierhilfe-abschnitt');
  const horse = foreignHorse || currentHorse;
  if (!horse) {
    zbContainer.innerHTML = '<p class="muted small">Bitte zuerst ein Pferd auswählen.</p>';
    ahContainer.innerHTML = '';
    return;
  }
  let html = horseSummaryHtml(horse, null, true);
  html += parentsCardHtml(horse);
  html += relativesTableHtml(horse);
  html += foalTrackingHtml(horse);
  zbContainer.innerHTML = html;

  ahContainer.innerHTML = aussortierenSectionHtml(horse);
  applyStickyOffsets(zbContainer);
  applyStickyOffsets(ahContainer);
}

// Die Beziehung-Spalte steht vor der Name-Spalte und hat keine feste
// Breite (nowrap-Inhalt) - .sticky-name braucht also einen per JS
// gemessenen "left"-Versatz statt eines festen CSS-Werts, damit die
// Spalte beim horizontalen Scrollen sauber am linken Rand kleben bleibt.
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

// ==========================================================================
// Zuchtbuch-Teil (Verwandtschaftsübersicht)
// ==========================================================================

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
  if (alle) return { vater: true, mutter: true, kinder: true, nachkommen: true, alle: true };
  return {
    vater: document.querySelector('#filter-vater').checked,
    mutter: document.querySelector('#filter-mutter').checked,
    kinder: document.querySelector('#filter-kinder').checked,
    nachkommen: document.querySelector('#filter-nachkommen').checked,
    alle: false,
  };
}

function filterRelatives(relatives, filters) {
  return relatives.filter((r) => {
    if (r.beziehung === 'Vollgeschwister') return filters.vater || filters.mutter;
    if (r.beziehung === 'Halbgeschwister (Vater)') return filters.vater;
    if (r.beziehung === 'Halbgeschwister (Mutter)') return filters.mutter;
    if (r.beziehung === 'Kind') return filters.kinder || filters.nachkommen;
    return filters.nachkommen;
  });
}

function findExtendedRelatives(horse, horses, excludeIds) {
  const ownPositionByName = new Map();
  for (const entry of pedigreeNamePool(horse)) {
    if (entry.position === 'Pferd selbst') continue;
    const key = normalizeName(entry.name);
    if (!ownPositionByName.has(key)) ownPositionByName.set(key, entry.position);
  }
  const results = [];
  for (const other of horses) {
    if (other.id === horse.id || excludeIds.has(other.id)) continue;
    for (const entry of pedigreeNamePool(other)) {
      const positionOwn = ownPositionByName.get(normalizeName(entry.name));
      if (positionOwn) {
        results.push({ horse: other, beziehung: 'Weitere Verwandtschaft', beziehungDetail: extendedRelationDetail(entry.name, positionOwn, entry.position), sortRank: 50 });
        break;
      }
    }
  }
  return results;
}

// Kurzform "Weitere Verwandtschaft" steht in der Tabellenzelle, das Detail
// gibt es beim Hovern (title-Attribut, siehe relativeRowHtml).
function extendedRelationDetail(name, positionOwn, positionOther) {
  if (positionOther === 'Pferd selbst') {
    return `${positionOwn} dieses Pferds, selbst in der Datenbank: ${name}`;
  }
  return `Gemeinsamer Vorfahre: ${name} – bei diesem Pferd: ${positionOwn}, beim gefundenen Pferd: ${positionOther}`;
}

const GENERATION_LABELS = ['Kind', 'Enkelkind', 'Urenkelkind', 'Ururenkelkind'];
function generationLabel(n) {
  return GENERATION_LABELS[n - 1] || `Nachkomme (Generation ${n})`;
}

function findRelatives(horse, horses) {
  const results = [];
  const { father, mother } = parentNames(horse);

  for (const other of horses) {
    if (other.id === horse.id) continue;
    const p = parentNames(other);
    const sameFather = father && p.father && normalizeName(p.father) === normalizeName(father);
    const sameMother = mother && p.mother && normalizeName(p.mother) === normalizeName(mother);
    if (sameFather && sameMother) {
      results.push({ horse: other, beziehung: 'Vollgeschwister', sortRank: 1 });
    } else if (sameFather) {
      // Der gemeinsame Vater steht schon im Beziehungs-Label - ohne die
      // jeweils andere (nicht gemeinsame) Mutter dazuzuschreiben, sind bei
      // mehreren Halbgeschwistern (Vater) väterlicherseits nicht
      // unterscheidbar, von welcher Stute sie jeweils abstammen.
      results.push({ horse: other, beziehung: 'Halbgeschwister (Vater)', sortRank: 2, otherParent: p.mother ? { label: 'Mutter', name: p.mother } : null });
    } else if (sameMother) {
      results.push({ horse: other, beziehung: 'Halbgeschwister (Mutter)', sortRank: 3, otherParent: p.father ? { label: 'Vater', name: p.father } : null });
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
        const entry = { horse: child, beziehung: generationLabel(generation), sortRank: 3 + generation };
        // Nur bei "Kind" (generation 1) ist der jeweils ANDERE Elternteil
        // eindeutig auf das ausgewählte Pferd bezogen (der bekannte Elternteil
        // IST das ausgewählte Pferd) - bei tieferen Generationen (Enkelkind
        // etc.) wäre "der andere Elternteil" nur der eines Zwischen-Vorfahren,
        // nicht des ausgewählten Pferds selbst, daher hier bewusst nicht
        // ergänzt (Nutzerwunsch war explizit "bei Kindern").
        if (generation === 1) {
          const cp = parentNames(child);
          const isFather = cp.father && normalizeName(cp.father) === normalizeName(parent.name);
          const otherName = isFather ? cp.mother : cp.father;
          if (otherName) entry.otherParent = { label: isFather ? 'Mutter' : 'Vater', name: otherName };
        }
        results.push(entry);
        next.push(child);
      }
    }
    frontier = next;
  }

  return results;
}

function relativesSortValue(row, field) {
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
    case 'genetik': return d.presentGenes ? d.presentGenes.toLowerCase() : null;
    case 'ekh': { const ekh = affectedDiseaseLabels(row.horse); return ekh.length ? ekh.join(', ').toLowerCase() : null; }
    case 'tag': return tagSortValue(row.horse.tags);
    default: return null;
  }
}

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

function horseSummaryHtml(h, label, showRelatedness) {
  const d = computeDerived(h);
  const ekh = affectedDiseaseLabels(h);
  const age = h.birthdate ? formatAge(h.birthdate) : '';
  const heading = label ? `${escapeHtml(label)}: ${escapeHtml(h.name || '(ohne Name)')}` : escapeHtml(h.name || '(ohne Name)');
  const foreignNote = h.id == null ? '<p class="small muted">Datenbankfremdes Pferd (per Freitext eingelesen, nicht gespeichert).</p>' : '';
  return `<div class="result-card">
    <h2 class="name-with-tags">${heading}${tagsBadgesHtml(h.tags)}</h2>
    ${foreignNote}
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
      &nbsp;·&nbsp; Alter: <strong>${age || '–'}</strong>
      &nbsp;·&nbsp; HLP/SLP: <strong>${hlpSlpDisplay(h.hlp_slp)}</strong>
      &nbsp;·&nbsp; ZZL: <strong>${zzlDisplay(h.breeding_allowed)}</strong>
      &nbsp;·&nbsp; EKH: <strong style="${ekh.length ? 'color:var(--danger);' : ''}">${ekh.length ? escapeHtml(ekh.join(', ')) : '-'}</strong>
      &nbsp;·&nbsp; Besitzer: <strong>${h.owner ? escapeHtml(h.owner) : '–'}</strong>
    </p>
    ${showRelatedness ? relatednessSummaryHtml(h) : ''}
    <p class="small">${tagSuggestButtonHtml(h.id, h.owner)}</p>
  </div>`;
}

// Wie viele Pferde im Bestand sind mit diesem Pferd verwandt (irgendein
// gemeinsamer Name im sichtbaren Stammbaum, siehe findRelations in
// js/breeding.js), und bei wie vielen davon bestünde bei einer Verpaarung
// zusätzlich eine echte Inzucht-Gefahr (der gemeinsame Name würde im
// Stammbaum eines hypothetischen Fohlens doppelt auftauchen, siehe
// findSharedNames) - dieselbe Unterscheidung wie in der
// Verwandtschaftsmatrix-Einzelansicht (js/verwandtschaft.js). Nur für die
// oben ausgewählte/eingelesene Karte (nicht für Eltern-/Verwandten-Zeilen,
// das wäre pro Zeile schnell unübersichtlich).
function relatednessSummaryHtml(horse) {
  const related = allHorses.filter((h) => h.id !== horse.id).map((h) => {
    if (!findRelations(horse, h).length) return null;
    return { inbreeding: findSharedNames(horse, h).length > 0 };
  }).filter(Boolean);
  const inbreedingCount = related.filter((r) => r.inbreeding).length;
  let html = `<p class="small muted">Verwandt mit <strong>${related.length}</strong> Pferden im Bestand, davon <strong>${inbreedingCount}</strong> auf Inzuchtniveau (gemeinsamer Vorfahre würde im Stammbaum eines gemeinsamen Fohlens doppelt auftauchen).</p>`;
  const breedCoiPct = estimateBreedRelatedness(horse, allHorses);
  if (breedCoiPct != null) {
    html += `<p class="small muted">Ø Verwandtschaftsgrad zu allen ${horse.breed ? escapeHtml(horse.breed) : 'Pferden derselben Rasse'}-Pferden im Bestand: <strong>${breedCoiPct.toFixed(1)}%</strong></p>`;
  }
  return html;
}

function applyRassefremdeFilter(relatives, horse) {
  const mode = document.querySelector('#rassefremde-select').value;
  if (mode === 'alle' || !horse.breed) return relatives;
  return relatives.filter((r) => {
    const sameBreed = r.horse.breed === horse.breed;
    return mode === 'ausblenden' ? sameBreed : !sameBreed;
  });
}

function relativeCountsHtml(allRelatives) {
  const counts = { kinder: 0, enkel: 0, hgMutter: 0, hgVater: 0, sonstige: 0 };
  for (const r of allRelatives) {
    if (r.beziehung === 'Kind') counts.kinder++;
    else if (r.beziehung === 'Enkelkind') counts.enkel++;
    else if (r.beziehung === 'Halbgeschwister (Mutter)') counts.hgMutter++;
    else if (r.beziehung === 'Halbgeschwister (Vater)') counts.hgVater++;
    else counts.sonstige++;
  }
  return `<p class="small muted">
    Kinder: <strong>${counts.kinder}</strong>
    &nbsp;·&nbsp; Enkelkinder: <strong>${counts.enkel}</strong>
    &nbsp;·&nbsp; Halbgeschwister (Mutter): <strong>${counts.hgMutter}</strong>
    &nbsp;·&nbsp; Halbgeschwister (Vater): <strong>${counts.hgVater}</strong>
    &nbsp;·&nbsp; Sonstige Verwandte: <strong>${counts.sonstige}</strong>
  </p>`;
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
  relatives = applyRassefremdeFilter(relatives, horse);
  relatives = applySortGeneric(relatives, relativesSort, relativesSortValue);

  let html = '<div class="group-heading">Verwandtschaftsübersicht</div>';
  html += relativeCountsHtml(allRelatives);
  if (!relatives.length) {
    html += allRelatives.length
      ? '<p class="small muted">Keine Verwandten mit den aktuell aktivierten Kategorien - oben weitere Häkchen setzen.</p>'
      : '<p class="small muted">Keine Verwandten im sichtbaren Stammbaum gefunden.</p>';
    return html;
  }
  const refD = computeDerived(horse);
  html += `<p class="small muted">Vergleich gegen die eigenen Werte des ausgewählten Pferds oben - grün (besser), rot (schlechter) oder schwarz (gleich); bei aktivem Ø-Vergleich zusätzlich als Hintergrundfarbe gegen den Bestandsdurchschnitt.</p>`;
  html += mobileSortSelectHtml('relatives-mobile-sort', RELATIVES_SORT_FIELDS, relativesSort);
  html += `<div class="table-wrap"><table id="relatives-table" class="mobile-cards">
    <thead><tr>
      <th data-sort="name" class="sticky-name">Name${sortArrow(relativesSort, 'name')}</th>
      <th data-sort="beziehung">Beziehung${sortArrow(relativesSort, 'beziehung')}</th>
      <th data-sort="gender">Geschlecht${sortArrow(relativesSort, 'gender')}</th>
      <th data-sort="coat_color">Farbe${sortArrow(relativesSort, 'coat_color')}</th>
      <th data-sort="genetik">Genetik${sortArrow(relativesSort, 'genetik')}</th>
      <th data-sort="gp">GP${sortArrow(relativesSort, 'gp')}</th>
      <th data-sort="ext">Ext${sortArrow(relativesSort, 'ext')}</th>
      <th data-sort="extpct">Ext%${sortArrow(relativesSort, 'extpct')}</th>
      <th data-sort="int">Int${sortArrow(relativesSort, 'int')}</th>
      <th data-sort="hlpslp">HLP/SLP${sortArrow(relativesSort, 'hlpslp')}</th>
      <th data-sort="zzl">ZZL${sortArrow(relativesSort, 'zzl')}</th>
      <th data-sort="ekh">EKH${sortArrow(relativesSort, 'ekh')}</th>
      <th data-sort="owner">Besitzer${sortArrow(relativesSort, 'owner')}</th>
      <th data-sort="tag">Schlagwort${sortArrow(relativesSort, 'tag')}</th>
    </tr></thead>
    <tbody>${relatives.map((r) => relativeRowHtml(r, refD)).join('')}</tbody>
  </table></div>`;
  return html;
}

function relativeRowHtml(r, refD) {
  const h = r.horse;
  const d = computeDerived(h);
  const ekh = affectedDiseaseLabels(h);
  const cell = (metric, digits, value, refValue, formatted) => {
    const { cls, style } = cellStyling(value, refValue, metric);
    return `<td data-label="${metric}" class="${cls}" style="${style}">${formatted}</td>`;
  };
  return `<tr>
    <td data-label="Name" class="sticky-name" style="${tagCellStyle(h.tags)}">${escapeHtml(h.name || '(ohne Name)')}</td>
    <td data-label="Beziehung"${r.beziehungDetail ? ` title="${escapeHtml(r.beziehungDetail)}"` : ''}><span>${escapeHtml(r.beziehung)}${r.otherParent ? `<br><span class="small muted">${escapeHtml(r.otherParent.label)}: ${escapeHtml(r.otherParent.name)}</span>` : ''}</span></td>
    <td data-label="Geschlecht">${escapeHtml(h.gender || '')}</td>
    <td data-label="Farbe">${escapeHtml(h.coat_color || '')}</td>
    <td data-label="Genetik" class="small" style="font-family: ui-monospace, monospace;">${escapeHtml(d.presentGenes)}</td>
    ${cell('gp', 0, d.gp, refD.gp, d.gp != null ? d.gp : '')}
    ${cell('ext', 2, d.extAvg, refD.extAvg, d.extAvg != null ? d.extAvg.toFixed(2) : '')}
    ${cell('extpct', 1, d.extPercent, refD.extPercent, d.extPercent != null ? d.extPercent + '%' : '')}
    ${cell('int', 2, d.intAvg, refD.intAvg, d.intAvg != null ? d.intAvg.toFixed(2) : '')}
    <td data-label="HLP/SLP">${hlpSlpDisplay(h.hlp_slp)}</td>
    <td data-label="ZZL">${zzlDisplay(h.breeding_allowed)}</td>
    <td data-label="EKH">${ekh.length ? escapeHtml(ekh.join(', ')) : '-'}</td>
    <td data-label="Besitzer">${h.owner ? escapeHtml(h.owner) : ''}</td>
    <td data-label="Schlagwort" style="${tagCellStyle(h.tags)}">${tagCellText(h.tags)}${rowTagSuggestHtml(h)}</td>
  </tr>`;
}

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

function verdictRowHtml(label, actual, best, worst, fmtVal) {
  if (actual == null || best == null || worst == null) {
    return `<p class="small muted">${escapeHtml(label)}: nicht genug Daten für einen Vergleich.</p>`;
  }
  const lo = Math.min(best, worst), hi = Math.max(best, worst);
  const inRange = actual >= lo && actual <= hi;
  const verdict = inRange
    ? '<span style="color:var(--success)">✓ im vorhergesagten Bereich</span>'
    : '<span style="color:var(--danger)">✗ außerhalb des vorhergesagten Bereichs</span>';
  return `<p class="small">${escapeHtml(label)}: tatsächlich <strong>${fmtVal(actual)}</strong>, vorhergesagt <strong>${fmtVal(lo)}–${fmtVal(hi)}</strong> - ${verdict}</p>`;
}

// ==========================================================================
// Aussortierhilfe-Teil (eigene Fohlen im Vergleich)
// ==========================================================================

function ageWarningHtml(horse) {
  const years = gameAgeYears(horse.birthdate);
  if (years == null || years < BREEDING_AGE_WARNING) return '';
  return `<div class="notice notice-caution">⚠️ ${escapeHtml(horse.name || 'Dieses Pferd')} ist ${years} Spieljahre alt - ab ${MAX_BREEDING_AGE} Jahren nicht mehr in der Zuchtplaner-Auswahl.</div>`;
}

// referenceHorse liefert die Vergleichsbasis für die "besser/schlechter
// als das ausgewählte Pferd"-Einfärbung (compareColor); bei aktivem
// Ø-Vergleich kommt die Bestandsdurchschnitts-Einfärbung als Hintergrund
// zusätzlich hinzu (siehe cellStyling).
function valueComparisonTableHtml(tableId, rows, referenceHorse, sort, ownerHighlight) {
  const data = rows.map((r) => {
    const ekh = r.horse ? affectedDiseaseLabels(r.horse) : [];
    return {
      ...r,
      name: r.horse ? (r.horse.name || '(ohne Name)') : (r.name || ''),
      gender: r.horse ? r.horse.gender : null,
      owner: r.horse ? r.horse.owner : null,
      ekh,
      ekhLabel: ekh.length ? ekh.join(', ').toLowerCase() : null,
      gp: r.horse ? horseGP(r.horse) : null,
      ext: r.horse ? horseExt(r.horse) : null,
      extpct: r.horse ? horseExtPct(r.horse) : null,
      int: r.horse ? horseInt(r.horse) : null,
      tag: r.horse ? tagSortValue(r.horse.tags) : null,
    };
  });
  const ref = { gp: horseGP(referenceHorse), ext: horseExt(referenceHorse), extpct: horseExtPct(referenceHorse), int: horseInt(referenceHorse) };

  const sorted = applySortGeneric(data, sort, (row, field) => row[field]);

  const rowsHtml = sorted.map((row) => {
    const isRef = row.horse && referenceHorse && row.horse.id === referenceHorse.id;
    const name = row.horse ? (row.horse.name || '(ohne Name)') : `${row.name || ''} (nicht in der Datenbank)`;
    const cell = (metric, digits) => {
      const v = row[metric];
      if (!row.resolved || isRef) return `<td data-label="${metric}">${fmt(v, digits)}</td>`;
      const { cls, style } = cellStyling(v, ref[metric], metric);
      return `<td data-label="${metric}" class="${cls}" style="${style}">${fmt(v, digits)}</td>`;
    };
    let ownerCell = '';
    if (ownerHighlight !== undefined) {
      const matches = row.horse && (row.owner || null) === (ownerHighlight || null);
      const style = matches ? 'background:rgba(107,157,0,0.15); font-weight:600;' : '';
      ownerCell = `<td data-label="Besitzer" style="${style}">${row.owner ? escapeHtml(row.owner) : '–'}${matches ? ' ✓' : ''}</td>`;
    }
    return `<tr${isRef ? ' style="font-weight:600;"' : ''}>
      <td data-label="Name" class="sticky-name" style="${row.horse ? tagCellStyle(row.horse.tags) : ''}">${escapeHtml(name)}</td>
      <td data-label="Beziehung">${escapeHtml(row.label)}</td>
      <td data-label="Geschlecht">${row.gender ? escapeHtml(row.gender) : '–'}</td>
      <td data-label="EKH" style="${row.ekh.length ? 'color:var(--danger); font-weight:600;' : ''}">${row.ekh.length ? escapeHtml(row.ekh.join(', ')) : '–'}</td>
      ${ownerCell}
      ${cell('gp', 0)}
      ${cell('ext', 2)}
      ${cell('extpct', 1)}
      ${cell('int', 2)}
      <td data-label="Schlagwort" style="${row.horse ? tagCellStyle(row.horse.tags) : ''}">${row.horse ? tagCellText(row.horse.tags) : ''}${rowTagSuggestHtml(row.horse)}</td>
    </tr>`;
  }).join('');

  const ownerHeader = ownerHighlight !== undefined ? `<th data-sort="owner">Besitzer${sortArrow(sort, 'owner')}</th>` : '';
  return `<div class="table-wrap"><table id="${tableId}" class="mobile-cards">
    <thead><tr>
      <th data-sort="name" class="sticky-name">Name${sortArrow(sort, 'name')}</th>
      <th data-sort="label">Beziehung${sortArrow(sort, 'label')}</th>
      <th data-sort="gender">Geschlecht${sortArrow(sort, 'gender')}</th>
      <th data-sort="ekhLabel">EKH${sortArrow(sort, 'ekhLabel')}</th>
      ${ownerHeader}
      <th data-sort="gp">GP${sortArrow(sort, 'gp')}</th>
      <th data-sort="ext">Ext${sortArrow(sort, 'ext')}</th>
      <th data-sort="extpct">Ext%${sortArrow(sort, 'extpct')}</th>
      <th data-sort="int">Int${sortArrow(sort, 'int')}</th>
      <th data-sort="tag">Schlagwort${sortArrow(sort, 'tag')}</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>`;
}

function colorSortValue(row, field) {
  if (field === 'label') return (row.label || '').toLowerCase();
  if (field === 'name') {
    const n = row.horse ? row.horse.name : row.name;
    return (n || '').toLowerCase();
  }
  const wish = SPECIAL_COLOR_WISHES.find((w) => w.label === field);
  if (wish) return row.horse ? (colorWishPossible(row.horse, wish, flaxenLookup, flaxenChildrenByName) ? 1 : 0) : 0;
  return null;
}

function colorComparisonTableHtml(rows) {
  const sorted = applySortGeneric(rows, colorSort, colorSortValue);
  const cells = (row) => SPECIAL_COLOR_WISHES.map((wish) => {
    const has = row.horse ? colorWishPossible(row.horse, wish, flaxenLookup, flaxenChildrenByName) : false;
    return `<td data-label="${escapeHtml(wish.label)}" style="text-align:center; ${has ? `color:${'var(--success)'}; font-weight:700;` : 'opacity:0.4;'}">${has ? '✓' : '–'}</td>`;
  }).join('');

  const rowsHtml = sorted.map((row) => {
    const name = row.horse ? (row.horse.name || '(ohne Name)') : `${row.name || ''} (nicht in der Datenbank)`;
    return `<tr${row.isReference ? ' style="font-weight:600;"' : ''}>
      <td data-label="Name" class="sticky-name" style="${row.horse ? tagCellStyle(row.horse.tags) : ''}">${escapeHtml(name)}</td>
      <td data-label="Beziehung">${escapeHtml(row.label)}</td>
      ${cells(row)}
    </tr>`;
  }).join('');

  const header = SPECIAL_COLOR_WISHES.map((w) => `<th data-sort="${escapeHtml(w.label)}">${escapeHtml(w.label)}${sortArrow(colorSort, w.label)}</th>`).join('');
  return `<div class="table-wrap"><table id="color-table" class="mobile-cards">
    <thead><tr>
      <th data-sort="name" class="sticky-name">Name${sortArrow(colorSort, 'name')}</th>
      <th data-sort="label">Beziehung${sortArrow(colorSort, 'label')}</th>
      ${header}
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>`;
}

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

function aussortierenSectionHtml(horse) {
  const foals = childrenByParentName.get(normalizeName(horse.name)) || [];
  let html = '<div class="group-heading">Aussortierhilfe: eigene Fohlen im Vergleich</div>';
  html += ageWarningHtml(horse);
  html += `<p class="small muted">${foals.length} Fohlen im sichtbaren Stammbaum der übrigen Pferde gefunden.</p>`;

  if (!foals.length) return html;

  const owner = horse.owner || null;
  const stillOwned = foals.filter((f) => (f.owner || null) === owner);
  html += `<p class="small muted">Vergleich gegen die eigenen Werte des Elternteils oben - grün (besser), rot (schlechter) oder schwarz (gleich); bei aktivem Ø-Vergleich zusätzlich als Hintergrundfarbe gegen den Bestandsdurchschnitt. Die Besitzer-Spalte markiert Fohlen, die noch beim aktuellen Besitzer (${owner ? escapeHtml(owner) : 'unbekannt'}) sind (<strong>${stillOwned.length} von ${foals.length}</strong>).</p>`;

  const myIdentity = currentIdentity();
  if (myIdentity && (!owner || myIdentity.toLowerCase() !== owner.toLowerCase())) {
    const mine = foals.filter((f) => (f.owner || '').toLowerCase() === myIdentity.toLowerCase());
    html += `<p class="small muted">Davon <strong>${mine.length} von ${foals.length}</strong> bei Ihnen (${escapeHtml(myIdentity)}).</p>`;
  }

  const rows = foals.map((f) => ({ label: 'Fohlen', horse: f, resolved: true }));
  html += valueComparisonTableHtml('foals-table', rows, horse, foalsSort, owner);

  html += '<div class="group-heading">Farbvergleich (Sondergene)</div>';
  html += colorPassOnSummary(horse, foals);
  html += colorComparisonTableHtml([{ label: 'Ausgewähltes Pferd', horse, isReference: true }, ...rows]);

  html += diseaseInheritanceSummary(horse, foals);

  return html;
}
