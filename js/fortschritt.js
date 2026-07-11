// Fortschritt je Werkzeug - von Hand gepflegt (subjektive Einschätzung,
// nicht aus der Commit-Historie ableitbar). Bei Bedarf hier anpassen.
const PROGRESS = [
  { label: 'Inzuchtprüfer', percent: 100 },
  { label: 'Turnierplaner', percent: 100 },
  { label: 'LP-Prognose', percent: 100 },
  { label: 'Zuchtbuch', percent: 20 },
  { label: 'Verpaarungsratgeber', percent: 20 },
];

const REPO = 'Nawira4330/mdr-planer';

document.addEventListener('DOMContentLoaded', () => {
  renderProgress();
  loadChangelog();
});

function renderProgress() {
  const container = document.querySelector('#progress-list');
  container.innerHTML = PROGRESS.map((p) => `
    <div class="progress-item">
      <div class="progress-label">
        <span>${escapeHtml(p.label)}</span>
        <span>${p.percent}%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill${p.percent >= 100 ? ' complete' : ''}" style="width:${p.percent}%;"></div>
      </div>
    </div>
  `).join('');
}

async function loadChangelog() {
  const container = document.querySelector('#changelog-list');
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=100`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const commits = await res.json();
    if (!Array.isArray(commits) || !commits.length) {
      container.innerHTML = '<p class="muted small">Noch keine Änderungen erfasst.</p>';
      return;
    }
    container.innerHTML = commits.map(commitHtml).join('');
  } catch (err) {
    container.innerHTML =
      `<p class="error">Änderungsliste konnte nicht geladen werden (${escapeHtml(err.message)}). ` +
      `Direkt auf <a href="https://github.com/${REPO}/commits/main" target="_blank" rel="noopener">GitHub ansehen ↗</a>.</p>`;
  }
}

function commitHtml(commit) {
  const date = new Date(commit.commit.author.date);
  const dateStr = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const lines = commit.commit.message.split('\n').map((l) => l.trim()).filter(Boolean);
  const title = lines[0] || '(ohne Beschreibung)';
  const bodyLines = lines.slice(1).filter((l) => !l.startsWith('Co-Authored-By'));
  const bodyHtml = bodyLines.map((l) => escapeHtml(l)).join('<br>');

  return `<div class="changelog-entry">
    <div class="changelog-date">${dateStr} · ${timeStr} Uhr</div>
    <p class="changelog-title"><strong>${escapeHtml(title)}</strong></p>
    ${bodyHtml ? `<p class="small muted">${bodyHtml}</p>` : ''}
  </div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
