// Felder, die für Inzuchtprüfung, Overo-Erkennung, die Mutter/Vater-
// Kennzahlen und den Verpaarungsratgeber (inkl. GP-Formel und
// Genotyp-basierter Fohlen-Vorhersage) gebraucht werden.
const HORSE_SELECT_FIELDS =
  'id,name,owner,gender,breed,purebred_pct,coat_color,breeding_allowed,colors,notes,pedigree,tournament_potential,exterior_genetics,exterior_descriptive,temperament,traits,disciplines,genetic_diseases';

// Leichtere Feldauswahl für die Datenbank-Schätzung (computeEmpiricalDeviations):
// braucht ALLE Pferde (auch ohne ZZL, jedes Geschlecht), aber nur die Felder,
// die für GP/Ext/Ext%/Int und den Stammbaum nötig sind.
const STATS_SELECT_FIELDS =
  'id,name,pedigree,tournament_potential,exterior_genetics,exterior_descriptive,temperament';

let mares = [];
let stallions = [];
let foreignStallion = null; // per Freitext eingelesener, nicht gespeicherter Hengst
let activeTab = 'inzucht';
let mareSelect, stallionSelect;
let mareBreedFilter, stallionBreedFilter;
let schwerpunkt = 'gp';
let sortMode = 'best';
let empiricalDeviations = null; // wird nach loadHorses() befüllt, siehe loadEmpiricalDeviations()

document.addEventListener('DOMContentLoaded', init);

async function init() {
  wireTabButtons();
  mareSelect = createSearchableSelect(
    document.querySelector('#mare-search'), document.querySelector('#mare-panel'),
    { onChange: onMareChange },
  );
  stallionSelect = createSearchableSelect(
    document.querySelector('#stallion-search'), document.querySelector('#stallion-panel'),
    { onChange: onStallionChange },
  );
  document.querySelector('#mare-owner-select').addEventListener('change', onMareOwnerChange);
  document.querySelector('#stallion-owner-select').addEventListener('change', onStallionOwnerChange);
  mareBreedFilter = createBreedFilter(document.querySelector('#mare-breed-drop'), { onChange: onMareOwnerChange });
  stallionBreedFilter = createBreedFilter(document.querySelector('#stallion-breed-drop'), { onChange: onStallionOwnerChange });
  document.querySelector('#stallion-parse-btn').addEventListener('click', onStallionParse);
  document.querySelector('#schwerpunkt-select').addEventListener('change', (e) => {
    schwerpunkt = e.target.value;
    renderBestMatches();
  });
  document.querySelector('#sortierung-select').addEventListener('change', (e) => {
    sortMode = e.target.value;
    renderBestMatches();
  });
  wireFarbwunschDropdown();
  document.addEventListener('click', onDecksprungClick);
  await loadHorses();
  loadEmpiricalDeviations(); // unabhängig von loadHorses(), blockiert die Seite nicht
  // Erst NACH mareSelect/stallionSelect + loadHorses() aktivieren, da
  // activateTab('auswahl') sonst renderBestMatches() aufruft, bevor
  // mareSelect existiert bzw. Pferde geladen sind (führte zu einem
  // Fehler, der die komplette init()-Funktion abbrach - Suchfelder
  // blieben dann funktionslos, z.B. via "zuchtplaner.html?tab=auswahl").
  activateTabFromUrl();
}

// Lädt ALLE Pferde (unabhängig von ZZL/Geschlecht) einmalig, um daraus die
// Datenbank-Schätzung (3. Version neben Best-/Worst-Case) zu berechnen -
// siehe computeEmpiricalDeviations in js/verpaarung.js. Läuft im Hintergrund
// und rendert bei Erfolg neu, damit die Seite nicht auf diesen Extra-Request
// warten muss.
async function loadEmpiricalDeviations() {
  const { data, error } = await supabaseClient.from('horses').select(STATS_SELECT_FIELDS);
  if (error || !data) return;
  empiricalDeviations = computeEmpiricalDeviations(data);
  renderInzuchtResult();
  if (activeTab === 'auswahl') renderBestMatches();
}

function wireFarbwunschDropdown() {
  const root = document.querySelector('#farbwunsch-drop');
  const toggle = root.querySelector('.checkdrop-toggle');
  const panel = root.querySelector('.checkdrop-panel');
  panel.innerHTML = COLOR_WISH_OPTIONS.map((o) => `
    <label class="checkdrop-item">
      <input type="checkbox" value="${escapeHtml(o.label)}" />
      <span>${escapeHtml(o.label)}</span>
    </label>
  `).join('');

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#farbwunsch-drop')) panel.hidden = true;
  });
  panel.addEventListener('change', () => {
    const checked = [...panel.querySelectorAll('input:checked')];
    toggle.textContent = checked.length ? `${checked.length} ausgewählt` : 'Alle';
    renderBestMatches();
  });
}

function selectedFarbwuensche() {
  return [...document.querySelectorAll('#farbwunsch-drop input:checked')].map((cb) => cb.value);
}

async function loadHorses() {
  const errorEl = document.querySelector('#load-error');
  const [mareRes, stallionRes] = await Promise.all([
    supabaseClient.from('horses').select(HORSE_SELECT_FIELDS).eq('gender', 'Stute').order('name'),
    supabaseClient.from('horses').select(HORSE_SELECT_FIELDS).eq('gender', 'Hengst').order('name'),
  ]);

  if (mareRes.error || stallionRes.error) {
    errorEl.textContent =
      'Konnte Pferde nicht laden: ' + (mareRes.error?.message || stallionRes.error?.message) +
      ' (falls die Seite ohne Login genutzt wird, muss dafür einmalig die Migration ' +
      '"migration_005_public_read_access.sql" im Supabase-Dashboard ausgeführt worden sein).';
    return;
  }

  // Nur Pferde mit ZZL (Zuchtzulassung) - der Zuchtplaner soll bei der
  // tatsächlichen Zuchtplanung helfen, das setzt eine bereits erteilte
  // Zuchtzulassung voraus (Gegenteil vom Turnierplaner, der bewusst nur
  // Pferde OHNE ZZL zeigt).
  mares = (mareRes.data || []).filter((h) => h.breeding_allowed === true);
  stallions = (stallionRes.data || []).filter((h) => h.breeding_allowed === true);
  fillOwnerSelect('#mare-owner-select', mares);
  fillOwnerSelect('#stallion-owner-select', stallions);
  mareBreedFilter.setHorses(mares);
  stallionBreedFilter.setHorses(stallions);
  fillHorseSelect(mareSelect, mares, '#mare-owner-select', mareBreedFilter);
  fillHorseSelect(stallionSelect, stallions, '#stallion-owner-select', stallionBreedFilter);
}

function fillOwnerSelect(selector, horses) {
  const sel = document.querySelector(selector);
  const owners = [...new Set(horses.map((h) => h.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  sel.innerHTML = '<option value="">Alle</option>';
  for (const owner of owners) {
    const opt = document.createElement('option');
    opt.value = owner;
    opt.textContent = owner;
    sel.appendChild(opt);
  }
}

function fillHorseSelect(select, horses, ownerSelector, breedFilter) {
  const owner = document.querySelector(ownerSelector).value;
  let filtered = owner ? horses.filter((h) => h.owner === owner) : horses;
  if (breedFilter) filtered = filtered.filter((h) => breedFilter.matches(h));
  select.setItems(filtered.map((h) => ({ id: h.id, label: h.name || '(ohne Name)' })));
}

function onMareOwnerChange() {
  fillHorseSelect(mareSelect, mares, '#mare-owner-select', mareBreedFilter);
  mareSelect.clear(); // löst onMareChange('') aus und rendert damit die geleerte Auswahl
}

function onStallionOwnerChange() {
  fillHorseSelect(stallionSelect, stallions, '#stallion-owner-select', stallionBreedFilter);
  stallionSelect.clear(); // löst onStallionChange('') aus
}

function wireTabButtons() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
}

// Erlaubt einen Direktlink auf einen bestimmten Tab, z.B. von der
// Startseite auf "zuchtplaner.html?tab=auswahl" (Verpaarungsratgeber).
// Wird erst am Ende von init() aufgerufen (siehe dort) - activateTab()
// rendert bei "auswahl" sofort über renderBestMatches(), das braucht
// mareSelect/stallionSelect und geladene Pferde.
function activateTabFromUrl() {
  const requestedTab = new URLSearchParams(window.location.search).get('tab');
  if (requestedTab && document.querySelector(`.tab-btn[data-tab="${requestedTab}"]`)) {
    activateTab(requestedTab);
  }
}

function activateTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelector('#tab-inzucht').hidden = activeTab !== 'inzucht';
  document.querySelector('#tab-auswahl').hidden = activeTab !== 'auswahl';
  if (activeTab === 'auswahl') renderBestMatches();
}

function onMareChange() {
  renderInzuchtResult();
  renderBestMatches();
}

// Auswahl per Dropdown ersetzt einen zuvor per Freitext eingelesenen
// fremden Hengst wieder.
function onStallionChange(id) {
  if (id) {
    foreignStallion = null;
    document.querySelector('#stallion-raw-text').value = '';
    document.querySelector('#stallion-parse-status').textContent = '';
  }
  renderInzuchtResult();
}

function onStallionParse() {
  const text = document.querySelector('#stallion-raw-text').value;
  const statusEl = document.querySelector('#stallion-parse-status');
  if (!text.trim()) {
    statusEl.textContent = 'Bitte zuerst Text einfügen.';
    return;
  }
  foreignStallion = parseHorseText(text);
  stallionSelect.clear();
  statusEl.textContent = 'Erkannt: ' + (foreignStallion.name || 'kein Name gefunden');
  renderInzuchtResult();
}

function selectedMare() {
  const id = mareSelect.getValue();
  return mares.find((m) => m.id === id) || null;
}

function selectedStallion() {
  if (foreignStallion) return foreignStallion;
  const id = stallionSelect.getValue();
  return stallions.find((s) => s.id === id) || null;
}

// --- Tab 1: Inzuchtprüfung ---

function renderInzuchtResult() {
  const container = document.querySelector('#inzucht-result');
  const mare = selectedMare();
  const stallion = selectedStallion();

  let html = parentSummaryHtml('Mutter', mare);
  html += parentSummaryHtml('Vater', stallion);

  if (mare && stallion) {
    html += foalSectionHtml(mare, stallion);
  }

  container.innerHTML = html;
}

function parentSummaryHtml(label, horse) {
  if (!horse) return '';
  const gp = horse.tournament_potential?.['Gesamtpotenzial'];
  const extAvg = averageScore(horse.exterior_descriptive, scoreExteriorTerm);
  const extPct = horse.exterior_genetics?.overall?.percent;
  const intAvg = averageScore(horse.temperament, scoreTemperamentTerm);
  const genes = presentGenesSummary(horse.colors, horse.coat_color, horse.notes);
  const genetik = genes.map((g) => g.alleles).join(' ');

  return `<div class="result-card">
    <h2>${escapeHtml(label)}: ${escapeHtml(horse.name || '(ohne Name)')}</h2>
    <p class="small muted">
      GP: <strong>${gp != null ? escapeHtml(String(gp)) : '–'}</strong>
      &nbsp;·&nbsp; Ext: <strong>${extAvg != null ? extAvg.toFixed(2) : '–'}</strong>
      &nbsp;·&nbsp; Ext%: <strong>${extPct != null ? extPct + '%' : '–'}</strong>
      &nbsp;·&nbsp; Int: <strong>${intAvg != null ? intAvg.toFixed(2) : '–'}</strong>
      &nbsp;·&nbsp; Genetik: <strong>${genetik ? escapeHtml(genetik) : '–'}</strong>
    </p>
    <p class="small muted">Besitzer: <strong>${horse.owner ? escapeHtml(horse.owner) : '–'}</strong></p>
  </div>`;
}

function foalSectionHtml(mare, stallion) {
  const duplicates = findSharedNames(mare, stallion);
  const nodes = foalPedigreeNodes(mare, stallion);
  const depth = nodes.filter((n) => n.name).length;
  const dupNames = new Set(duplicates.map((d) => normalizeName(d.name)));

  let html = '<div class="result-card">';
  html += '<h2>Fohlen</h2>';
  if (duplicates.length === 0) {
    html += '<div class="pill yes">KEINE Inzucht</div>';
  } else {
    html += '<div class="pill no">INZUCHT!!!</div>';
  }
  if (depth < 14) {
    html += `<p class="small muted">Hinweis: Stammbaum unvollständig erfasst (${depth}/14 bekannte Positionen) – eine Verwandtschaft kann dadurch nicht sicher ausgeschlossen werden.</p>`;
  }

  if (hasOveroGene(mare) && hasOveroGene(stallion)) {
    html += '<div class="notice notice-warning">⚠️ Beide Elterntiere tragen Overo – bei Overo × Overo besteht ein erhöhtes Risiko für das Overo Lethal White Syndrome (OLWS) bei homozygoten Fohlen.</div>';
  }

  html += foalRangeHtml(mare, stallion);

  html += foalPedigreeHtml(nodes, dupNames);

  html += '</div>';
  return html;
}

// Fohlen-Vorhersage (Best-/Worst-Case + Datenbank-Schätzung) für die
// konkret gewählte Anpaarung - dieselbe Berechnung wie im
// Verpaarungsratgeber (js/verpaarung.js).
function foalRangeHtml(mare, stallion) {
  const ext = exteriorFoalRange(mare, stallion);
  const int = interieurFoalRange(mare, stallion);
  const gp = estimateFoalGP(mare, stallion);

  return `<p class="small">
      Fohlen best case: GP <strong>${fmtGp(gp.gpBest)}</strong>
      &nbsp;·&nbsp; Ext <strong>${fmtScore(ext.extBest)}</strong>
      &nbsp;·&nbsp; Ext% <strong>${fmtPct(ext.extPctBest)}</strong>
      &nbsp;·&nbsp; Int <strong>${fmtScore(int.intBest)}</strong>
    </p>
    <p class="small muted">
      Fohlen worst case: GP <strong>${fmtGp(gp.gpWorst)}</strong>
      &nbsp;·&nbsp; Ext <strong>${fmtScore(ext.extWorst)}</strong>
      &nbsp;·&nbsp; Ext% <strong>${fmtPct(ext.extPctWorst)}</strong>
      &nbsp;·&nbsp; Int <strong>${fmtScore(int.intWorst)}</strong>
    </p>
    ${empiricalRowHtml(mare, stallion)}
    <p class="small muted">⚠️ GP und Int sind noch grobe Schätzwerte – verlasst euch für diese beiden Werte noch nicht auf ihre Richtigkeit.</p>
    ${decksprungButtonHtml(mare, stallion)}`;
}

// Dritte, realistischere Einschätzung neben Best-/Worst-Case: Eltern-
// Mittelwert + die aktuell in der Datenbank beobachtete Durchschnitts-
// Abweichung echter Fohlen (siehe computeEmpiricalDeviations in
// js/verpaarung.js). empiricalDeviations wird asynchron nachgeladen
// (loadEmpiricalDeviations) - vor dem ersten Laden leere Zeile.
function empiricalRowHtml(mare, stallion) {
  if (!empiricalDeviations) return '';
  const est = estimateFoalEmpirical(mare, stallion, empiricalDeviations);
  const ns = Object.entries(empiricalDeviations).map(([k, v]) => `${k}: n=${v.n}`).join(', ');
  return `<p class="small muted">
      Datenbank-Schätzung: GP <strong>${fmtGp(est.gp)}</strong>
      &nbsp;·&nbsp; Ext <strong>${fmtScore(est.ext)}</strong>
      &nbsp;·&nbsp; Ext% <strong>${fmtPct(est.extPct)}</strong>
      &nbsp;·&nbsp; Int <strong>${fmtScore(est.int)}</strong>
      <br><span class="muted" style="font-size:0.85em;">Eltern-Mittelwert + Ø-Abweichung echter Fohlen in der Datenbank (${escapeHtml(ns)}) - wird mit mehr eingetragenen Fohlen automatisch genauer.</span>
    </p>`;
}

// Speichert die Anpaarung direkt in der "pairings"-Tabelle der
// MDR-Datenbank (anonymer Insert dort extra dafür freigeschaltet, siehe
// migration_010 - kein Login in MDR-Planer nötig). Das eigentliche
// Verpaarungs-Log samt "Fohlen behalten?"-Auswahl lebt weiterhin in
// verpaarung.html der MDR-Datenbank (siehe Klick-Handler in init()).
function decksprungButtonHtml(mare, stallion) {
  if (!mare?.name || !stallion?.name) return '';
  return `<div class="decksprung-wrap">
    <button type="button" class="btn secondary decksprung-btn" data-mare="${escapeHtml(mare.name)}" data-stallion="${escapeHtml(stallion.name)}" data-owner="${escapeHtml(mare.owner || '')}" style="margin-top:0.4rem;">Decksprung nutzen</button>
    <span class="small muted decksprung-status"></span>
  </div>`;
}

// Delegierter Klick-Handler (Buttons entstehen dynamisch bei jedem
// Neu-Rendern, daher auf document statt einzeln pro Button verdrahtet).
async function onDecksprungClick(e) {
  const btn = e.target.closest('.decksprung-btn');
  if (!btn) return;
  const statusEl = btn.nextElementSibling;
  const mareName = btn.dataset.mare;
  const stallionName = btn.dataset.stallion;

  btn.disabled = true;
  statusEl.textContent = 'Speichert…';

  // "pairing_date" ist das erwartete Abfohldatum, nicht der Decksprung-
  // Tag selbst - Decksprung heute + 30 Tage (Spielmechanik).
  const foalingDate = new Date();
  foalingDate.setDate(foalingDate.getDate() + 30);

  const payload = {
    owner: btn.dataset.owner || null,
    stallion: stallionName,
    mare: mareName,
    pairing_date: foalingDate.toISOString().slice(0, 10),
    keep_foal: null,
    notes: null,
  };
  const { error } = await supabaseClient.from('pairings').insert(payload);
  if (error) {
    statusEl.textContent = 'Fehler beim Speichern: ' + error.message;
    btn.disabled = false;
    return;
  }
  statusEl.textContent = '✓ Im Verpaarungs-Log gespeichert';
}

function nameColorSpan(name, dupNames) {
  if (!name || normalizeName(name) === 'unbekannt') return '<span class="muted">unbekannt</span>';
  const isDup = dupNames.has(normalizeName(name));
  const color = isDup ? 'var(--danger)' : 'var(--success)';
  return `<span style="color:${color};${isDup ? ' font-weight:600;' : ''}">${escapeHtml(name)}</span>`;
}

function foalPedigreeHtml(nodes, dupNames) {
  const list = (entries) => entries.length
    ? `<ul class="small" style="margin:0.2rem 0 0.6rem;">${entries.map((n) => `<li>${nameColorSpan(n.name, dupNames)}</li>`).join('')}</ul>`
    : '<p class="small muted" style="margin:0.2rem 0 0.6rem;">unbekannt</p>';

  const parents = nodes.filter((n) => n.generation === 'Elternteil');
  const grandMutter = nodes.filter((n) => n.generation === 'Großeltern' && n.side === 'Mutter');
  const grandVater = nodes.filter((n) => n.generation === 'Großeltern' && n.side === 'Vater');
  const greatMutter = nodes.filter((n) => n.generation === 'Urgroßeltern' && n.side === 'Mutter');
  const greatVater = nodes.filter((n) => n.generation === 'Urgroßeltern' && n.side === 'Vater');

  return `<div class="group-heading">Stammbaum des Fohlens</div>
    <p class="small muted" style="margin-bottom:0.1rem;">Eltern</p>
    ${list(parents)}
    <p class="small muted" style="margin-bottom:0.1rem;">Großeltern mütterlicherseits</p>
    ${list(grandMutter)}
    <p class="small muted" style="margin-bottom:0.1rem;">Großeltern väterlicherseits</p>
    ${list(grandVater)}
    <p class="small muted" style="margin-bottom:0.1rem;">Urgroßeltern mütterlicherseits</p>
    ${list(greatMutter)}
    <p class="small muted" style="margin-bottom:0.1rem;">Urgroßeltern väterlicherseits</p>
    ${list(greatVater)}`;
}

// --- Tab 2: Verpaarungsratgeber ---

function renderBestMatches() {
  const container = document.querySelector('#auswahl-result');
  const hintEl = document.querySelector('#auswahl-hint');
  const mare = selectedMare();

  if (!mare) {
    container.innerHTML = '<p class="muted small">Bitte zuerst eine Stute auswählen.</p>';
    hintEl.textContent = '';
    return;
  }

  const { total, candidateCount, top } = rankStallions(mare, stallions, {
    schwerpunkt, sortMode, farbwuensche: selectedFarbwuensche(),
  });

  const mareHasOvero = hasOveroGene(mare);
  hintEl.textContent = mareHasOvero
    ? `Stute trägt Overo – Overo-Hengste werden ausgeschlossen. ${candidateCount} von ${total} Hengsten passen, Top ${top.length} angezeigt.`
    : `${candidateCount} von ${total} Hengsten passen, Top ${top.length} angezeigt.`;

  let html = parentSummaryHtml('Stute', mare);

  if (!top.length) {
    html += '<p class="muted small">Keine passenden Hengste gefunden.</p>';
    container.innerHTML = html;
    return;
  }

  html += '<div class="notice">';
  html += 'Erklärung zur Fohlen-Vorhersage: <strong>Int</strong> ist eine Näherung, da nur die Phänotyp-Kategorie der Eltern bekannt ist (kein Gencode) - ';
  html += 'sie geht von den Eltern-Werten aus, die sich je nach Partner im besten Fall um 1-2 Punkte verbessern, gleich bleiben oder im schlechtesten Fall um 1-2 Punkte verschlechtern. ';
  html += '<strong>GP</strong> ist eine Schätzung aus den Grenzwerten der Eltern-Einzelwerte (Grundlagen/Gangarten/Disziplinen), keine echte Vererbungssimulation.';
  html += '</div>';

  html += '<div class="group-heading">Hengste</div>';
  html += top.map((c, i) => stallionCandidateHtml(i + 1, c, mare)).join('');

  container.innerHTML = html;
}

function fmtScore(v) {
  return v != null ? v.toFixed(2) : '–';
}
function fmtPct(v) {
  return v != null ? v.toFixed(1) + '%' : '–';
}
function fmtGp(v) {
  return v != null ? Math.round(v) : '–';
}

function stallionCandidateHtml(rank, c, mare) {
  const h = c.stallion;
  const gp = h.tournament_potential?.['Gesamtpotenzial'] ?? '–';
  const extAvg = averageScore(h.exterior_descriptive, scoreExteriorTerm);
  const extPct = h.exterior_genetics?.overall?.percent;
  const intAvg = averageScore(h.temperament, scoreTemperamentTerm);
  const genes = presentGenesSummary(h.colors, h.coat_color, h.notes);
  const genetik = genes.map((g) => g.alleles).join(' ');

  return `<div class="result-card">
    <h2>${rank}. ${escapeHtml(h.name || '(ohne Name)')}</h2>
    <p class="small muted">
      GP: <strong>${escapeHtml(String(gp))}</strong>
      &nbsp;·&nbsp; Ext: <strong>${fmtScore(extAvg)}</strong>
      &nbsp;·&nbsp; Ext%: <strong>${extPct != null ? extPct + '%' : '–'}</strong>
      &nbsp;·&nbsp; Int: <strong>${fmtScore(intAvg)}</strong>
      &nbsp;·&nbsp; Fellfarbe: <strong>${h.coat_color ? escapeHtml(h.coat_color) : '–'}</strong>
      &nbsp;·&nbsp; Genetik: <strong>${genetik ? escapeHtml(genetik) : '–'}</strong>
      &nbsp;·&nbsp; Besitzer: <strong>${h.owner ? escapeHtml(h.owner) : '–'}</strong>
    </p>
    <p class="small">
      Fohlen best case: GP <strong>${fmtGp(c.gpBest)}</strong>
      &nbsp;·&nbsp; Ext <strong>${fmtScore(c.extBest)}</strong>
      &nbsp;·&nbsp; Ext% <strong>${fmtPct(c.extPctBest)}</strong>
      &nbsp;·&nbsp; Int <strong>${fmtScore(c.intBest)}</strong>
    </p>
    <p class="small muted">
      Fohlen worst case: GP <strong>${fmtGp(c.gpWorst)}</strong>
      &nbsp;·&nbsp; Ext <strong>${fmtScore(c.extWorst)}</strong>
      &nbsp;·&nbsp; Ext% <strong>${fmtPct(c.extPctWorst)}</strong>
      &nbsp;·&nbsp; Int <strong>${fmtScore(c.intWorst)}</strong>
    </p>
    ${empiricalRowHtml(mare, h)}
    ${decksprungButtonHtml(mare, h)}
  </div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
