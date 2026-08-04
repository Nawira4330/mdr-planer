// Login-Status: MDR-Planer hat kein eigenes Login, teilt sich aber die
// Domain mit der Pferdedatenbank (beide unter nawira4330.github.io, nur
// andere Unterpfade) - eine dort bestehende eingeloggte Session wird
// über das geteilte localStorage automatisch erkannt (siehe
// js/supabaseClient.js). Zeigt den Status an ("Angemeldet als: <E-Mail>"
// bzw. "Angemeldet als: Gast") und stellt isLoggedIn() bereit, um
// Funktionen wie "Schlagwort vorschlagen" nur eingeloggten Nutzern
// anzubieten. MDR-Planer selbst loggt niemanden ein oder aus - Login/
// Logout passiert ausschließlich in der Pferdedatenbank.

let currentAuthSession = null;

async function initAuthStatus() {
  const { data } = await supabaseClient.auth.getSession();
  currentAuthSession = data.session;
  renderAuthStatus();
  // Falls sich der Login-Status in einem anderen Tab (Pferdedatenbank)
  // ändert, während diese Seite offen bleibt - selten, aber kostenlos
  // abzudecken.
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentAuthSession = session;
    renderAuthStatus();
  });
}

function isLoggedIn() {
  return !!currentAuthSession?.user;
}

function renderAuthStatus() {
  const el = document.querySelector('#auth-status');
  if (!el) return;
  el.textContent = isLoggedIn()
    ? `Angemeldet als: ${currentAuthSession.user.email || currentAuthSession.user.id}`
    : 'Angemeldet als: Gast';
}
