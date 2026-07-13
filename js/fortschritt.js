// Fortschritt je Werkzeug - von Hand gepflegt (subjektive Einschätzung,
// nicht aus der Commit-Historie ableitbar). Bei Bedarf hier anpassen.
const PROGRESS = [
  { label: 'Inzuchtprüfer', percent: 100 },
  { label: 'Turnierplaner', percent: 100 },
  { label: 'LP-Prognose', percent: 100 },
  { label: 'Zuchtbuch', percent: 20 },
  { label: 'Verpaarungsratgeber', percent: 80 },
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
