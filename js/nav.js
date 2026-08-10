// Gemeinsame Kopfzeilen-Navigation - stilistisch 1:1 an js/nav.js der
// MDR-Datenbank angeglichen (aufklappbare Dropdown-Menüs statt einer
// langen Reihe einzelner Buttons, gleiche CSS-Klassen/Optik). Jede Seite
// behält nur "← Zur Übersicht" (bzw. gar nichts auf index.html) als
// eigenen Button direkt im HTML - renderSharedNav() hängt den Rest
// automatisch an, sobald die Seite geladen ist. Anders als in der
// MDR-Datenbank braucht es dafür keine Session (MDR-Planer hat kein
// eigenes Login) - der Login-Status wird nur mitgelesen (siehe
// js/authStatus.js) und bestimmt lediglich die Beschriftung des dritten
// Dropdowns.
//
// Nutzerwunsch: kein eigener "MDR-DB"-Reiter wie in der MDR-Datenbank -
// der Link zur Pferdedatenbank hängt stattdessen im "Angemeldet als"/
// "Gast"-Dropdown, analog zum "Konto"-Dropdown dort.
const PLANER_TOOL_LINKS = [
  { label: 'Zuchtplaner', url: 'zuchtplaner.html' },
  { label: 'Turnierplaner', url: 'turnierplaner.html' },
  { label: 'Zuchtbuch', url: 'zuchtbuch.html' },
  { label: 'Fohlen-Tracker', url: 'fohlen-tracker.html' },
  { label: 'Verwandtschaft', url: 'verwandtschaft.html' },
  { label: 'Fohlenprüfung', url: 'fohlenpruefung.html' },
];

function navEscapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderSharedNav() {
  const nav = document.querySelector('.topbar nav');
  if (!nav) return;

  const toolItems = PLANER_TOOL_LINKS
    .map(({ label, url }) => `<a href="${url}">${navEscapeHtml(label)}</a>`)
    .join('');

  // "display: contents" wurde hier bewusst NICHT verwendet - das
  // verursachte auf schmalen Bildschirmen einen Layout-Bug (der
  // umgebende <nav> berechnete seine Breite anhand der UNGEWRAPPTEN
  // Gesamtbreite aller Dropdown-Buttons statt korrekt intern
  // umzubrechen, was zu horizontalem Scrollen führte). Stattdessen ist
  // "nav-dropdowns" selbst ein eigener Flex-Container (wie "nav"), der
  // als EIN Flex-Item in "nav" landet und seine drei Dropdowns
  // eigenständig umbricht.
  const wrap = document.createElement('div');
  wrap.className = 'nav-dropdowns';
  wrap.innerHTML = `
    <div class="nav-dropdown">
      <button type="button" class="btn secondary nav-dropdown-toggle">Tools</button>
      <div class="nav-dropdown-menu" hidden>${toolItems}</div>
    </div>
    <div class="nav-dropdown">
      <button type="button" class="btn secondary nav-dropdown-toggle">MDR-Planer</button>
      <div class="nav-dropdown-menu" hidden>
        <a href="anleitung.html">Anleitung</a>
        <a href="update-log.html">Update-Log</a>
      </div>
    </div>
    <div class="nav-dropdown">
      <button type="button" class="btn secondary nav-dropdown-toggle" id="auth-status-toggle">Angemeldet als: Gast</button>
      <div class="nav-dropdown-menu" hidden>
        <a href="https://nawira4330.github.io/mdr-datenbank/" target="_blank" rel="noopener">MDR-Datenbank ↗</a>
      </div>
    </div>
  `;
  nav.appendChild(wrap);

  nav.querySelectorAll('.nav-dropdown-toggle').forEach((toggle) => {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const panel = toggle.nextElementSibling;
      const wasOpen = !panel.hidden;
      nav.querySelectorAll('.nav-dropdown-menu').forEach((p) => { p.hidden = true; });
      panel.hidden = wasOpen;
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-dropdown')) {
      nav.querySelectorAll('.nav-dropdown-menu').forEach((p) => { p.hidden = true; });
    }
  });

  // Login-Status nachladen, falls die Seite js/authStatus.js einbindet, aber
  // (wie index.html/anleitung.html/update-log.html) keinen eigenen Aufruf
  // von initAuthStatus() hat - initAuthStatus() ist mehrfach-aufrufsicher
  // (siehe dort), auf Seiten mit eigenem await initAuthStatus() in ihrer
  // init() passiert hier also keine doppelte Arbeit.
  if (typeof initAuthStatus === 'function') initAuthStatus();
}

document.addEventListener('DOMContentLoaded', renderSharedNav);
