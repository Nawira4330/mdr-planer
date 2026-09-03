# MDR Zucht- & Turnierplaner

Zwei rein lesende Werkzeuge auf Basis der Pferdedaten aus
[MDR-Datenbank](https://github.com/Nawira4330/mdr-datenbank) (Pferde aus
[Morning Dust Ranch](https://www.morning-dust-ranch.de)):

- **Zuchtplaner**: Stute und Hengst auswählen, um den sichtbaren Stammbaum
  (Eltern, Großeltern, Urgroßeltern) auf doppelt vorkommende Namen zu prüfen
  – das ist die im Spiel angezeigte Tiefe, es wird kein Inzuchtkoeffizient
  berechnet. Im zweiten Tab "Beste Hengstauswahl" werden für eine gewählte
  Stute automatisch alle Hengste ausgeschlossen, die nach dieser Prüfung
  verwandt sind oder (falls die Stute Overo trägt) selbst Overo tragen.
  Weitere Auswahlkriterien folgen.
- **Turnierplaner**: Turnierwerte und Prämierungs-Status für ein Pferd aus
  der Datenbank oder per Freitext-Einfügen (auch fremde, nicht gespeicherte
  Pferde). Die Berechnung ist aktuell ein **Platzhalter** (siehe
  [`js/tournamentScoring.js`](js/tournamentScoring.js)) – die genauen
  Formeln/Kriterien werden noch ergänzt.

Diese Seite ist bewusst **getrennt** von [MDR-Datenbank](https://github.com/Nawira4330/mdr-datenbank),
wo Pferde angelegt/bearbeitet/gelöscht werden: Hier gibt es **kein Login**
und **keine Schreibfunktion** – der Code ruft nirgends `insert`/`update`/
`delete` auf, nur `select`.

- **Frontend**: statische Seite (HTML/CSS/JS, kein Build-Schritt für die
  lokale Entwicklung nötig) → gehostet über **GitHub Pages**. Beim Deployment
  läuft automatisch eine Minifizierungs-Pipeline (siehe
  [Deployment](#deployment) unten) - die Quelldateien im Repo bleiben davon
  unberührt.
- **Datenbank**: dieselbe [Supabase](https://supabase.com)-Datenbank wie
  MDR-Datenbank, nur lesend angebunden (kein eigenes Supabase-Projekt)

## Voraussetzung: Lesezugriff ohne Login in Supabase freischalten

Damit diese Seite ohne Login auf die Pferdedaten zugreifen kann, muss
einmalig im Supabase-Dashboard des **MDR-Datenbank**-Projekts (SQL Editor)
die Migration
[`supabase/migration_005_public_read_access.sql`](https://github.com/Nawira4330/mdr-datenbank/blob/main/supabase/migration_005_public_read_access.sql)
ausgeführt worden sein (falls noch nicht geschehen). Das erlaubt lesenden
Zugriff (nur `select`, kein `insert`/`update`/`delete`) auch ohne
eingeloggte Session. Bis dahin zeigen Zuchtplaner/Turnierplaner einen
Ladefehler an.

Hinweis: Der in [`js/config.js`](js/config.js) hinterlegte `anon`-Key steht
ohnehin öffentlich im Frontend-Code (GitHub Pages). Nach der Migration sind
die Pferdedaten damit lesend für jede*n mit diesem (bereits öffentlichen)
Key abrufbar. Schreibzugriff bleibt weiterhin ausschließlich eingeloggten
Konten in MDR-Datenbank vorbehalten.

## Auf GitHub veröffentlichen

1. Repository auf GitHub anlegen und dieses Projektverzeichnis pushen.
2. Im Repo unter **Settings → Pages → Build and deployment → Source** auf
   **"GitHub Actions"** stellen (nicht "Deploy from a branch") - einmaliger
   manueller Schritt, siehe [Deployment](#deployment) unten.
3. Nach dem nächsten Push auf `main` läuft der Workflow automatisch durch,
   danach ist die Seite unter der von GitHub angezeigten URL erreichbar.

## Deployment

Jeder Push auf `main` löst [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
aus: baut über [`scripts/build.js`](scripts/build.js) eine minifizierte
Kopie aller `.html`/`.css`/`.js`-Dateien (HTML/CSS/JS-Minifizierung, keine
Struktur-/Verhaltensänderung) und deployt **nur die** auf GitHub Pages. Die
Quelldateien im Repo bleiben unverändert - alle Kommentare, Herleitungen
und Begründungen bleiben also für zukünftige Änderungen erhalten, nur die
tatsächlich ausgelieferte Version ist kleiner.

Lokal testen: `npm install && npm run build` erzeugt `dist/` (nicht
committet, siehe `.gitignore`).

## Lokal testen (optional)

Ein einfacher lokaler Server liegt in `.claude/serve.ps1` (reines
PowerShell, kein Node/Python nötig):

```powershell
powershell -File .claude/serve.ps1
```

Danach `http://localhost:8080` im Browser öffnen.

## Aufbau

- `index.html` – Landingpage mit Links zu Zuchtplaner/Turnierplaner
- `zuchtplaner.html` + `js/zuchtplaner.js` + `js/breeding.js` –
  Inzuchtprüfung & Beste Hengstauswahl
- `turnierplaner.html` + `js/turnierplaner.js` + `js/tournamentScoring.js` –
  Turnierwerte & Prämierung
- `js/parser.js` – identischer Text-Parser wie in MDR-Datenbank (wird für
  die Freitext-Funktion im Turnierplaner wiederverwendet)
- `js/config.js` / `js/supabaseClient.js` – dieselben Supabase-Zugangsdaten
  wie in MDR-Datenbank (nur `anon`-Key, kein Login nötig)
