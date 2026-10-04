# MDR Zucht- & Turnierplaner – Hinweise für Claude

Statische Web-App (kein Build-Schritt, GitHub Pages), liest **nur** aus der Supabase-Datenbank
der Schwester-App `mdr-datenbank` (gleiches Supabase-Projekt, gleiches Egress-Kontingent).
Schreibzugriffe nur über die dafür vorgesehenen Tabellen (z.B. `tag_suggestions`, `horses.tags`
nie direkt).

## Zusammenarbeit
- Antworten auf Deutsch, kurz. Nichts behaupten, was nicht geprüft wurde; Annahmen benennen.
- Kein Test-Framework: Logik per Node-`vm`-Skript prüfen (Dateien laden, Funktionen aufrufen); top-level `let`/`const` per `vm.runInContext('name = wert;')` setzen. Seiten mit Playwright/Chromium + Supabase-Mock.
- Supabase ist aus der Claude-Sitzung nicht erreichbar – bei Datenfragen den Nutzer um Beispieltext/Screenshot bitten.

## Deploy
- Pro Änderung kurzer Branch → committen → `git push -u origin <branch>` → `git checkout main && git pull origin main && git merge --ff-only <branch> && git push origin main` → Branch löschen. `main` = live.
- Neue Funktionen im Änderungsverlauf (`js/fortschritt.js`, `CHANGELOG`) und in `anleitung.html` nachtragen.

## Vorgaben des Nutzers (gelten dauerhaft)
- **Update-Texte** für Mitzüchter: Discord-Formatierung (`#`/`##`, `**fett**`, `-` Listen), im Kopierblock, auf Nachrichten à max. 2000 Zeichen verteilt, **ohne Admin-Themen**, ohne Emojis.
- Filter mit Dreifach-Zustand (Klick = nur diese, 2. Klick = ausschließen, 3. = neutral): Schlagwörter (`js/tagFilter.js`), Rassen (`js/breedFilter.js`), Farbwünsche im Zuchtplaner.
- Rasselos im Rassen-Filter: Schwellenwert + erlaubte Rassen im Mix (aus `breed_composition`).
- Fohlen-Tracker: Verwandten-Zahlen laufen immer gegen den kompletten Bestand; „nur eigene Pferde“ wirkt nur auf die aufgeklappte Liste.

## Technische Regeln
- **Egress sparen**: explizite Spaltenlisten, Bestand einmal laden; Seitenabrufe (`fetchAllRows`) immer mit stabiler Sortierung (`order('name')` oder `order('id')`).
- Geschlecht nie per exaktem Text vergleichen (`genderGroupOf()` im Fohlen-Tracker).
- Klicks in Tabellenzeilen mit Unterformularen (z.B. „Schlagwort vorschlagen“) dürfen das Auf-/Zuklappen der Zeile nicht auslösen.
