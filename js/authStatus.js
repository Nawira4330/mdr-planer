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
// initAuthStatus() wird jetzt von zwei Stellen aufgerufen: automatisch aus
// js/nav.js (renderSharedNav(), deckt Seiten ohne eigenen Aufruf ab, z.B.
// index.html) UND explizit aus der init() der 5 Werkzeug-Seiten (die
// currentAuthSession synchron VOR ihrem eigenen ersten Laden brauchen,
// siehe z.B. loadVerpaarungLogEnabled() in js/zuchtplaner.js). Das
// gecachte Promise verhindert doppelte Arbeit/doppelte
// onAuthStateChange-Abos, wenn beide Aufrufer zusammentreffen.
let authStatusInitPromise = null;

function initAuthStatus() {
  if (authStatusInitPromise) return authStatusInitPromise;
  authStatusInitPromise = (async () => {
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
  })();
  return authStatusInitPromise;
}

function isLoggedIn() {
  return !!currentAuthSession?.user;
}

// Benutzername (Teil der E-Mail vor dem "@") des eingeloggten Kontos, oder
// null ohne Login - gleiches Muster wie currentIdentity in js/list.js der
// MDR-Datenbank. Eigenständig abrufbar (nicht nur über isOwnerOf), z.B.
// für "wie viele der hier gezeigten Pferde gehören MIR", unabhängig vom
// Besitzer eines konkret ausgewählten Pferdes (siehe js/fohlenpruefung.js).
function currentIdentity() {
  if (!isLoggedIn()) return null;
  return currentAuthSession.user.email.split('@')[0];
}

// Vergleicht das eingeloggte Konto mit einem Besitzer-Namen (horses.owner) -
// Groß-/Kleinschreibung im "Besitzer"-Feld ist nicht garantiert einheitlich,
// deshalb case-insensitiv verglichen. Für "Schlagwort vorschlagen"
// (js/tagSuggest.js) - nur der Besitzer eines Pferdes soll dafür Vorschläge
// machen können, nicht jedes eingeloggte Konto.
function isOwnerOf(owner) {
  const identity = currentIdentity();
  if (!identity || !owner) return false;
  return identity.toLowerCase() === owner.toLowerCase();
}

// Beschriftet den dritten Nav-Dropdown (siehe js/nav.js) statt eines
// eigenen Textelements - der Dropdown-Inhalt selbst (Link zur
// Pferdedatenbank) hängt fest in nav.js, hier wird nur die
// Toggle-Beschriftung aktualisiert. Zeigt den Benutzernamen (Teil der
// E-Mail vor dem "@", siehe isOwnerOf) statt der vollen E-Mail-Adresse -
// gleiches Muster wie die Konto-Beschriftung in js/nav.js der
// MDR-Datenbank. Ohne Login (bzw. wenn niemand in der Pferdedatenbank
// angemeldet ist) bleibt es bei "Gast" - technisch weiterhin ein
// unangemeldeter/anonymer Nutzer, nur eben so betitelt.
function renderAuthStatus() {
  const el = document.querySelector('#auth-status-toggle');
  if (!el) return;
  el.textContent = isLoggedIn()
    ? `Angemeldet als: ${currentIdentity() || currentAuthSession.user.id}`
    : 'Angemeldet als: Gast';
}
