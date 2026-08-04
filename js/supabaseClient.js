// Benötigt das supabase-js CDN-Script (siehe <head> der HTML-Seiten) und config.js.
//
// MDR-Planer hat kein eigenes Login, teilt sich aber die Domain mit der
// Pferdedatenbank (beide unter nawira4330.github.io, nur andere
// Unterpfade) - eine dort bestehende eingeloggte Session wird deshalb
// über das geteilte localStorage automatisch erkannt (Standardverhalten,
// persistSession bleibt an). Siehe js/authStatus.js: das wird genutzt, um
// eingeloggten Nutzern zusätzliche Funktionen (z.B. Schlagwort
// vorschlagen) anzubieten und den Login-Status anzuzeigen - MDR-Planer
// selbst loggt niemanden ein oder aus, es liest nur mit.
const supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
