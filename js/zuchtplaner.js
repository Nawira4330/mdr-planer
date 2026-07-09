// Felder, die für Inzuchtprüfung, Overo-Erkennung und die kleine
// Kennzahlen-Anzeige in "Beste Hengstauswahl" gebraucht werden.
const HORSE_SELECT_FIELDS =
  'id,name,gender,coat_color,colors,notes,pedigree,tournament_potential,exterior_genetics,temperament';

let mares = [];
let stallions = [];
let activeTab = 'inzucht';

document.addEventListener('DOMContentLoaded', init);

async function init() {
  wireTabs();
  document.querySelector('#mare-select').addEventListener('change', onMareChange);
  document.querySelector('#stallion-select').addEventListener('change', onStallionChange);
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
  fillSelect('#mare-select', mares);
  fillSelect('#stallion-select', stallions);
}

function fillSelect(selector, horses) {
  const sel = document.querySelector(selector);
  const current = sel.value;
  sel.innerHTML = '<option value="">– bitte wählen –</option>';
  for (const h of horses) {
    const opt = document.createElement('option');
    opt.value = h.id;
    opt.textContent = h.name || '(ohne Name)';
    sel.appendChild(opt);
  }
  sel.value = current;
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

function onStallionChange() {
  renderInzuchtResult();
}

function selectedMare() {
  const id = document.querySelector('#mare-select').value;
  return mares.find((m) => m.id === id) || null;
}

function selectedStallion() {
  const id = document.querySelector('#stallion-select').value;
  return stallions.find((s) => s.id === id) || null;
}

// --- Tab 1: Inzuchtprüfung ---

function renderInzuchtResult() {
  const container = document.querySelector('#inzucht-result');
  const mare = selectedMare();
  const stallion = selectedStallion();

  if (!mare || !stallion) {
    container.innerHTML = '';
    return;
  }

  const duplicates = findSharedNames(mare, stallion);
  const depthHint = pedigreeCompletenessHint(mare, stallion);

  let html = '<div class="result-card">';
  if (duplicates.length === 0) {
    html += '<div class="pill yes">Keine Namensdopplung im sichtbaren Stammbaum gefunden</div>';
  } else {
    html += '<div class="pill no">Inzucht-Risiko: gemeinsame Namen im sichtbaren Stammbaum</div>';
    html += '<table class="detail-table"><tr><th>Name</th><th>Fundstellen</th></tr>';
    for (const dup of duplicates) {
      const spots = dup.occurrences.map((o) => `${o.side}: ${o.role}`).join(', ');
      html += `<tr><td>${escapeHtml(dup.name)}</td><td>${escapeHtml(spots)}</td></tr>`;
    }
    html += '</table>';
  }
  if (depthHint) html += `<p class="small muted">${escapeHtml(depthHint)}</p>`;
  html += '</div>';
  container.innerHTML = html;
}

function pedigreeCompletenessHint(mare, stallion) {
  const mareDepth = pedigreeDepth(mare);
  const stallionDepth = pedigreeDepth(stallion);
  if (mareDepth >= 14 && stallionDepth >= 14) return '';
  return `Hinweis: Stammbaum unvollständig erfasst (Stute: ${mareDepth}/14, Hengst: ${stallionDepth}/14 bekannte Vorfahren) – ` +
    'eine Verwandtschaft kann dadurch nicht sicher ausgeschlossen werden.';
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
