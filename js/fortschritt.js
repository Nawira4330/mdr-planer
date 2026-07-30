// Fortschritt je Werkzeug - von Hand gepflegt (subjektive Einschätzung,
// nicht aus der Commit-Historie ableitbar). Bei Bedarf hier anpassen.
// WICHTIG (Vorgabe des Nutzers): 100% erst eintragen, wenn der Nutzer
// ausdrücklich sagt, dass ein Werkzeug fertig ist - nie eigenständig auf
// 100% setzen, auch wenn eine Funktion bereits vollständig implementiert
// und verifiziert wirkt.
const PROGRESS = [
  { label: 'Inzuchtprüfer', percent: 100 },
  { label: 'Turnierplaner', percent: 100 },
  { label: 'LP-Prognose', percent: 100 },
  { label: 'Zuchtbuch', percent: 85 },
  { label: 'Verpaarungsratgeber', percent: 90 },
  { label: 'Fohlen-Tracker', percent: 90 },
  { label: 'Verwandtschaftsmatrix', percent: 90 },
];

// Art der Änderung: 'feature' (neue Funktion), 'update' (Änderung an
// Bestehendem), 'bugfix' (Fehlerbehebung) - bestimmt Farbe und Label.
const TYPE_META = {
  feature: { label: 'Neu', color: 'var(--accent)' },
  update: { label: 'Update', color: 'var(--info)' },
  bugfix: { label: 'Bugfix', color: 'var(--warning)' },
};

// Änderungsverlauf - von Hand gepflegt, in einfacher Sprache. Bei jeder
// neuen Änderung oben (oder irgendwo, die Sortierung erfolgt automatisch
// nach Datum) einen neuen Eintrag ergänzen. "date" im ISO-Format
// (lokale Zeit, kein Zeitzonen-Suffix).
const CHANGELOG = [
  {
    date: '2026-07-29T11:00', type: 'feature', title: 'Verwandtschaftsmatrix: Top-Beschränkung nach Sortierung + Hengste↔Stuten',
    points: [
      'Beschränkung ("1.-30." usw.) bedeutet bei Sortierung nach "Anzahl"/"Inzucht" jetzt die Top-Werte aus ALLEN gefilterten Zeilen-Pferden statt der alphabetisch ersten 30 - z.B. zeigt "1.-30." bei Sortierung nach Inzucht die 30 Pferde mit der höchsten Inzuchtzahl',
      'Neuer Vergleich "Hengste ↔ Stuten" (zusätzlich zu Stuten↔Hengste) - Zeilen und Spalten vertauscht',
    ],
  },
  {
    date: '2026-07-29T10:00', type: 'feature', title: 'Verwandtschaftsmatrix: Filter und Sortierung nach Inzucht-Gefahr',
    points: [
      'Neuer Filter „Bei Verpaarung (Fohlen)“: Alle / Nur mit Inzucht-Gefahr / Nur ohne Inzucht-Gefahr - blendet die jeweils anderen Zellen-Markierungen aus, ohne die Zeilen/Spalten-Auswahl selbst zu verändern',
      '„Anzahl“ und „Inzucht“ jetzt zwei eigene, unabhängig sortierbare Spalten (vorher eine kombinierte Spalte) - so lässt sich z.B. gezielt nach der meisten Inzucht-Gefahr sortieren',
    ],
  },
  {
    date: '2026-07-29T09:00', type: 'bugfix', title: 'Stammbaum von per Freitext eingelesenen Pferden war um 1 verschoben',
    points: [
      'Der Kopiertext wiederholt direkt unter "Stammbaum" noch einmal die eigene Kopfzeile des Pferds (Name, Rasse, Potenzial), bevor die echten Vorfahren folgen - dieser Wiederholungs-Eintrag wurde bisher nicht erkannt und fälschlich als erster "Vorfahre" mitgezählt',
      'Dadurch rutschten alle Positionen um 1 (aus dem echten Vater wurde ein "Vorfahre" des Pferds selbst) und der jeweils letzte echte Vorfahre fiel unter den Tisch (nur 14 Plätze insgesamt)',
      'Betraf u.a. "Fremder Hengst" in der Inzuchtprüfung und "Datenbankfremdes Pferd" in der Verwandtschaftsmatrix - konnte dort fälschlich Inzucht anzeigen (weil das Pferd sich selbst als eigenen Vorfahren "traf") oder eine echte Verwandtschaft übersehen',
      'Jetzt korrekt erkannt und entfernt, mit zwei realen Beispiel-Pferden verifiziert',
    ],
  },
  {
    date: '2026-07-28T15:00', type: 'feature', title: 'Verwandtschaftsmatrix: Inzucht-Gefahr farblich unterschieden',
    points: [
      'Verwandte Zellen in der Matrix sind jetzt rot (würde bei Verpaarung echte Inzucht im gemeinsamen Fohlen verursachen) oder grün (verwandt, aber der gemeinsame Vorfahre liegt zu weit zurück, um im sichtbaren Fohlen-Stammbaum aufzutauchen) - geprüft mit derselben Logik wie die Inzuchtprüfung im Zuchtplaner',
      '"Anzahl"-Spalte zeigt zusätzlich in Klammern, wie viele der verwandten Pferde davon eine echte Inzucht-Gefahr wären',
      'Dieselbe Unterscheidung jetzt auch bei „Einzelnes Pferd nachschlagen“: neue Spalte „Bei Verpaarung“ pro gefundenem Verwandten, plus Inzucht-Anzahl in Klammern in der Überschrift',
    ],
  },
  {
    date: '2026-07-28T14:00', type: 'feature', title: 'Zuchtbuch: Verwandten-Zusammenfassung erweitert',
    points: [
      'Zusammenfassung über der Verwandtschaftsübersicht zählt Enkelkinder jetzt einzeln, statt sie mit "Sonstige Verwandte" zu vermischen',
      '"Weitere Verwandtschaft" (bei "Alle Verwandtschaft") zeigt jetzt zusätzlich, wo genau sich der gemeinsame Vorfahre im Stammbaum beider Pferde befindet, z.B. bei diesem Pferd Großeltern, beim gefundenen Pferd Urgroßeltern',
    ],
  },
  {
    date: '2026-07-28T13:00', type: 'bugfix', title: 'Erbkrankheiten-Prüfung erkannte echte Träger bisher nicht',
    points: [
      'Die EKH-Erkennung (Inzuchtprüfung, Verpaarungsratgeber, Zuchtbuch) sowie die LP-Prognose gingen von derselben Groß-/Kleinschreibung wie bei den Farbgenen aus - Erbkrankheiten-Rohwerte folgen aber einem eigenen Format ("NN/NN" = frei, "HE/NN" = Träger, immer großgeschrieben, dazu "Nicht getestet")',
      'Dadurch wurden "Nicht getestet"-Pferde fälschlich als Träger gezählt, während echte Träger (z.B. "JE/NN") komplett übersehen wurden - betraf auch, ob die LP-Prüfung eine ausgeprägte Erbkrankheit korrekt erkennt',
      'Jetzt korrekt anhand des echten NN/XX-Formats geprüft, mit echten Datenbankwerten verifiziert',
      'EKH-Warnung gleichzeitig verbessert: erscheint jetzt schon, wenn NUR EIN Elternteil betroffen ist (gelb), nicht mehr erst wenn beide dieselbe Krankheit tragen - zusätzlich rot, wenn ein Elternteil eine Krankheit bereits ausgeprägt (homozygot) hat',
    ],
  },
  {
    date: '2026-07-28T10:00', type: 'feature', title: 'Verpaarungsratgeber: Kombinierter Ausgleich aus 2 frei wählbaren Kriterien',
    points: [
      'Neue Sortierung "Kombinierter Ausgleich (2 Kriterien)" - kombiniert den Ausgleich-Prozentsatz des Schwerpunkts mit einem frei wählbaren 2. Kriterium (GP/Ext/Ext%/Int)',
      'Gewichtung zwischen beiden Kriterien individuell einstellbar (0-100 %, z.B. 70 % GP / 30 % Ext%)',
      'Bewusst immer nur 2 Kriterien gleichzeitig kombinierbar, nicht mehr',
    ],
  },
  {
    date: '2026-07-27T18:00', type: 'feature', title: 'Verpaarungsratgeber: Eigener Ext-Ausgleich (getrennt von Ext%)',
    points: [
      'Schwerpunkt Ext hat beim "Bester Ausgleich" jetzt eine eigene, zweistufige Priorität statt derselben Formel wie Ext%: 1. Merkmale mit eigener Kategorie "In Ordnung"/"Schlecht"/"Miserabel" möglichst stark ausgleichen, 2. bereits "Exzellent"/"Gut" bewertete Merkmale nicht verschlechtern lassen',
      'Die eigene Kategorie je Merkmal wird direkt aus denselben Genort-Daten wie Ext% berechnet (nicht aus dem separaten Beschreibungstext) - dadurch bleiben Ext- und Ext%-Ausgleich auf derselben Datengrundlage, aber mit unterschiedlicher Gewichtung',
      'Ext% selbst bleibt unverändert (weiterhin alle Problem-Genorte gleich gewichtet)',
    ],
  },
  {
    date: '2026-07-27T15:00', type: 'bugfix', title: 'Verpaarungsratgeber: Flaxen-Träger-Erkennung findet mehr Pferde',
    points: [
      'Neu: erkennt Trägerschaft zusätzlich über bekannte eigene NACHKOMMEN - ist ein Fohlen sichtbar Flaxen, müssen beide Eltern zwingend Träger sein (genetisch bewiesen bei einem rezessiven Merkmal), unabhängig davon, ob die eigenen Eltern des Pferds überhaupt erfasst sind (bei vielen Pferden nicht der Fall)',
      'Bewusst weiterhin nur eine Generation weit (Eltern bzw. eigene Fohlen) - bei Großeltern & Co. besteht keine Gewissheit mehr, nur noch eine Wahrscheinlichkeit (50%/25%), das würde fälschlich Nicht-Träger als Träger einstufen',
      'Ergebnis mit echten Daten verifiziert: von 5 auf 12 erkannte Hengst-Träger, von 16 auf 23 erkannte Stuten-Träger',
    ],
  },
  {
    date: '2026-07-27T11:00', type: 'feature', title: 'Verpaarungsratgeber: Ausgleich-Sortierung jetzt auch für GP und Int, Top 20 statt Top 10',
    points: [
      '"Bester Ausgleich der Stuten-/Hengst-Schwächen" gibt es jetzt für alle vier Schwerpunkte (vorher nur Ext%) - zählt gezielt, wie viele der eigenen unterdurchschnittlichen Werte des Ausgangspferds ein Kandidat ausgleicht',
      'Grund: bei "Bester Best Case" gewinnt bei GP und Ext% praktisch immer derselbe, individuell stärkste Kandidat, unabhängig von der gewählten Stute/dem gewählten Hengst - die Ausgleich-Sortierung liefert dagegen eine wirklich ausgangspferd-abhängige Rangfolge',
      'Trefferliste von Top 10 auf Top 20 erweitert - mehr Auswahl auf einen Blick',
      'Bugfix: bei Richtung "Hengst → beste Stuten" aktualisierte sich die Trefferliste nicht, wenn per Dropdown ein anderer Hengst gewählt wurde (blieb auf dem vorherigen stehen)',
    ],
  },
  {
    date: '2026-07-25T15:00', type: 'feature', title: 'Neues Werkzeug: Fohlen-Tracker',
    points: [
      'Fohlenanzahl eines Pferds mit ZZL nachschlagen (mit Besitzer-Filter für die Suche) - Anzahl plus Liste aller gefundenen Fohlen',
      'Top 10 der Pferde mit den meisten Fohlen, filterbar nach Besitzer, Geschlecht und Rasse',
      'Jede Top-10-Zeile per Klick aufklappbar: Fohlenliste mit Name, Rasse, Geschlecht, GP/Ext/Ext%/Int, ZZL, Farbe und Besitzer',
    ],
  },
  {
    date: '2026-07-19T12:00', type: 'feature', title: 'Neues Werkzeug: Verwandtschaftsmatrix',
    points: [
      'Einzelnes Pferd nachschlagen: alle verwandten Pferde mit gemeinsamem Namen und Position im Stammbaum (Elternteil/Großeltern/Urgroßeltern) bei beiden Pferden',
      'Matrix-Ansicht über viele Pferde gleichzeitig (Stuten↔Hengste, Stuten↔Stuten, Hengste↔Hengste), filterbar nach Besitzer, Rasse und ZZL, mit "Anzahl"-Spalte je Pferd',
    ],
  },
  {
    date: '2026-07-13T20:15', type: 'feature', title: 'Decksprung-Button speichert echt im Verpaarungs-Log',
    points: [
      '"Decksprung nutzen" in Inzuchtprüfung und Verpaarungsratgeber trägt die Anpaarung jetzt direkt in das Verpaarungs-Log der Pferdedatenbank ein',
      'Kein Login nötig - der Eintrag lässt sich später dort mit Datum, "Fohlen behalten?" und Notizen ergänzen',
    ],
  },
  {
    date: '2026-07-13T10:20', type: 'feature', title: 'Neues Werkzeug: Zuchtbuch',
    points: [
      'Zu einem beliebigen Pferd alle im Stammbaum auffindbaren Verwandten anzeigen: Eltern, Geschwister, Nachkommen über alle Generationen',
      'Übersichtstabelle mit denselben Werten wie in der Pferdedatenbank, sortierbar',
      'Wenn beide Eltern bekannt sind: Vergleich der Fohlen-Vorhersage (GP/Int) mit den tatsächlichen Werten',
    ],
  },
  {
    date: '2026-07-13T10:00', type: 'feature', title: 'Datenbank-Schätzung als dritter Wert bei der Fohlen-Vorhersage',
    points: [
      'Neben Best Case und Worst Case jetzt zusätzlich eine realistischere Schätzung, berechnet aus echten Eltern-Fohlen-Paaren in der Datenbank',
      'Wird automatisch genauer, je mehr Fohlen eingetragen werden',
      '"Decksprung nutzen"-Button als Vorschau ergänzt (noch ohne Funktion, kommt später)',
    ],
  },
  {
    date: '2026-07-13T09:40', type: 'update', title: 'Verpaarungsratgeber: Sortierung wählbar, Interieur-Vorhersage überarbeitet',
    points: [
      'Ergebnisse lassen sich jetzt nach bestem Best Case, bestem Worst Case oder kleinster/größter Schwankungsbreite sortieren',
      'Interieur-Vorhersage folgt jetzt einer klareren Tabelle statt einer groben Schätzung',
    ],
  },
  {
    date: '2026-07-13T09:20', type: 'update', title: 'Startseite übersichtlicher',
    points: [
      'Verpaarungsratgeber und Zuchtbuch haben jetzt eigene Karten mit Direktlink',
      'Jede Karte hat eine kurze, einklappbare Anleitung',
    ],
  },
  {
    date: '2026-07-13T09:00', type: 'bugfix', title: 'Kleinere Bedienbarkeits-Verbesserungen',
    points: [
      'Klick in ein Suchfeld öffnet die Auswahl wieder und markiert den bisherigen Text - kein manuelles Löschen mehr nötig',
      '"Fremder Hengst"-Feld in der Inzuchtprüfung ist jetzt standardmäßig eingeklappt',
    ],
  },
  {
    date: '2026-07-12T21:15', type: 'feature', title: '"Beste Hengstauswahl" wird zum Verpaarungsratgeber',
    points: [
      'Stute wählen und die Top 10 passenden Hengste sehen, mit wählbarem Schwerpunkt (GP, Ext, Ext%, Int)',
      'Optionale Farbwünsche-Auswahl (Overo, Tobiano, Roan, Champagne, ...)',
      'Echte Fohlen-Vorhersage (Best-/Worst-Case) statt nur der Ist-Werte des Hengstes - basiert bei Ext/Ext% auf dem echten Gencode, bei GP auf den echten Grundlagen-/Gangarten-/Disziplin-Werten',
      'Weiterhin: keine Anzeige bei Inzucht oder möglichem doppeltem Overo',
    ],
  },
  {
    date: '2026-07-12T19:36', type: 'feature', title: 'Turniertabelle im Handyformat',
    points: ['Zeigt auf schmalen Bildschirmen jede Disziplin als eigene Karte statt einer breiten Tabelle', 'Kein seitliches Scrollen mehr nötig'],
  },
  {
    date: '2026-07-12T08:28', type: 'bugfix', title: 'Handylayout repariert',
    points: ['Menüleiste lief auf schmalen Bildschirmen über den Rand hinaus - umbricht jetzt korrekt', 'Alle Seiten auf Handy-Breite geprüft'],
  },
  {
    date: '2026-07-12T00:18', type: 'update', title: 'Änderungsverlauf übersichtlicher',
    points: ['Einträge jetzt farbig nach Art markiert: Neu / Update / Bugfix', 'Kürzere, einfachere Beschreibungen statt technischer Details'],
  },
  {
    date: '2026-07-11T23:22', type: 'feature', title: 'Neue Seite: Fortschritt & Änderungen',
    points: ['Zeigt den Fortschritt der einzelnen Werkzeuge', 'Listet alle bisherigen Änderungen mit Datum auf'],
  },
  {
    date: '2026-07-11T23:06', type: 'update', title: 'Nur Pferde mit ZZL im Zuchtplaner wählbar',
    points: ['Stute und Hengst lassen sich nur noch aus Pferden mit Zuchtzulassung auswählen'],
  },
  {
    date: '2026-07-10T22:54', type: 'feature', title: 'Suche in der Pferde-Auswahl verbessert',
    points: ['Findet jetzt auch Namen, bei denen der Suchtext nicht ganz am Anfang steht'],
  },
  {
    date: '2026-07-10T22:45', type: 'update', title: 'ZZL-Filter im Turnierplaner + klarere Inzucht-Anzeige',
    points: ['Turnierplaner zeigt nur noch Pferde ohne ZZL', 'Zuchtplaner zeigt jetzt deutlich "KEINE Inzucht" (grün) oder "INZUCHT!!!" (rot)'],
  },
  {
    date: '2026-07-10T22:32', type: 'update', title: 'Platzhaltertext beim Fohlen entfernt',
    points: ['"Mögliche Werte des Fohlens" (noch ohne Inhalt) vorerst entfernt'],
  },
  {
    date: '2026-07-10T22:28', type: 'bugfix', title: 'Fehler im Stammbaum behoben',
    points: ['Manche Pferde zeigten einen leeren oder falschen Stammbaum', 'Betraf z.B. die Erkennung von Vater-Tochter-Verpaarungen'],
  },
  {
    date: '2026-07-10T22:13', type: 'feature', title: 'Warnung bei Overo × Overo',
    points: ['Neue Warnung, wenn sowohl Stute als auch Hengst Overo tragen'],
  },
  {
    date: '2026-07-10T22:12', type: 'bugfix', title: '"Unbekannt" löste fälschlich Inzucht-Alarm aus',
    points: ['"Unbekannt" im Stammbaum zählt jetzt nicht mehr als Namensdopplung'],
  },
  {
    date: '2026-07-10T20:54', type: 'feature', title: 'Zuchtplaner komplett überarbeitet',
    points: [
      'Zeigt Mutter und Vater sofort nach Auswahl an (nicht erst beide zusammen)',
      'Besitzer-Filter für Stute und Hengst',
      'Fremde Hengste (nicht in der Datenbank) per Freitext möglich',
      'Stammbaum des Fohlens wird angezeigt',
    ],
  },
  {
    date: '2026-07-10T16:53', type: 'feature', title: 'Besitzer-Filter im Turnierplaner',
    points: ['Pferde lassen sich jetzt nach Besitzer filtern'],
  },
  {
    date: '2026-07-10T16:49', type: 'update', title: 'Erklärtext im Turnierplaner entfernt',
    points: [],
  },
  {
    date: '2026-07-10T16:47', type: 'update', title: 'Turnierplaner-Tabs umbenannt',
    points: ['"Pferd aus Datenbank" heißt jetzt "Pferd aus ZG"', '"Freitext" heißt jetzt "Fremdes Pferd"'],
  },
  {
    date: '2026-07-10T16:42', type: 'bugfix', title: 'Ext und Ext% wurden vermischt',
    points: ['Werden jetzt korrekt als zwei getrennte Werte angezeigt'],
  },
  {
    date: '2026-07-10T16:38', type: 'bugfix', title: 'LP-Prüfung genauer',
    points: ['Nur noch die Hauptdisziplin zählt, nicht alle 28 Disziplinen', 'Nur die 4 normalen Gangarten zählen, nicht die Gangpferd-Gangarten'],
  },
  {
    date: '2026-07-10T16:33', type: 'bugfix', title: 'Handy-Texte werden jetzt richtig gelesen',
    points: ['Kopierter Text von der Handy-Ansicht des Spiels wird jetzt korrekt erkannt'],
  },
  {
    date: '2026-07-10T16:23', type: 'feature', title: 'Leistungsprüfung (LP) eingeführt',
    points: ['"Prämierung" heißt jetzt "Leistungsprüfung (LP)" und prüft echte Kriterien', 'GP wird jetzt zusätzlich oben angezeigt'],
  },
  {
    date: '2026-07-10T16:13', type: 'bugfix', title: 'Punkte-Formel korrigiert',
    points: ['Anhand eines echten Pferdes überprüft', 'Fehler bei "Gelassenheit" behoben (zählte an der falschen Stelle)'],
  },
  {
    date: '2026-07-10T16:02', type: 'feature', title: 'Echte Turnierwert-Berechnung',
    points: ['Wert, LK und Interieur werden jetzt nach den echten Spielregeln berechnet (alle 28 Disziplinen)'],
  },
  {
    date: '2026-07-09T12:10', type: 'feature', title: 'Zuchtplaner & Turnierplaner gestartet',
    points: ['Neue, eigene Webseite - getrennt von der Pferdedatenbank', 'Kein Login nötig, nur lesender Zugriff'],
  },
];

document.addEventListener('DOMContentLoaded', () => {
  renderProgress();
  renderChangelog();
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

function renderChangelog() {
  const container = document.querySelector('#changelog-list');
  if (!CHANGELOG.length) {
    container.innerHTML = '<p class="muted small">Noch keine Änderungen erfasst.</p>';
    return;
  }
  // Neueste Aktualisierung immer ganz oben, unabhängig von der
  // Reihenfolge im Array.
  const sorted = [...CHANGELOG].sort((a, b) => new Date(b.date) - new Date(a.date));
  container.innerHTML = sorted.map(entryHtml).join('');
}

function entryHtml(entry) {
  const meta = TYPE_META[entry.type] || TYPE_META.update;
  const date = new Date(entry.date);
  const dateStr = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const pointsHtml = entry.points && entry.points.length
    ? `<ul class="small muted changelog-points">${entry.points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
    : '';

  return `<div class="changelog-entry ${entry.type}">
    <div class="changelog-date">${dateStr} · ${timeStr} Uhr</div>
    <p class="changelog-title">
      <span class="changelog-badge ${entry.type}">${meta.label}</span>
      <strong>${escapeHtml(entry.title)}</strong>
    </p>
    ${pointsHtml}
  </div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
