const TOURNAMENT_SELECT_FIELDS =
  'id,name,gender,coat_color,disciplines,traits,tournament_potential,exterior_genetics,temperament';

let horses = [];
let currentMode = 'db';
let currentProfile = null;
let currentSort = { field: 'category', dir: 'asc' };

document.addEventListener('DOMContentLoaded', init);

async function init() {
  wireModeTabs();
  wireSortableHeaders();
  document.querySelector('#horse-select').addEventListener('change', onHorseSelect);
  document.querySelector('#parse-btn').addEventListener('click', onParse);
  await loadHorses();
}

async function loadHorses() {
  const errorEl = document.querySelector('#load-error');
  const { data, error } = await supabaseClient.from('horses').select(TOURNAMENT_SELECT_FIELDS).order('name');
  if (error) {
    errorEl.textContent =
      'Konnte Pferde nicht laden: ' + error.message +
      ' (falls die Seite ohne Login genutzt wird, muss dafür einmalig die Migration ' +
      '"migration_005_public_read_access.sql" im Supabase-Dashboard ausgeführt worden sein).';
    return;
  }
  horses = data || [];
  const sel = document.querySelector('#horse-select');
  sel.innerHTML = '<option value="">– bitte wählen –</option>';
  for (const h of horses) {
    const opt = document.createElement('option');
    opt.value = h.id;
    opt.textContent = h.name || '(ohne Name)';
    sel.appendChild(opt);
  }
}

function wireModeTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentMode = btn.dataset.mode;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelector('#mode-db').hidden = currentMode !== 'db';
      document.querySelector('#mode-freetext').hidden = currentMode !== 'freetext';
      currentProfile = null;
      document.querySelector('#profile-result').innerHTML = '';
    });
  });
}

function onHorseSelect() {
  const id = document.querySelector('#horse-select').value;
  const horse = horses.find((h) => h.id === id) || null;
  currentProfile = horse;
  renderProfile();
}

function onParse() {
  const text = document.querySelector('#raw-text').value;
  const statusEl = document.querySelector('#parse-status');
  if (!text.trim()) {
    statusEl.textContent = 'Bitte zuerst Text einfügen.';
    return;
  }
  currentProfile = parseHorseText(text);
  statusEl.textContent = 'Erkannt: ' + (currentProfile.name || 'kein Name gefunden');
  renderProfile();
}

function renderProfile() {
  const container = document.querySelector('#profile-result');
  const wrap = document.querySelector('#tournament-wrap');
  const tbody = document.querySelector('#tournament-table tbody');

  if (!currentProfile) {
    container.innerHTML = '';
    wrap.hidden = true;
    return;
  }

  const values = computeTournamentValues(currentProfile);
  const praemierung = checkPraemierung(currentProfile);

  const extPct = currentProfile.exterior_genetics?.overall?.percent;
  const intAvg = averageScore(currentProfile.temperament, scoreTemperamentTerm);

  let html = `<div class="result-card">`;
  html += `<h2>${escapeHtml(currentProfile.name || '(ohne Name)')}</h2>`;
  html += `<p class="small muted">`;
  html += `Ext (Körperbau): <strong>${extPct != null ? extPct + '%' : '–'}</strong>`;
  html += ` &nbsp;·&nbsp; Int: <strong>${intAvg != null ? intAvg.toFixed(2) : '–'}</strong>`;
  html += `</p>`;
  html += `<p class="small muted">Prämierung: <strong>${escapeHtml(praemierung.status)}</strong> – ${escapeHtml(praemierung.hint)}</p>`;
  html += '</div>';
  container.innerHTML = html;

  if (!values.length) {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;
  tbody.innerHTML = applySort(values).map(rowHtml).join('');
}

function rowHtml(v) {
  return `<tr>
    <td>${escapeHtml(v.category)}</td>
    <td>${escapeHtml(v.name)}</td>
    <td>${v.wert != null ? v.wert + '%' : '–'}</td>
    <td>${v.interieur != null ? v.interieur.toFixed(2) : '–'}</td>
    <td>${v.complete && v.lk != null ? 'LK' + v.lk : '–'}</td>
  </tr>`;
}

function sortValue(row, field) {
  switch (field) {
    case 'category': return (row.category || '').toLowerCase();
    case 'name': return (row.name || '').toLowerCase();
    case 'wert': return row.wert;
    case 'interieur': return row.interieur;
    case 'lk': return row.complete ? row.lk : null;
    default: return null;
  }
}

// Fehlende Werte (null) landen unabhängig von der Richtung immer am Ende,
// gleiches Muster wie in js/list.js (MDR-Datenbank).
function applySort(rows) {
  const { field, dir } = currentSort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, field);
    const vb = sortValue(b, field);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string') return va.localeCompare(vb, 'de') * mult;
    return (va - vb) * mult;
  });
}

function wireSortableHeaders() {
  document.querySelectorAll('#tournament-table th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (currentSort.field === field) {
        currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort = { field, dir: 'asc' };
      }
      renderProfile();
    });
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
