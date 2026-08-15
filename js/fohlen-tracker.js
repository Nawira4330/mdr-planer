// Fohlen-Tracker: filterbare Übersichtstabelle mit Verwandten-Zählung je
// Pferd (aufklappbar zu den eigenen Fohlen), als zweiter Reiter eine
// Top 20 der Pferde mit den meisten Fohlen. Eigenständige Seite (kein
// gemeinsamer Reiter mit Zuchtbuch/Aussortierhilfe, auf Nutzerwunsch
// getrennt). Elternschaft ist ausschließlich über Namen im pedigree-Feld
// auflösbar (kein mother_id/father_id in der DB).

const TRACKER_FIELDS =
  'id,name,owner,gender,coat_color,colors,notes,pedigree,tournament_potential,exterior_genetics,exterior_descriptive,temperament,breeding_allowed,breed,tags';

let allHorses = [];
let breedFilter;
let tagFilter;
let topBreedFilter;
let topTagFilter;
let childrenByParentName = new Map();
let trackerSort = { field: 'gp', dir: 'desc' };
let trackerSubSort = { field: 'gp', dir: 'desc' };
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
  breedFilter = createBreedFilter(document.querySelector('#breed-drop'), { onChange: renderTrackerTab });
  tagFilter = createTagFilter(document.querySelector('#tag-drop'), { onChange: renderTrackerTab });
  document.querySelector('#owner-select').addEventListener('change', renderTrackerTab);
  document.querySelector('#gender-select').addEventListener('change', renderTrackerTab);
  document.querySelector('#zzl-select').addEventListener('change', renderTrackerTab);
  wireTrackerToggle();
  wireSortableHeaders();
  wireTopToggle();
  topBreedFilter = createBreedFilter(document.querySelector('#top-breed-drop'), { onChange: renderTop });
  topTagFilter = createTagFilter(document.querySelector('#top-tag-drop'), { onChange: renderTop });
  document.querySelector('#top-owner-select').addEventListener('change', renderTop);
  document.querySelector('#top-gender-select').addEventListener('change', renderTop);
  document.querySelector('#top-zzl-select').addEventListener('change', renderTop);
  wireTagSuggestHandlers('Fohlen-Tracker');
  await initAuthStatus();
  await loadHorses();
}

async function loadHorses() {
  const errorEl = document.querySelector('#load-error');
  const { data, error } = await supabaseClient.from('horses').select(TRACKER_FIELDS).order('name');
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
  renderTrackerTab();
  renderTop();
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
    extPercent: h.exterior_genetics?.overall?.percent ?? null,
    intAvg: averageScore(h.temperament, scoreTemperamentTerm),
  };
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
  relatednessCachesBuilt = true;
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
  const own = ancestorPoolById.get(horse.id);
  if (!own || !own.size) return 0;
  let n = 0;
  for (const other of pool) {
    if (other.id === horse.id) continue;
    const otherSet = ancestorPoolById.get(other.id);
    if (!otherSet) continue;
    for (const name of own) { if (otherSet.has(name)) { n++; break; } }
  }
  return n;
}

function countRelatedInzucht(horse, pool) {
  const namesA = inzuchtNamesById.get(horse.id) || [];
  if (hasInternalDuplicate(namesA)) return null;
  const setA = new Set(namesA);
  let n = 0;
  for (const other of pool) {
    if (other.id === horse.id) continue;
    const namesB = inzuchtNamesById.get(other.id) || [];
    if (hasInternalDuplicate(namesB) || namesB.some((name) => setA.has(name))) n++;
  }
  return n;
}

function wireTrackerToggle() {
  document.addEventListener('click', (e) => {
    const row = e.target.closest('#tracker-table tr.tracker-row[data-id]');
    if (!row) return;
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

function renderTrackerTab() {
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
      verwandte: countRelatedWide(h, filtered),
      inzucht: countRelatedInzucht(h, filtered),
    };
  });
  const sorted = applySortGeneric(rows, trackerSort, trackerSortValue);

  let html = `<p class="small muted">Zeigt ${filtered.length} Pferde entsprechend der Auswahl oben. Verwandten-Zählung bezieht sich auf diese gefilterte Menge (Filter anpassen, um gegen mehr/weniger Pferde zu prüfen).</p>`;
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

function trackerRowHtml(row) {
  const h = row.horse;
  const d = row.d;
  const expanded = expandedTrackerIds.has(h.id);
  const inzuchtCell = row.inzucht == null
    ? '<td data-label="Inzucht" title="Dieses Pferd hat bereits eine Namensdopplung im eigenen sichtbaren Stammbaum - die Zahl gegen alle anderen Pferde wäre dadurch trivial und irreführend.">Selbst bereits eingezüchtet</td>'
    : `<td data-label="Inzucht">${row.inzucht}</td>`;
  let html = `<tr class="tracker-row" data-id="${escapeHtml(h.id)}" style="cursor:pointer;">
    <td data-label="Pferdename" class="name-with-tags sticky-name" style="${tagCellStyle(h.tags)}">${expanded ? '▾ ' : '▸ '}${escapeHtml(h.name || '(ohne Name)')}</td>
    <td data-label="Geschlecht">${escapeHtml(h.gender || '–')}</td>
    <td data-label="GP">${d.gp != null ? d.gp : '–'}</td>
    <td data-label="Ext">${d.extAvg != null ? d.extAvg.toFixed(2) : '–'}</td>
    <td data-label="Ext%">${d.extPercent != null ? d.extPercent + '%' : '–'}</td>
    <td data-label="Int">${d.intAvg != null ? d.intAvg.toFixed(2) : '–'}</td>
    <td data-label="Farbe">${escapeHtml(h.coat_color || '–')}</td>
    <td data-label="HF">${row.hf}</td>
    <td data-label="SF">${row.sf}</td>
    <td data-label="Verwandte">${row.verwandte}</td>
    ${inzuchtCell}
    <td data-label="Besitzer">${h.owner ? escapeHtml(h.owner) : '–'}</td>
    <td data-label="Schlagwort" style="${tagCellStyle(h.tags)}">${tagCellText(h.tags)}</td>
  </tr>`;
  if (expanded) {
    const foals = childrenByParentName.get(normalizeName(h.name)) || [];
    html += `<tr class="tracker-subrow"><td colspan="${TRACKER_COLSPAN}">${trackerSubTableHtml(foals)}</td></tr>`;
  }
  return html;
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
    case 'tag': return tagSortValue(row.horse.tags);
    default: return null;
  }
}

function trackerSubTableHtml(foals) {
  const pool = trackerFilteredHorses();
  if (!foals.length) return '<p class="small muted" style="margin:0.3rem 0;">Keine eigenen Fohlen im sichtbaren Stammbaum der übrigen Pferde gefunden.</p>';
  const rows = foals.map((h) => ({ horse: h, d: computeDerived(h), verwandte: countRelatedWide(h, pool), inzucht: countRelatedInzucht(h, pool) }));
  const sorted = applySortGeneric(rows, trackerSubSort, trackerSubSortValue);
  const th = (field, label, extra) => `<th data-sort="${field}"${extra || ''}>${label}${sortArrow(trackerSubSort, field)}</th>`;
  return `<div class="table-wrap"><table class="tracker-subtable">
    <thead><tr>
      ${th('name', 'Pferdename', ' class="sticky-name"')}
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
  return `<tr>
    <td data-label="Pferdename" class="name-with-tags sticky-name" style="${tagCellStyle(h.tags)}">${escapeHtml(h.name || '(ohne Name)')}</td>
    <td data-label="Geschlecht">${escapeHtml(h.gender || '–')}</td>
    <td data-label="GP">${d.gp != null ? Math.round(d.gp) : '–'}</td>
    <td data-label="Ext">${d.extAvg != null ? d.extAvg.toFixed(2) : '–'}</td>
    <td data-label="Ext%">${d.extPercent != null ? d.extPercent.toFixed(2) : '–'}</td>
    <td data-label="Int">${d.intAvg != null ? d.intAvg.toFixed(2) : '–'}</td>
    <td data-label="Farbe">${escapeHtml(h.coat_color || '–')}</td>
    <td data-label="Verwandte">${row.verwandte}</td>
    <td data-label="Inzucht">${row.inzucht == null ? 'Selbst bereits eingezüchtet' : row.inzucht}</td>
    <td data-label="Besitzer">${h.owner ? escapeHtml(h.owner) : '–'}</td>
    <td data-label="Schlagwort" style="${tagCellStyle(h.tags)}">${tagCellText(h.tags)}</td>
  </tr>`;
}

// --- Top 20 meiste Fohlen ---

function renderTop() {
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
    <td data-label="Name" class="name-with-tags sticky-name" style="${tagCellStyle(h.tags)}">${escapeHtml(h.name || '(ohne Name)')}</td>
    <td data-label="Geschlecht">${escapeHtml(h.gender || '–')}</td>
    <td data-label="Rasse">${escapeHtml(h.breed || '–')}</td>
    <td data-label="Besitzer">${h.owner ? escapeHtml(h.owner) : '–'}</td>
    <td data-label="ZZL">${zzlDisplay(h.breeding_allowed)}</td>
    <td data-label="Fohlen">${r.count}</td>
    <td data-label="Schlagwort" style="${tagCellStyle(h.tags)}">${tagCellText(h.tags)}</td>
  </tr>`;
  if (expanded) {
    const foals = childrenByParentName.get(normalizeName(h.name)) || [];
    html += `<tr class="foal-subrow"><td colspan="${TOP_ROW_COLSPAN}">${topFoalSubTableHtml(foals)}</td></tr>`;
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
    case 'tag': return tagSortValue(row.horse.tags);
    default: return null;
  }
}

function topFoalSubTableHtml(foals) {
  const rows = foals.map((h) => ({ horse: h, d: computeDerived(h) }));
  const sorted = applySortGeneric(rows, topSubSort, topFoalSubSortValue);
  const th = (field, label, extra) => `<th data-sort="${field}"${extra || ''}>${label}${sortArrow(topSubSort, field)}</th>`;
  return `<div class="table-wrap"><table class="top-subtable">
    <thead><tr>
      ${th('name', 'Name', ' class="sticky-name"')}
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
  return `<tr>
    <td data-label="Name" class="name-with-tags sticky-name" style="${tagCellStyle(h.tags)}">${escapeHtml(h.name || '(ohne Name)')}</td>
    <td data-label="Rasse">${escapeHtml(h.breed || '–')}</td>
    <td data-label="Geschlecht">${escapeHtml(h.gender || '–')}</td>
    <td data-label="GP">${d.gp != null ? Math.round(d.gp) : '–'}</td>
    <td data-label="Ext">${d.extAvg != null ? d.extAvg.toFixed(2) : '–'}</td>
    <td data-label="Ext%">${d.extPercent != null ? d.extPercent.toFixed(2) : '–'}</td>
    <td data-label="Int">${d.intAvg != null ? d.intAvg.toFixed(2) : '–'}</td>
    <td data-label="ZZL">${zzlDisplay(h.breeding_allowed)}</td>
    <td data-label="Farbe">${escapeHtml(h.coat_color || '–')}</td>
    <td data-label="Besitzer">${h.owner ? escapeHtml(h.owner) : '–'}</td>
    <td data-label="Schlagwort" style="${tagCellStyle(h.tags)}">${tagCellText(h.tags)}</td>
  </tr>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
