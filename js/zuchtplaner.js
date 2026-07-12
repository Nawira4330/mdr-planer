// Felder, die für Inzuchtprüfung, Overo-Erkennung, die Mutter/Vater-
// Kennzahlen und den Verpaarungsratgeber (inkl. GP-Formel und
// Genotyp-basierter Fohlen-Vorhersage) gebraucht werden.
const HORSE_SELECT_FIELDS =
  'id,name,owner,gender,coat_color,breeding_allowed,colors,notes,pedigree,tournament_potential,exterior_genetics,exterior_descriptive,temperament,traits,disciplines,genetic_diseases';

let mares = [];
let stallions = [];
let foreignStallion = null; // per Freitext eingelesener, nicht gespeicherter Hengst
let activeTab = 'inzucht';
let mareSelect, stallionSelect;
let schwerpunkt = 'gp';

document.addEventListener('DOMContentLoaded', init);

async function init() {
  wireTabs();
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
  document.querySelector('#stallion-parse-btn').addEventListener('click', onStallionParse);
  document.querySelector('#schwerpunkt-select').addEventListener('change', (e) => {
    schwerpunkt = e.target.value;
    renderBestMatches();
  });
  wireFarbwunschDropdown();
  await loadHorses();
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
  fillHorseSelect(mareSelect, mares, '#mare-owner-select');
  fillHorseSelect(stallionSelect, stallions, '#stallion-owner-select');
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

function fillHorseSelect(select, horses, ownerSelector) {
  const owner = document.querySelector(ownerSelector).value;
  const filtered = owner ? horses.filter((h) => h.owner === owner) : horses;
  select.setItems(filtered.map((h) => ({ id: h.id, label: h.name || '(ohne Name)' })));
}

function onMareOwnerChange() {
  fillHorseSelect(mareSelect, mares, '#mare-owner-select');
  mareSelect.clear(); // löst onMareChange('') aus und rendert damit die geleerte Auswahl
}

function onStallionOwnerChange() {
  fillHorseSelect(stallionSelect, stallions, '#stallion-owner-select');
  stallionSelect.clear(); // löst onStallionChange('') aus
}

function wireTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelector('#tab-inzucht').hidden = activeTab !== 'inzucht';
      document.querySelector('#tab-auswahl').hidden = activeTab !== 'auswahl';
      if (activeTab === 'auswahl') renderBestMatches();
    });
  });
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

  html += foalPedigreeHtml(nodes, dupNames);

  html += '</div>';
  return html;
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
    schwerpunkt, farbwuensche: selectedFarbwuensche(),
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
  html += 'Hinweise zur Fohlen-Vorhersage: <strong>Int</strong> ist eine Näherung, da nur die Phänotyp-Kategorie der Eltern bekannt ist (kein Gencode) - ';
  html += 'sie geht von den Eltern-Werten aus, die sich je nach Partner im besten Fall um 1-2 Punkte verbessern, gleich bleiben oder im schlechtesten Fall um 1-2 Punkte verschlechtern. ';
  html += '<strong>GP</strong> ist eine Schätzung aus den Grenzwerten der Eltern-Einzelwerte (Grundlagen/Gangarten/Disziplinen), keine echte Vererbungssimulation.';
  html += '</div>';

  html += '<div class="group-heading">Hengste</div>';
  html += top.map((c, i) => stallionCandidateHtml(i + 1, c)).join('');

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

function stallionCandidateHtml(rank, c) {
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
  </div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
