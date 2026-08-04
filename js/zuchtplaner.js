// Felder, die für Inzuchtprüfung, Overo-Erkennung, die Mutter/Vater-
// Kennzahlen und den Verpaarungsratgeber (inkl. GP-Formel und
// Genotyp-basierter Fohlen-Vorhersage) gebraucht werden.
const HORSE_SELECT_FIELDS =
  'id,name,owner,gender,breed,purebred_pct,coat_color,breeding_allowed,colors,notes,pedigree,tournament_potential,exterior_genetics,exterior_descriptive,temperament,traits,disciplines,genetic_diseases';

// Leichtere Feldauswahl für die Datenbank-Schätzung (computeEmpiricalDeviations):
// braucht ALLE Pferde (auch ohne ZZL, jedes Geschlecht), aber nur die Felder,
// die für GP/Ext/Ext%/Int, den Stammbaum, die Rasselos/Hauptdisziplin-Regel,
// den COI-Ausschluss und die Flaxen-Eltern-Erkennung (coat_color, siehe
// flaxenLookup) nötig sind.
const STATS_SELECT_FIELDS =
  'id,name,breed,ico,coat_color,pedigree,tournament_potential,exterior_genetics,exterior_descriptive,temperament,disciplines';

// Dieselben Felder aus "foal_reference_data" (siehe migration_011 in der
// MDR-Datenbank) - dort landet über einen DB-Trigger automatisch jedes in
// "horses" gespeicherte Pferd (kept=true, per horse_id) UND zusätzlich jedes
// über das Verpaarungs-Log erfasste, nicht behaltene Fohlen (kept=false).
// "horse_id" bleibt auch nach dem Löschen des zugehörigen "horses"-Datensatzes
// erhalten - genau die Quelle für "auch nicht mehr vorhandene Pferde".
const REFERENCE_SELECT_FIELDS =
  'id,horse_id,name,breed,ico,coat_color,pedigree,tournament_potential,exterior_genetics,exterior_descriptive,temperament,disciplines';

let mares = [];
let stallions = [];
let foreignStallion = null; // per Freitext eingelesener, nicht gespeicherter Hengst
let activeTab = 'inzucht';
let mareSelect, stallionSelect;
let mareBreedFilter, stallionBreedFilter, auswahlStallionBreedFilter;
let schwerpunkt = 'gp';
let sortMode = 'best';
// Nur bei sortMode "combo" relevant (siehe rankStallions in
// js/verpaarung.js): 2. Kriterium + individuelle Gewichtung zwischen
// Schwerpunkt (1. Kriterium) und comboSecond (1. Kriterium zählt zu
// comboWeight%, 2. Kriterium zu 100-comboWeight%).
let comboSecond = 'extpct';
let comboWeight = 50;
// "stute": oben gewählte Stute -> Top-Hengste (Standard). "hengst": oben
// gewählter Hengst -> Top-Stuten (umgekehrte Richtung) - siehe
// renderBestMatches, nutzt dieselbe rankStallions()-Logik nur mit
// vertauschten Rollen (siehe Kommentar dort).
let richtung = 'stute';
let empiricalDeviations = null; // wird nach loadHorses() befüllt, siehe loadEmpiricalDeviations()
// Map<normalisierterName, Pferd> aus demselben breiten Bestand wie
// empiricalDeviations (horses + foal_reference_data) - für die Flaxen-
// Trägerschaftsprüfung über Vorfahren (siehe hasFlaxenTrait in
// js/verpaarung.js): findet auch Vorfahren, die selbst nicht (mehr) im
// ZZL-Kandidatenpool stehen.
let flaxenLookup = null;
// Reverse-Index dazu (Name -> bekannte Nachkommen) für die zusätzliche
// Trägerschaftsprüfung über Nachkommen, siehe hasFlaxenTrait.
let flaxenChildrenByName = null;
// Der "Decksprung nutzen"-Button schreibt in dieselbe "pairings"-Tabelle wie
// das Verpaarungs-Log in der MDR-Datenbank (verpaarung.html) - ist dieses
// Log für das aktuell eingeloggte Konto dort ausgeblendet (Einstellung in
// einstellungen.html, siehe user_settings.verpaarung_enabled und js/nav.js
// in der MDR-Datenbank), macht der Button hier auch keinen Sinn mehr und
// wird ebenfalls ausgeblendet. Für Gäste (kein Login) bleibt er unverändert
// sichtbar, da es dort kein Konto/keine Einstellung gibt, auf die sich
// "ausgeblendet" beziehen könnte.
let verpaarungLogEnabled = true;

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
  // Standardauswahl übernimmt einmalig die Rasse(n) der Stute (Kreuzungen
  // sind möglich, aber standardmäßig geht man von derselben Rasse aus) -
  // danach frei manuell änderbar, siehe createBreedFilter/initialSelection.
  stallionBreedFilter = createBreedFilter(document.querySelector('#stallion-breed-drop'), {
    onChange: onStallionOwnerChange,
    initialSelection: () => mareBreedFilter.getSelected(),
  });
  // Eigener, unabhängiger Rassen-Filter für den Hengst-Pool im
  // Verpaarungsratgeber (Top-10-Ranking) - Standard bleibt APH, unabhängig
  // von der Stuten-Auswahl (manuelles Umschalten nötig für z.B. Rasselos).
  auswahlStallionBreedFilter = createBreedFilter(document.querySelector('#auswahl-stallion-breed-drop'), {
    onChange: renderBestMatches,
  });
  document.querySelector('#stallion-parse-btn').addEventListener('click', onStallionParse);
  document.querySelector('#schwerpunkt-select').addEventListener('change', (e) => {
    schwerpunkt = e.target.value;
    renderBestMatches();
  });
  document.querySelector('#sortierung-select').addEventListener('change', (e) => {
    sortMode = e.target.value;
    updateComboControlsVisibility();
    renderBestMatches();
  });
  document.querySelector('#combo-second-select').addEventListener('change', (e) => {
    comboSecond = e.target.value;
    renderBestMatches();
  });
  document.querySelector('#combo-weight-input').addEventListener('change', (e) => {
    const v = parseInt(e.target.value, 10);
    comboWeight = Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 50;
    e.target.value = comboWeight;
    renderBestMatches();
  });
  document.querySelector('#hengst-besitzer-select').addEventListener('change', renderBestMatches);
  document.querySelector('#richtung-select').addEventListener('change', (e) => {
    richtung = e.target.value;
    renderBestMatches();
  });
  wireFarbwunschDropdown();
  document.addEventListener('click', onDecksprungClick);
  await initAuthStatus();
  await loadVerpaarungLogEnabled();
  await loadHorses();
  loadEmpiricalDeviations(); // unabhängig von loadHorses(), blockiert die Seite nicht
  // Erst NACH mareSelect/stallionSelect + loadHorses() aktivieren, da
  // activateTab('auswahl') sonst renderBestMatches() aufruft, bevor
  // mareSelect existiert bzw. Pferde geladen sind (führte zu einem
  // Fehler, der die komplette init()-Funktion abbrach - Suchfelder
  // blieben dann funktionslos, z.B. via "zuchtplaner.html?tab=auswahl").
  activateTabFromUrl();
}

// Fragt das Verpaarungs-Log-Setting des eingeloggten Kontos ab (nur bei
// bestehender Session sinnvoll/möglich, siehe RLS-Policy
// "user_settings_select_own" in migration_017 - erlaubt select nur für
// auth.uid() = user_id, kein anon-Zugriff). Fehlt die Zeile (nie in
// einstellungen.html gespeichert) oder schlägt die Abfrage fehl, bleibt es
// beim Standard "sichtbar", exakt wie js/nav.js in der MDR-Datenbank.
async function loadVerpaarungLogEnabled() {
  if (!isLoggedIn()) return;
  const { data, error } = await supabaseClient
    .from('user_settings')
    .select('verpaarung_enabled')
    .eq('user_id', currentAuthSession.user.id)
    .maybeSingle();
  if (!error && data && data.verpaarung_enabled === false) {
    verpaarungLogEnabled = false;
  }
}

// Lädt ALLE Pferde (unabhängig von ZZL/Geschlecht) einmalig, um daraus die
// Datenbank-Schätzung (3. Version neben Best-/Worst-Case) zu berechnen -
// siehe computeEmpiricalDeviations in js/verpaarung.js. Läuft im Hintergrund
// und rendert bei Erfolg neu, damit die Seite nicht auf diesen Extra-Request
// warten muss.
async function loadEmpiricalDeviations() {
  const [liveRes, refRes] = await Promise.all([
    supabaseClient.from('horses').select(STATS_SELECT_FIELDS),
    supabaseClient.from('foal_reference_data').select(REFERENCE_SELECT_FIELDS),
  ]);
  const liveHorses = liveRes.data || [];
  const liveIds = new Set(liveHorses.map((h) => h.id));
  // Nur Referenzdatensätze ergänzen, die NICHT schon live in "horses" stehen
  // (Duplikate über horse_id vermeiden) - das deckt genau die Pferde ab, die
  // inzwischen gelöscht wurden oder nie als eigenes Pferd behalten wurden
  // (kept=false).
  const extraFromReference = (refRes.data || []).filter((r) => !r.horse_id || !liveIds.has(r.horse_id));
  const combined = [...liveHorses, ...extraFromReference];
  if (!combined.length) return;
  empiricalDeviations = computeEmpiricalDeviations(combined);
  flaxenLookup = new Map();
  for (const h of combined) {
    const key = normalizeName(h.name);
    if (key && !flaxenLookup.has(key)) flaxenLookup.set(key, h);
  }
  // Reverse-Index (wer nennt diesen Namen als Vater/Mutter) - erlaubt
  // hasFlaxenTrait zusätzlich zur Ahnen-Prüfung auch über bekannte
  // Nachkommen auf Trägerschaft zu schließen (siehe Kommentar dort).
  // Gleiches Muster wie js/fohlen-tracker.js.
  flaxenChildrenByName = new Map();
  for (const h of combined) {
    const anc = pedigreeAncestorNames(h);
    for (const parentName of [anc[0], anc[1]]) {
      if (!parentName || normalizeName(parentName) === 'unbekannt') continue;
      const key = normalizeName(parentName);
      if (!flaxenChildrenByName.has(key)) flaxenChildrenByName.set(key, []);
      flaxenChildrenByName.get(key).push(h);
    }
  }
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
  auswahlStallionBreedFilter.setHorses(stallions);
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
// fremden Hengst wieder. Ruft (wie onMareChange) auch renderBestMatches()
// auf - bei Richtung "hengst" ist der Hengst der Ausgangspunkt des
// Verpaarungsratgebers, ohne diesen Aufruf blieb die Trefferliste beim
// vorherigen Hengst stehen, wenn ein neuer per Dropdown gewählt wurde.
function onStallionChange(id) {
  if (id) {
    foreignStallion = null;
    document.querySelector('#stallion-raw-text').value = '';
    document.querySelector('#stallion-parse-status').textContent = '';
  }
  renderInzuchtResult();
  renderBestMatches();
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

// Ergänzt die Genetik-Anzeige um "fl", wenn eine sonst unsichtbare
// Flaxen-Trägerschaft (1 Kopie) nur über Eltern/Nachkommen erkennbar ist
// (siehe hasFlaxenTrait in js/verpaarung.js) - sichtbares Flaxen (2
// Kopien, "flfl") liefert presentGenesSummary bereits selbst über die
// Fellfarbe (siehe PHENOTYPE_GENE_HINTS in js/parser.js), landet also
// schon in "genetik" und wird hier nicht doppelt ergänzt.
function genetikWithFlaxen(horse, genetik) {
  if (!isVisiblyFlaxen(horse) && hasFlaxenTrait(horse, flaxenLookup, flaxenChildrenByName)) {
    return genetik ? `${genetik} fl` : 'fl';
  }
  return genetik;
}

function parentSummaryHtml(label, horse) {
  if (!horse) return '';
  const gp = horse.tournament_potential?.['Gesamtpotenzial'];
  const extAvg = averageScore(horse.exterior_descriptive, scoreExteriorTerm);
  const extPct = horse.exterior_genetics?.overall?.percent;
  const intAvg = averageScore(horse.temperament, scoreTemperamentTerm);
  const genes = presentGenesSummary(horse.colors, horse.coat_color, horse.notes, horse.name);
  const genetik = genetikWithFlaxen(horse, genes.map((g) => g.alleles).join(' '));

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

  html += ekhWarningHtml(mare, stallion);

  html += foalRangeHtml(mare, stallion);

  html += foalPedigreeHtml(nodes, dupNames);

  html += '</div>';
  return html;
}

// EKH-Warnung (Erbkrankheiten): erscheint, sobald Stute ODER Hengst
// mindestens eine Erbkrankheit als Träger oder ausgeprägt betroffen
// trägt (isDiseaseCarrierOrAffected, js/breeding.js) - zwei Stufen je
// nach Risiko fürs Fohlen:
// - ROT (notice-warning): beide Elterntiere tragen DIESELBE Krankheit
//   (Risiko eines ausgeprägt betroffenen Fohlens) ODER ein Elternteil ist
//   bei irgendeiner Krankheit bereits selbst ausgeprägt betroffen -
//   "doppelt", nur Kleinbuchstaben, siehe isDiseaseAusgepraegt in
//   js/tournamentScoring.js.
// - GELB (notice-caution): nur EIN Elternteil ist (Träger einer)
//   Krankheit, nicht geteilt und nicht ausgeprägt - geringeres Risiko,
//   aber trotzdem erwähnenswert.
function ekhWarningHtml(mare, stallion) {
  const mareDiseases = mare?.genetic_diseases || [];
  const stallionDiseases = stallion?.genetic_diseases || [];
  const mareCarrier = mareDiseases.filter((d) => isDiseaseCarrierOrAffected(d.value));
  const stallionCarrier = stallionDiseases.filter((d) => isDiseaseCarrierOrAffected(d.value));
  if (!mareCarrier.length && !stallionCarrier.length) return '';

  const mareLabels = new Set(mareCarrier.map((d) => d.label));
  const stallionLabels = new Set(stallionCarrier.map((d) => d.label));
  const allLabels = [...new Set([...mareLabels, ...stallionLabels])];
  const sharedLabels = allLabels.filter((l) => mareLabels.has(l) && stallionLabels.has(l));
  const doubledLabels = [...new Set(
    [...mareDiseases, ...stallionDiseases].filter((d) => isDiseaseAusgepraegt(d.value)).map((d) => d.label),
  )];

  const severe = sharedLabels.length > 0 || doubledLabels.length > 0;
  const reasonParts = [];
  if (sharedLabels.length) reasonParts.push(`beide Elterntiere tragen ${sharedLabels.map(escapeHtml).join(', ')}`);
  if (doubledLabels.length) reasonParts.push(`${doubledLabels.map(escapeHtml).join(', ')} ist bei einem Elternteil bereits ausgeprägt (doppelt)`);
  const reasonText = severe
    ? ` – ${reasonParts.join('; ')}, erhöhtes Risiko für ein ausgeprägt betroffenes Fohlen.`
    : ' – nur bei einem Elternteil bekannt, geringeres Risiko.';

  const cssClass = severe ? 'notice-warning' : 'notice-caution';
  return `<div class="notice ${cssClass}">⚠️ Erbkrankheit(en) (EKH) bei mindestens einem Elternteil: <strong>${allLabels.map(escapeHtml).join(', ')}</strong>${reasonText}</div>`;
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
  if (!verpaarungLogEnabled) return '';
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

// Zeigt in den Options-Labels konkret den Besitzernamen des aktuell
// gewählten "primären" Pferds (Stute bei Richtung "stute", Hengst bei
// Richtung "hengst") an ("Nur eigene (Wilder Wolf)" statt nur "Nur
// eigene"), damit klar ist, worauf sich "eigene"/"fremde" bezieht - es
// gibt kein Login auf dieser Seite, "eigene" heißt also "gleicher
// Besitzer wie das oben gewählte Pferd".
function updateHengstBesitzerLabels(primary) {
  const owner = primary.owner || 'unbekannt';
  document.querySelector('#hengst-besitzer-select option[value="eigene"]').textContent = `Nur eigene (${owner})`;
  document.querySelector('#hengst-besitzer-select option[value="fremde"]').textContent = `Nur fremde (nicht ${owner})`;
}

// "2. Kriterium"/"Gewichtung" sind nur bei sortMode "combo" relevant -
// werden sonst versteckt, damit sie bei den anderen Sortiermodi nicht
// verwirren.
function updateComboControlsVisibility() {
  const show = sortMode === 'combo';
  document.querySelector('#combo-second-wrap').hidden = !show;
  document.querySelector('#combo-weight-wrap').hidden = !show;
}

// Passt Beschriftungen an, die je nach Richtung von "Hengst" auf "Stute"
// wechseln müssen - der Filter/die Sortierung selbst bleibt exakt
// dieselbe Logik, nur bezogen auf den jeweils anderen Kandidatenpool.
// Genort-Ausgleich (siehe rankStallions in js/verpaarung.js) rechnet je
// nach Schwerpunkt mit einer anderen Metrik - Klammerzusatz entsprechend
// mitführen, damit klar ist, WORAUF sich der Ausgleich gerade bezieht.
const COMPLEMENT_SCHWERPUNKT_LABEL = { gp: 'GP', ext: 'Ext', extpct: 'Ext%', int: 'Int' };

function updateRichtungsLabels() {
  const isHengstRichtung = richtung === 'hengst';
  document.querySelector('#candidate-breed-label').textContent = isHengstRichtung ? 'Stute-Rasse' : 'Hengst-Rasse';
  document.querySelector('#hengst-besitzer-label').textContent = isHengstRichtung ? 'Stute-Besitzer' : 'Hengst-Besitzer';
  const metricLabel = COMPLEMENT_SCHWERPUNKT_LABEL[schwerpunkt] || 'Ext%';
  document.querySelector('#complement-sort-option').textContent = isHengstRichtung
    ? `Bester Ausgleich der Hengst-Schwächen (${metricLabel})`
    : `Bester Ausgleich der Stuten-Schwächen (${metricLabel})`;
}

function renderBestMatches() {
  const container = document.querySelector('#auswahl-result');
  const hintEl = document.querySelector('#auswahl-hint');
  const isHengstRichtung = richtung === 'hengst';
  const primary = isHengstRichtung ? selectedStallion() : selectedMare();
  const candidatePool = isHengstRichtung ? mares : stallions;
  const primaryLabel = isHengstRichtung ? 'Hengst' : 'Stute';
  const candidateLabelPlural = isHengstRichtung ? 'Stuten' : 'Hengste';
  const candidateLabelPluralDativ = isHengstRichtung ? 'Stuten' : 'Hengsten'; // "von X Hengsten"/"von X Stuten"

  updateRichtungsLabels();

  if (!primary) {
    container.innerHTML = `<p class="muted small">Bitte zuerst ${isHengstRichtung ? 'einen Hengst' : 'eine Stute'} auswählen.</p>`;
    hintEl.textContent = '';
    return;
  }

  updateHengstBesitzerLabels(primary);
  auswahlStallionBreedFilter.setHorses(candidatePool);
  const besitzerMode = document.querySelector('#hengst-besitzer-select').value;
  const filteredCandidates = candidatePool
    .filter((h) => auswahlStallionBreedFilter.matches(h))
    .filter((h) => {
      if (besitzerMode === 'eigene') return h.owner === primary.owner;
      if (besitzerMode === 'fremde') return h.owner !== primary.owner;
      return true;
    });
  // rankStallions ist bereits vollständig symmetrisch (Ext/Int/GP/
  // Datenbank-Schätzung/Ausschlüsse rechnen unabhängig davon, welche
  // Rolle "mare"/"stallion" biologisch tatsächlich hat) - bei Richtung
  // "hengst" wird hier einfach der Hengst als erstes Argument und die
  // Stuten-Liste als Kandidatenpool übergeben. Der Rückgabewert nennt den
  // Kandidaten weiterhin "stallion" (auch wenn er hier tatsächlich eine
  // Stute ist), siehe candidateCardHtml unten.
  const { total, candidateCount, top } = rankStallions(primary, filteredCandidates, {
    schwerpunkt, sortMode, farbwuensche: selectedFarbwuensche(), empiricalDeviations, flaxenLookup, flaxenChildrenByName,
    comboSecond, comboWeight,
  });

  const primaryHasOvero = hasOveroGene(primary);
  hintEl.textContent = primaryHasOvero
    ? `${primaryLabel} trägt Overo – Overo-Kandidaten werden ausgeschlossen. ${candidateCount} von ${total} ${candidateLabelPluralDativ} passen, Top ${top.length} angezeigt.`
    : `${candidateCount} von ${total} ${candidateLabelPluralDativ} passen, Top ${top.length} angezeigt.`;

  let html = parentSummaryHtml(primaryLabel, primary);

  if (!top.length) {
    html += `<p class="muted small">Keine passenden ${candidateLabelPlural} gefunden.</p>`;
    container.innerHTML = html;
    return;
  }

  html += '<div class="notice">';
  html += 'Erklärung zur Fohlen-Vorhersage: <strong>Int</strong> ist eine Näherung, da nur die Phänotyp-Kategorie der Eltern bekannt ist (kein Gencode) - ';
  html += 'sie geht von den Eltern-Werten aus, die sich je nach Partner im besten Fall um 1-2 Punkte verbessern, gleich bleiben oder im schlechtesten Fall um 1-2 Punkte verschlechtern. ';
  html += '<strong>GP</strong> ist eine Schätzung aus den Grenzwerten der Eltern-Einzelwerte (Grundlagen/Gangarten/Disziplinen), keine echte Vererbungssimulation.';
  html += '</div>';

  html += `<div class="group-heading">${candidateLabelPlural}</div>`;
  html += top.map((c, i) => {
    // Decksprung/EKH/Datenbank-Schätzung brauchen mare/stallion in der
    // biologisch richtigen Reihenfolge (sonst würden z.B. beim Speichern
    // Stuten- und Hengstname vertauscht) - c.stallion ist bei Richtung
    // "hengst" tatsächlich die Kandidaten-Stute.
    const mareArg = isHengstRichtung ? c.stallion : primary;
    const stallionArg = isHengstRichtung ? primary : c.stallion;
    return candidateCardHtml(i + 1, c, mareArg, stallionArg, primaryLabel);
  }).join('');

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

// Zeigt den Ausgleich (siehe gpComplementarityScore/
// intComplementarityScore/exteriorComplementarityScore in
// js/verpaarung.js) nur, wenn das "primäre" Pferd (Stute bei Richtung
// "stute", Hengst bei Richtung "hengst") überhaupt "Problemstellen" hat -
// bei einem bereits perfekten Pferd gäbe es sonst nichts zu unterscheiden.
// weaknessOwnerLabel ist "Stute" oder "Hengst" - wessen Schwächen gezählt
// wurden (immer das primäre Pferd, siehe rankStallions-Aufruf). Text/
// Einheit hängt vom global gewählten Schwerpunkt ab - "schwerpunkt" ist
// dieselbe Modul-Variable, die auch rankStallions bei der Berechnung
// des Ausgleichs übergeben wird.
const COMPLEMENT_UNIT_LABEL = { gp: 'Werte-Ausgleich (GP)', ext: 'Ausgleich (Ext)', extpct: 'Genort-Ausgleich (Ext%)', int: 'Ausgleich (Int)' };
const COMPLEMENT_NOUN_LABEL = { gp: 'unterdurchschnittlichen Werten', ext: 'Problem-/Halte-Genorten', extpct: 'Problem-Genorten', int: 'Problem-/Halte-Eigenschaften' };
function complementRowHtml(c, weaknessOwnerLabel) {
  const { atStake, saved } = c.complement || {};
  if (!atStake) return '';
  const pct = ((saved / atStake) * 100).toFixed(0);
  const owner = weaknessOwnerLabel === 'Hengst' ? 'des Hengstes' : 'der Stute';
  const unitLabel = COMPLEMENT_UNIT_LABEL[schwerpunkt] || COMPLEMENT_UNIT_LABEL.extpct;
  const nounLabel = COMPLEMENT_NOUN_LABEL[schwerpunkt] || COMPLEMENT_NOUN_LABEL.extpct;
  return `<p class="small muted">${unitLabel}: <strong>${saved} von ${atStake}</strong> ${nounLabel} ${owner} ausgeglichen (${pct}%)</p>`;
}

// Zeigt bei sortMode "combo" (siehe rankStallions) beide Einzel-Prozente
// (Schwerpunkt = 1. Kriterium, comboSecond = 2. Kriterium) plus den
// gewichteten Gesamtwert, statt der einzeiligen complementRowHtml-Anzeige.
// Jede Komponente nutzt denselben "saved/atStake"-Prozentsatz wie die
// einzelnen Ausgleich-Anzeigen - bei Int/Ext geht dabei die interne
// Prioritätsstufung (siehe intComplementarityScore/extComplementarityScore)
// nicht verloren, sie steckt schon in "saved" (der Anteil je Stufe), wird
// hier aber wie überall als EIN Gesamtprozentsatz dargestellt.
function comboRowHtml(c, weaknessOwnerLabel) {
  if (!c.comboComplement) return '';
  const owner = weaknessOwnerLabel === 'Hengst' ? 'des Hengstes' : 'der Stute';
  const labelA = COMPLEMENT_SCHWERPUNKT_LABEL[schwerpunkt] || schwerpunkt;
  const labelB = COMPLEMENT_SCHWERPUNKT_LABEL[comboSecond] || comboSecond;
  const pctA = c.complement?.atStake ? ((c.complement.saved / c.complement.atStake) * 100).toFixed(0) : '100';
  const pctB = c.comboComplement?.atStake ? ((c.comboComplement.saved / c.comboComplement.atStake) * 100).toFixed(0) : '100';
  return `<p class="small muted">Kombinierter Ausgleich ${owner} (${labelA} ${comboWeight}% / ${labelB} ${100 - comboWeight}%): <strong>${c.comboScore.toFixed(0)}%</strong>
    <br><span class="muted" style="font-size:0.85em;">${labelA}: ${pctA}% ausgeglichen &nbsp;·&nbsp; ${labelB}: ${pctB}% ausgeglichen</span></p>`;
}

// mare/stallion müssen hier immer in der biologisch korrekten Reihenfolge
// übergeben werden (wichtig für Decksprung/EKH/Datenbank-Schätzung) - der
// Aufrufer (renderBestMatches) löst das bereits korrekt auf, unabhängig
// davon, welches der beiden gerade der "Kandidat" c.stallion ist.
// weaknessOwnerLabel siehe complementRowHtml.
function candidateCardHtml(rank, c, mare, stallion, weaknessOwnerLabel) {
  const h = c.stallion; // Kandidat aus rankStallions - bei Richtung "hengst" tatsächlich eine Stute
  const gp = h.tournament_potential?.['Gesamtpotenzial'] ?? '–';
  const extAvg = averageScore(h.exterior_descriptive, scoreExteriorTerm);
  const extPct = h.exterior_genetics?.overall?.percent;
  const intAvg = averageScore(h.temperament, scoreTemperamentTerm);
  const genes = presentGenesSummary(h.colors, h.coat_color, h.notes, h.name);
  const genetik = genetikWithFlaxen(h, genes.map((g) => g.alleles).join(' '));

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
    ${ekhWarningHtml(mare, stallion)}
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
    ${empiricalRowHtml(mare, stallion)}
    ${sortMode === 'combo' ? comboRowHtml(c, weaknessOwnerLabel) : complementRowHtml(c, weaknessOwnerLabel)}
    ${decksprungButtonHtml(mare, stallion)}
  </div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
