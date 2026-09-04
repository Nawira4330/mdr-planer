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

// Laedt ALLE Zeilen einer Abfrage in 1000er-Bloecken. PostgREST (Supabase)
// liefert pro Anfrage standardmaessig max. 1000 Zeilen ("max-rows") - ohne
// Pagination werden bei mehr als 1000 Datensaetzen die hinteren (bei
// .order('name') alphabetisch letzten) einfach stillschweigend verschluckt,
// OHNE Fehlermeldung (Bug gefunden 2026-09-04: horses hatte 1204, Pferde
// wie "Lavalino °16.4° ~VL~" fehlten dadurch komplett in Zuchtbuch &
// Geschwister-Suche - betraf alle Tools gleichermassen, die eine einzelne
// unpaginierte horses/foal_reference_data-Abfrage nutzen).
//
// buildQuery(from, to) muss bei JEDEM Aufruf eine NEUE Query liefern (z.B.
// (from, to) => supabaseClient.from('horses').select(FIELDS).order('name').range(from, to)) -
// Supabase-Query-Builder sind nicht wiederverwendbar, deshalb kein fertiger
// Query als Parameter, sondern eine Fabrik-Funktion dafuer.
async function fetchAllRows(buildQuery) {
  const pageSize = 1000;
  let from = 0;
  let all = [];
  for (;;) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) return { data: all.length ? all : null, error };
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return { data: all, error: null };
}
