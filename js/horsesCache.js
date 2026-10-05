// Gemeinsamer Zwischenspeicher fuer die grossen Pferde-Bulk-Abfragen in
// Zuchtbuch/Zuchtplaner (Nutzerwunsch 2026-10-04, Egress-Reduktion bei sehr
// haeufig genutzten Seiten, die Verpaarungs-/Inzucht-Funktionen wegen
// js/verpaarung.js und js/breeding.js nicht auf schlanke Spalten getrimmt
// werden koennen - siehe js/list.js/js/durchschnitt.js in der MDR-Datenbank
// fuer den Gegenfall "Spalten trimmen").
//
// Loesung hier: der volle Datensatz (mehrere MB) wird NICHT bei jedem
// Seitenaufruf und nicht alle 5 Minuten blind neu geladen, sondern in
// IndexedDB zwischengespeichert (localStorage ist mit oft >8MB pro Abfrage
// zu klein/riskant - Quota meist nur 5-10MB pro Origin) und nur dann neu
// vom Server geholt, wenn sich seit dem letzten Abruf laut Supabase
// tatsaechlich etwas geaendert hat. Die Pruefung dafuer (fetchTableFreshness)
// ist absichtlich winzig: 1 Zeile + exakte Anzahl per Count-Header, statt
// des vollen Datensatzes. "updated_at" wird fuer "horses"/"foal_reference_
// data" per DB-Trigger (set_updated_at(), siehe supabase/schema.sql) bei
// JEDER Aenderung automatisch aktualisiert - zusammen mit der Anzahl deckt
// das Einfuegen, Aendern UND Loeschen ab.
//
// Waehrend die Seite im Hintergrund-Tab ist, pausiert der 5-Minuten-Timer
// komplett (Page Visibility API) - keine Abrufe fuer offen gelassene,
// gerade nicht genutzte Tabs; beim Zurueckkommen wird einmalig sofort
// geprueft, ob in der Zwischenzeit etwas passiert ist.

const HORSES_CACHE_DB = 'mdr-planer-cache';
const HORSES_CACHE_STORE = 'queries';
const HORSES_CACHE_RECHECK_MS = 5 * 60 * 1000;

// Eine einzige, wiederverwendete Verbindung (statt bei jedem Zugriff neu zu
// oeffnen und offen zu lassen). Schlaegt das Oeffnen fehl (z.B. privater
// Modus), wird das Ergebnis NICHT gemerkt - der naechste Zugriff versucht es
// erneut.
let horsesCacheDbPromise = null;
function openHorsesCacheDb() {
  if (!horsesCacheDbPromise) {
    horsesCacheDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(HORSES_CACHE_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(HORSES_CACHE_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((err) => { horsesCacheDbPromise = null; throw err; });
  }
  return horsesCacheDbPromise;
}

// Alle Cache-Zugriffe sind bewusst best-effort (try/catch -> null bzw. kein
// Fehler nach aussen): IndexedDB kann z.B. im privaten Modus/bei vollem
// Speicher fehlschlagen - dann wird einfach immer frisch geladen, statt die
// Seite kaputtzumachen.
async function horsesCacheGet(key) {
  try {
    const db = await openHorsesCacheDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(HORSES_CACHE_STORE, 'readonly');
      const req = tx.objectStore(HORSES_CACHE_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function horsesCacheSet(key, value) {
  try {
    const db = await openHorsesCacheDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HORSES_CACHE_STORE, 'readwrite');
      tx.objectStore(HORSES_CACHE_STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Zwischenspeichern ist best-effort - ein Fehler hier darf das Laden nicht verhindern.
  }
}

// Billige "hat sich etwas geaendert"-Abfrage fuer eine Tabelle: 1 Zeile
// (neuestes updated_at) + exakte Gesamtanzahl (per Count-Header, bezieht
// sich auf ALLE Zeilen, nicht nur die zurueckgegebene). Liefert null bei
// Fehler.
async function fetchTableFreshness(table) {
  try {
    const { data, error, count } = await supabaseClient
      .from(table).select('updated_at', { count: 'exact' }).order('updated_at', { ascending: false }).limit(1);
    if (error || count == null) return null;
    return { updatedAt: data?.[0]?.updated_at ?? null, count };
  } catch {
    return null;
  }
}

// Laedt Daten mit Zwischenspeicher. Ablauf:
//  1. Freshness aller "tables" pruefen (winzige Abfragen) -> "version".
//  2. version === knownVersion (= was die Seite schon im Speicher hat):
//     nichts zu tun -> { unchanged: true }, es wird nicht einmal der
//     Zwischenspeicher gelesen.
//  3. Passt der Zwischenspeicher (gleiche version UND gleiche Spalten-
//     Signatur "sig") -> daraus liefern.
//  4. Sonst fetchFresh() ausfuehren (der volle Abruf, liefert
//     { value, error }) und das Ergebnis zwischenspeichern.
// Ist die Freshness-Pruefung nicht moeglich (version === null): beim ersten
// Laden (knownVersion == null) wird sicherheitshalber normal voll geladen,
// bei einem spaeteren Refresh dagegen NICHTS getan - sonst wuerde eine
// gestoerte Pruefung bei jedem Takt einen teuren Volldownload ausloesen.
// "sig" (z.B. die Select-Spaltenliste) verhindert, dass nach einer
// Code-Aenderung veraltete Zeilen mit anderen Spalten aus dem Cache kommen.
async function loadWithCache({ cacheKey, tables, sig, knownVersion, fetchFresh }) {
  const freshnesses = await Promise.all(tables.map((t) => fetchTableFreshness(t)));
  const version = freshnesses.every(Boolean) ? freshnesses.map((f) => `${f.updatedAt}|${f.count}`).join('#') : null;
  if (version === null && knownVersion != null) return { unchanged: true, version: knownVersion, value: null, error: null };
  if (version !== null) {
    if (version === knownVersion) return { unchanged: true, version, value: null, error: null };
    const cached = await horsesCacheGet(cacheKey);
    if (cached && cached.version === version && cached.sig === sig) {
      return { unchanged: false, version, value: cached.value, error: null };
    }
  }
  const { value, error } = await fetchFresh();
  if (!error && version !== null) await horsesCacheSet(cacheKey, { value, version, sig });
  return { unchanged: false, version, value, error };
}

// Haengt einen alle-5-Minuten-Refresh an eine Seite, der nur laeuft, waehrend
// der Tab sichtbar ist. Startet beim Aufruf NUR den Timer (kein sofortiger
// Check - die Seite hat ihre Daten gerade erst beim Aufruf geladen); beim
// Zurueckkommen aus dem Hintergrund wird einmalig sofort geprueft (verpasste
// Aenderungen nachholen), danach laeuft der Timer weiter. refreshFn soll die
// gecachten Ladefunktionen erneut aufrufen und nur bei tatsaechlich
// geaenderten Daten neu rendern. Ein noch laufender Refresh wird nicht
// ueberholt (kein Ueberlappen bei langsamer Verbindung), Fehler landen nur
// in der Konsole.
function wireHorsesAutoRefresh(refreshFn) {
  let timer = null;
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      await refreshFn();
    } catch (err) {
      console.warn('Automatische Aktualisierung fehlgeschlagen:', err);
    } finally {
      running = false;
    }
  }
  function start() {
    if (timer) return;
    timer = setInterval(tick, HORSES_CACHE_RECHECK_MS);
  }
  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stop(); return; }
    tick();
    start();
  });
  if (!document.hidden) start();
}
