// Felder, die für Inzuchtprüfung, Overo-Erkennung, die Mutter/Vater-
// Kennzahlen und die kleine Anzeige in "Beste Hengstauswahl" gebraucht
// werden.
const HORSE_SELECT_FIELDS =
  'id,name,owner,gender,coat_color,colors,notes,pedigree,tournament_potential,exterior_genetics,exterior_descriptive,temperament';

let mares = [];
let stallions = [];
let foreignStallion = null; // per Freitext eingelesener, nicht gespeicherter Hengst
let activeTab = 'inzucht';
let mareSelect, stallionSelect;

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
  await loadHorses();
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

  mares = mareRes.data || [];
  stallions = stallionRes.data || [];
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

// --- Tab 2: Beste Hengstauswahl ---

function renderBestMatches() {
  const tbody = document.querySelector('#auswahl-table tbody');
  const hintEl = document.querySelector('#auswahl-hint');
  const mare = selectedMare();

  if (!mare) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">Bitte zuerst eine Stute auswählen.</td></tr>';
    hintEl.textContent = '';
    return;
  }

  const mareHasOvero = hasOveroGene(mare);
  const candidates = stallions.filter((stallion) => {
    if (findSharedNames(mare, stallion).length > 0) return false;
    if (mareHasOvero && hasOveroGene(stallion)) return false;
    return true;
  });

  hintEl.textContent = mareHasOvero
    ? `Stute trägt Overo – Overo-Hengste werden ausgeschlossen. ${candidates.length} von ${stallions.length} Hengsten passen.`
    : `${candidates.length} von ${stallions.length} Hengsten passen.`;

  if (!candidates.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">Keine passenden Hengste gefunden.</td></tr>';
    return;
  }

  tbody.innerHTML = candidates.map((h) => {
    const gp = h.tournament_potential?.['Gesamtpotenzial'] ?? '';
    const extPct = h.exterior_genetics?.overall?.percent;
    const intAvg = averageScore(h.temperament, scoreTemperamentTerm);
    return `<tr>
      <td>${escapeHtml(h.name || '(ohne Name)')}</td>
      <td>${escapeHtml(h.coat_color || '')}</td>
      <td>${escapeHtml(String(gp))}</td>
      <td>${extPct != null ? extPct + '%' : ''}</td>
      <td>${intAvg != null ? intAvg.toFixed(2) : ''}</td>
    </tr>`;
  }).join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
