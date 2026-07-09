const TOURNAMENT_SELECT_FIELDS =
  'id,name,gender,coat_color,disciplines,tournament_potential,exterior_genetics,temperament';

let horses = [];
let currentMode = 'db';
let currentProfile = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  wireModeTabs();
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
  if (!currentProfile) {
    container.innerHTML = '';
    return;
  }

  const values = computeTournamentValues(currentProfile);
  const praemierung = checkPraemierung(currentProfile);

  let html = `<div class="result-card">`;
  html += `<h2>${escapeHtml(currentProfile.name || '(ohne Name)')}</h2>`;

  if (!values.length) {
    html += '<p class="muted small">Keine Disziplin-Werte im Profil gefunden.</p>';
  } else {
    html += '<table class="detail-table"><tr><th>Disziplin</th><th>Turnierwert (vorläufig)</th></tr>';
    for (const v of values) {
      html += `<tr><td>${escapeHtml(v.group)} – ${escapeHtml(v.name)}</td><td>${v.value != null ? v.value.toFixed(1) + '%' : '–'}</td></tr>`;
    }
    html += '</table>';
  }

  html += `<p class="small muted" style="margin-top:0.8rem;">Prämierung: <strong>${escapeHtml(praemierung.status)}</strong> – ${escapeHtml(praemierung.hint)}</p>`;
  html += '</div>';
  container.innerHTML = html;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
