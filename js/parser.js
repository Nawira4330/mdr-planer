// Parser für den kopierten Text einer Morning-Dust-Ranch Pferdeseite.
//
// Das Spiel liefert keine offizielle API/Export-Funktion. Dieser Parser
// arbeitet daher rein textbasiert (Label-Zeilen, Tab-getrennte Tabellenzeilen,
// Prozent-Paare) und ist bewusst tolerant statt strikt. Er ist "best effort":
// jedes Ergebnis wird dem Nutzer vor dem Speichern zur Kontrolle angezeigt,
// und der komplette Rohtext wird immer mit gespeichert (raw_text), damit
// nichts verloren geht, falls sich das Seitenlayout im Spiel mal ändert.

function parseHorseText(rawText) {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);

  const result = {
    raw_text: rawText,
  };

  Object.assign(result, extractHeaderBlock(lines));

  // --- Einfache "Label: Wert" Zeilen ---
  setIf(result, 'coat_color', findValueForLabel(nonEmpty, 'Fellfarbe'));
  setIf(result, 'owner', findValueForLabel(nonEmpty, 'Besitzer'));

  const erbkrankheitStatus =
    findValueForLabel(nonEmpty, 'Testergebnis') || findValueForLabel(nonEmpty, 'Erbkrankheit');
  if (erbkrankheitStatus) {
    result.disease_free = /frei/i.test(erbkrankheitStatus);
  }

  // --- Papiere ---
  const rasse = findValueForLabel(nonEmpty, 'Rasse');
  if (rasse) result.breed = rasse;
  const reinrassigkeit = findValueForLabel(nonEmpty, 'Reinrassigkeit');
  if (reinrassigkeit) {
    const m = reinrassigkeit.match(/([\d.,]+)\s*%/);
    if (m) result.purebred_pct = parseFloat(m[1].replace(',', '.'));
  }
  const zuchtzulassungLine = nonEmpty.find((l) => /^Zuchtzulassung\b/i.test(l));
  if (zuchtzulassungLine) {
    result.breeding_allowed = /ja/i.test(zuchtzulassungLine.replace(/^Zuchtzulassung/i, ''));
  }
  setIf(result, 'hlp_slp', findValueForLabel(nonEmpty, 'HLP/SLP'));

  // --- Zucht ---
  const icoVal = findValueForLabel(nonEmpty, 'ICO');
  if (icoVal) result.ico = parseFloat(icoVal.replace(',', '.').replace('%', '').trim());
  const fruchtbarkeit = findValueForLabel(nonEmpty, 'Fruchtbarkeit');
  if (fruchtbarkeit) result.fertility_pct = parseFloat(fruchtbarkeit.replace(',', '.').replace('%', '').trim());

  // --- Tabellen ---
  result.genetic_diseases = extractSimpleTable(lines, 'Erbkrankheiten', ['Farben']);
  result.colors = extractSimpleTable(lines, 'Farben', ['Exterieur']).filter(
    (r) => r.label !== 'Fellfarbe'
  );

  const exteriorGenetic = parseExteriorGenetics(lines);
  result.exterior_genetics = exteriorGenetic;

  result.exterior_descriptive = extractSimpleTable(lines, 'Körperbau', ['Interieur', 'Mentalität']);
  result.temperament = extractSimpleTable(lines, 'Mentalität', ['Modbox', 'Zucht', 'Nachkommen']);

  // Bei "Begabung"-Disziplinen zeigt die Seite zunächst nur eine Kategorie
  // (z.B. "Western") offen an, gefolgt von Trainingszustand/Turnierpotenzial;
  // die übrigen Kategorien folgen erst danach hinter "Alle Disziplinen
  // anzeigen?". Diese Zwischenzeilen enthalten keine Prozent-Paare und
  // werden vom Gruppen-Erkenner automatisch übersprungen.
  result.disciplines = extractPercentGroups(lines, 'Disziplin', 'Eigenschaften');
  result.traits = extractPercentGroups(lines, 'Eigenschaften', 'Papiere');

  result.tournament_potential = parseTournamentPotential(lines);
  // pedigreeAncestorNames() (js/breeding.js) erwartet beim "alten Format"
  // (einfaches Array statt {ancestors:[...]}) an Index 0 das Pferd SELBST
  // und liest die 14 Vorfahren erst ab Index 1 (slice(1,15)) - dasselbe
  // Format wie die in der DB gespeicherten pedigree-Felder. parsePedigree()
  // liefert aber nur die reinen Vorfahren ab Index 0 (kein Selbst-Eintrag),
  // ohne den Platzhalter hier würde daher der erste erkannte Vorfahre (i.d.R.
  // der Vater) beim Abgleich stillschweigend übersprungen.
  result.pedigree = [{ name: result.name }, ...parsePedigree(lines, result.name)];

  return result;
}

function setIf(obj, key, value) {
  if (value !== null && value !== undefined && value !== '') obj[key] = value;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Sucht eine Zeile im Format "Label: Wert" (auch wenn danach noch Text auf
// derselben Zeile folgt, z.B. "Reinrassigkeit: 100.00 % Rasseanteile anzeigen?").
function findValueForLabel(nonEmptyLines, label) {
  const re = new RegExp('^' + escapeRegex(label) + '\\s*:\\s*(.+)$', 'i');
  for (const line of nonEmptyLines) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

// Name/Alter/Geschlecht/Rasse/Reinrassigkeit stehen ohne Label direkt
// übereinander, kurz vor dem Link "Zum Pferd". Anker ist die Alterszeile
// ("19 Jahre, 10 Monate").
function extractHeaderBlock(lines) {
  const ageIdx = lines.findIndex((l) => /^\d+\s*Jahre?(,\s*\d+\s*Monate?)?$/i.test(l));
  if (ageIdx === -1) return {};

  let nameIdx = ageIdx - 1;
  while (nameIdx >= 0 && !lines[nameIdx]) nameIdx--;

  const out = {};
  if (nameIdx >= 0) out.name = lines[nameIdx];

  const genderLine = lines[ageIdx + 1];
  if (genderLine && /^(Stute|Hengst|Wallach|Hengstfohlen|Stutfohlen|Fohlen)$/i.test(genderLine)) {
    out.gender = genderLine;
  }
  const breedLine = lines[ageIdx + 2];
  if (breedLine) out.breed = breedLine;

  const purebredLine = lines[ageIdx + 3] || '';
  const pm = purebredLine.match(/([\d.,]+)\s*%\s*Reinrassig/i);
  if (pm) out.purebred_pct = parseFloat(pm[1].replace(',', '.'));

  return out;
}

// Extrahiert Tab- (oder Mehrfach-Leerzeichen-) getrennte "Label / Wert"
// Zeilen zwischen einer Start-Überschrift und einer der End-Überschriften.
function extractSimpleTable(lines, startLabel, endLabels) {
  const startIdx = lines.indexOf(startLabel);
  if (startIdx === -1) return [];
  const rows = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (endLabels.includes(line)) break;
    if (!line) continue;
    const parts = line.split(/\t+| {2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      rows.push({ label: parts[0], value: parts[1] });
    } else if (parts.length === 1 && rows.length > 0) {
      // z.B. eine weitere Überschrift ohne Tabellenzeile -> Tabelle beenden
      break;
    }
  }
  return rows;
}

// Die genetische Exterieur-Tabelle hat auf dem Desktop 3 Spalten
// (Körperteil / Genotyp / Punktzahl je Merkmal) und endet mit einer
// Gesamtzeile wie "141/224 62.95%". In der Handy-Ansicht fehlt sowohl die
// Punktzahl-Spalte je Zeile als auch die Gesamtzeile komplett (nur 2
// Spalten: Körperteil / Genotyp) - wird hier mit "score: null" bzw.
// "overall: null" abgefangen, statt die Zeilen zu verwerfen. "Disziplin"
// als zusätzlicher Abbruch, da die Handy-Ansicht direkt dorthin springt
// (ohne die Desktop-only "Leistung"-Zwischenüberschrift).
function parseExteriorGenetics(lines) {
  const startIdx = lines.indexOf('Exterieur');
  if (startIdx === -1) return { rows: [], overall: null };
  const rows = [];
  let overall = null;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const totalMatch = line.match(/^(\d+)\/(\d+)\s+([\d.,]+)\s*%$/);
    if (totalMatch) {
      overall = { score: `${totalMatch[1]}/${totalMatch[2]}`, percent: parseFloat(totalMatch[3].replace(',', '.')) };
      break;
    }
    if (line === 'Leistung' || line === 'Körperbau' || line === 'Disziplin') break;
    const parts = line.split(/\t+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 3) {
      rows.push({ label: parts[0], genotype: parts[1], score: parts[2] });
    } else if (parts.length === 2) {
      rows.push({ label: parts[0], genotype: parts[1], score: null });
    }
  }
  return { rows, overall };
}

// Disziplinen und Eigenschaften bestehen aus Gruppen (z.B. "Western",
// "Grundlagen"): eine Zeile ohne folgende Prozentwerte ist eine Gruppen-
// überschrift, eine Zeile gefolgt von zwei "NN %" Zeilen ist ein Eintrag
// (aktueller Wert / Potenzial). In der Handy-Ansicht wird der aktuelle
// Wert weggelassen, wenn er 0% ist - dann folgt nur ein einzelner
// Prozentwert (das Potenzial), der hier als "current: 0" ergänzt wird.
// "Anstrengung"/"Fitness"/"Erfahrung" (Trainingszustand-Block zwischen der
// trainierten Kategorie und "Alle Disziplinen anzeigen?") sehen wie eine
// Disziplin mit nur einem Wert aus, sind aber keine - werden daher
// ausgeschlossen (dieser Block wird separat in parseTournamentPotential
// ausgewertet).
function extractPercentGroups(lines, startLabel, endLabel) {
  const startIdx = lines.indexOf(startLabel);
  if (startIdx === -1) return {};
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i] === endLabel) {
      endIdx = i;
      break;
    }
  }

  const percentRe = /^\d+(\.\d+)?\s*%$/;
  const RESERVED_NAMES = new Set(['Anstrengung', 'Fitness', 'Erfahrung']);
  const result = {};
  let currentGroup = null;

  for (let i = startIdx + 1; i < endIdx; i++) {
    const line = lines[i];
    if (!line || RESERVED_NAMES.has(line)) continue;
    const p1 = lines[i + 1];
    const p2 = lines[i + 2];
    const bothPercent = p1 && p2 && percentRe.test(p1) && percentRe.test(p2);
    const onlyPotential = !bothPercent && p1 && percentRe.test(p1);
    if (bothPercent) {
      if (!currentGroup) currentGroup = 'Allgemein';
      if (!result[currentGroup]) result[currentGroup] = [];
      result[currentGroup].push({
        name: line,
        current: parseFloat(p1),
        potential: parseFloat(p2),
      });
      i += 2;
    } else if (onlyPotential) {
      if (!currentGroup) currentGroup = 'Allgemein';
      if (!result[currentGroup]) result[currentGroup] = [];
      result[currentGroup].push({
        name: line,
        current: 0,
        potential: parseFloat(p1),
      });
      i += 1;
    } else {
      currentGroup = line;
    }
  }
  return result;
}

function parseTournamentPotential(lines) {
  const startIdx = lines.indexOf('Turnierpotenzial');
  if (startIdx === -1) return {};
  const result = {};
  const knownLabels = ['Begabung', 'Disziplinen', 'Gesamtpotenzial', 'Grundlagen'];
  for (let i = startIdx + 1; i < Math.min(startIdx + 6, lines.length); i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split('\t');
    for (const part of parts) {
      const m = part.match(/^([^:]+):\s*(.+)$/);
      if (m && knownLabels.includes(m[1].trim())) {
        result[m[1].trim()] = m[2].trim();
      }
    }
    if (line === 'Erfahrung' && lines[i + 1] && /%$/.test(lines[i + 1])) {
      result['Erfahrung'] = lines[i + 1];
      break;
    }
  }
  return result;
}

// Der Stammbaum wird im Kopiertext ohne Einrückung/Struktur dargestellt,
// daher lässt sich die genaue Abstammungs-Hierarchie (wer ist Vater/Mutter
// von wem) nicht zuverlässig rekonstruieren. Es wird stattdessen eine
// unsortierte Liste aller im Text vorkommenden Vorfahren gespeichert
// (Name, Rasse, ggf. Potenzial) - in der Reihenfolge, in der sie im Text
// auftauchen.
//
// Die Handy-Ansicht zeigt die Überschrift "Stammbaum" selbst nicht an (nur
// ein Klapp-Icon ohne Text) - "Besitzhistorie" steht aber unmittelbar davor
// und existiert in beiden Ansichten, daher als Fallback-Anker. Ebenso fehlt
// in der Handy-Ansicht die spätere "Exterieur"-Zwischenüberschrift vor
// "Körperbau" - "Körperbau" selbst (der eigentliche Tabellenkopf) dient
// daher als zusätzliches Abbruchkriterium. Außerdem blendet die Handy-
// Ansicht Großeltern/Urgroßeltern über "… anzeigen?"-Zeilen ein und
// beschriftet dabei jede Vorfahren-Gruppe zusätzlich (z.B. "Eltern des
// Vaters", "Eltern der Großmutter väterlicherseits") - diese Zeilen sind
// keine Pferdenamen und werden daher herausgefiltert.
function parsePedigree(lines, ownName) {
  let startIdx = lines.indexOf('Stammbaum');
  if (startIdx === -1) startIdx = lines.indexOf('Besitzhistorie');
  if (startIdx === -1) return [];
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i] === 'Exterieur' || lines[i] === 'Körperbau') {
      endIdx = i;
      break;
    }
  }
  const segment = lines.slice(startIdx + 1, endIdx)
    .filter(Boolean)
    .filter((l) => !/anzeigen\?$/.test(l) && !/^Eltern (des|der) /.test(l));

  const entries = [];
  let current = null;
  for (const line of segment) {
    const potMatch = line.match(/^Potential:\s*(\d+)$/);
    const diffMatch = line.match(/^Diff\.-GP Eltern:/);
    if (potMatch) {
      // "Potential: N" folgt erst NACH Name+Rasse, current wurde also
      // bereits gepusht und zurückgesetzt - daher an den zuletzt
      // hinzugefügten Eintrag hängen, nicht an "current".
      const target = current || entries[entries.length - 1];
      if (target) target.potential = parseInt(potMatch[1], 10);
      continue;
    }
    if (diffMatch) continue;
    if (!current) {
      current = { name: line };
    } else if (!current.breed) {
      current.breed = line;
      entries.push(current);
      current = null;
    }
  }
  // Direkt unter der Überschrift "Stammbaum" wiederholt der Kopiertext noch
  // einmal die eigene Kopfzeile des Pferds (Name, Rasse, Potenzial, "Diff.-GP
  // Eltern"), bevor die echten Vorfahren folgen - ohne diesen Eintrag zu
  // entfernen, würden alle nachfolgenden Positionen um 1 verschoben (aus dem
  // Vater würde fälschlich ein "Vorfahre" des Pferds selbst) und der letzte
  // echte Vorfahre stillschweigend abgeschnitten (nur 14 Plätze insgesamt).
  if (entries.length && ownName && entries[0].name === ownName) {
    entries.shift();
  }
  return entries;
}

// --- Bewertungsskalen für Exterieur (Körperbau) und Interieur (Mentalität) ---
//
// Exterieur folgt einer symmetrischen 9-stufigen Skala um "exzellent" (Mitte)
// herum: exzellent=1, gut=2, passabel=3, "zu X"=4, "viel zu X"=5 (bzw.
// eigene Begriffe wie Speckhals/Hirschhals). Reihenfolge der Prüfung ist
// wichtig: spezifischere/extremere Begriffe zuerst, sonst würde z.B.
// "viel zu klein" schon bei der Prüfung auf "zu klein" (4) hängen bleiben.
// "hoch" wird bei Beugung (z.B. "zu hoher Halsansatz") zu "hoh-" (das
// zweite "c" fällt weg) - "hoh" deckt das zusätzlich zur unveränderten
// Form ab. "eng" fehlte bisher komplett (z.B. "Zu enge Brust"), dadurch
// wurden solche Zeilen von averageScore() stillschweigend übersprungen
// statt als schlechter Wert gezählt - hat den Ext-Durchschnitt künstlich
// zu gut aussehen lassen.
const EXTERIOR_TERM_SCORES = [
  [/viel zu (klein|groß|tief|hoch|hoh|flach|steil|schmal|breit|eng|kurz|lang|weich|hart)/i, 5],
  [/starker (unterbiss|überbiss|senkrücken|karpfenrücken)/i, 5],
  [/speckhals|hirschhals|zeheneng|zehenweit/i, 5],
  [/zu (klein|groß|tief|hoch|hoh|flach|steil|schmal|breit|eng|kurz|lang|weich|hart)/i, 4],
  [/unterbiss|überbiss|senkrücken|karpfenrücken|schwanenhals|dicker hals|bodeneng|bodenweit/i, 4],
  [/passab/i, 3],
  [/exzellent/i, 1],
  [/\bgut/i, 2],
];

// Interieur: Exzellent=1, Gut=2, In Ordnung=3, Schlecht=4, Miserabel=5
// (vom Nutzer vorgegeben).
const TEMPERAMENT_TERM_SCORES = [
  [/exzellent/i, 1],
  [/ordnung/i, 3],
  [/miserabel/i, 5],
  [/schlecht/i, 4],
  [/\bgut/i, 2],
];

function scoreTerm(text, table) {
  if (!text) return null;
  for (const [re, score] of table) {
    if (re.test(text)) return score;
  }
  return null;
}

function scoreExteriorTerm(text) {
  return scoreTerm(text, EXTERIOR_TERM_SCORES);
}

function scoreTemperamentTerm(text) {
  return scoreTerm(text, TEMPERAMENT_TERM_SCORES);
}

// Durchschnitt über eine Liste von {label, value}-Zeilen, anhand einer
// Bewertungsfunktion, die den Textwert in eine Zahl übersetzt. Zeilen, die
// sich keinem bekannten Begriff zuordnen lassen, werden ignoriert.
function averageScore(rows, scoreFn) {
  if (!rows || !rows.length) return null;
  const scores = rows.map((r) => scoreFn(r.value)).filter((s) => s !== null && s !== undefined);
  if (!scores.length) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

// Wandelt einen Bruch-Score wie "10/16" in einen Prozentwert um.
function fractionToPercent(scoreStr) {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(scoreStr || '');
  if (!m) return null;
  return (parseInt(m[1], 10) / parseInt(m[2], 10)) * 100;
}

// Wenn ein Locus nicht getestet ist, lässt sich daraus trotzdem manchmal ein
// Mindestbestand ableiten, wenn die sichtbare Fellfarbe ein eindeutiges
// Merkmal nennt (z.B. "Gold Champagne" -> mindestens ein Ch-Allel, "Roan"
// -> mindestens ein Rn-Allel am KIT-Locus). Nur eindeutige Begriffe werden
// ausgewertet - "Pinto" z.B. bleibt bewusst unberücksichtigt, da es für
// Overo, Splashed, Tobiano oder Sabino stehen kann und sich nicht sicher
// einem einzelnen Gen zuordnen lässt.
//
// Reihenfolge ist wichtig: spezifischere/längere Begriffe zuerst, sonst
// würde z.B. "Gold Bay" (reine Schattierung, KEINE Champagne) fälschlich
// die generische "Gold"-Regel auslösen, und "Varnish Roan" nicht als das
// separate cKit-Gen "Roan" erkannt werden. Jeder Treffer entfernt seinen
// Text aus der Arbeitskopie, daher pro Eintrag ein Array "hints" - so kann
// ein einzelner Treffer (z.B. "Amber") mehrere Gene gleichzeitig auslösen
// (Extension + Agouti + Champagne), ohne dass ein zweiter Eintrag auf
// denselben, bereits entfernten Text angewiesen wäre.
//
// Basisfarbe+Verdünnung-Namen (Amber/Gold/Classic/Sable = Champagne auf
// Bay/Chestnut/Black/Sealbrown, Buckskin/Palomino/Perlino/Cremello/
// Dunskin/Dunalino = Cream-Kombinationen, Grulla/Wildbay/Sealbrown/Bay =
// reine Basisfarbe) folgen der MDR-Farbvererbung, angelehnt an den
// Discord-Bot (discord-bot/src/mdrGenetics.js) - bei Änderungen hier auch
// dort nachziehen (kein gemeinsames Modul zwischen den beiden separaten
// Node-Projekten). WICHTIG, gegen echte Datenbankwerte verifiziert: Bay/
// Sealbrown/Wildbay/Buckskin/Perlino/Dunskin/Amber/Sable/Classic/Brown
// belegen zwar sicher, DASS der Agouti-Locus ein präsentes Allel trägt,
// aber NICHT WELCHES (A1/At/Ap sind je nach Elterntieren austauschbar,
// dieselbe Fellfarbe entsteht mit mehreren Agouti-Genotypen) - daher wird
// hier bewusst KEIN Agouti-Hinweis abgeleitet (nur Extension, das ist
// eindeutig).
const PHENOTYPE_GENE_HINTS = [
  { pattern: /\bgold chestnut\b/i, hints: [], label: 'Gold Chestnut (Schattierung, keine Champagne)' },
  { pattern: /\bgold bay\b/i, hints: [{ locus: 'Extension', allele: 'E' }], label: 'Gold Bay (Schattierung, keine Champagne)' },
  { pattern: /\bgold wildbay\b/i, hints: [{ locus: 'Extension', allele: 'E' }], label: 'Gold Wildbay (Schattierung, keine Champagne)' },
  { pattern: /\bgold dun cream\b/i, hints: [{ locus: 'Dun', allele: 'D' }, { locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'Cr' }], label: 'Gold Dun Cream (Chestnut-Dun-Champagne-Cream)' },
  { pattern: /\bgold dun pearl\b/i, hints: [{ locus: 'Dun', allele: 'D' }, { locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'plpl' }], label: 'Gold Dun Pearl (Chestnut-Dun-Champagne-Pearl)' },
  { pattern: /\bamber dun cream\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'Cr' }], label: 'Amber Dun Cream (Bay-Dun-Champagne-Cream)' },
  { pattern: /\bamber dun pearl\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'plpl' }], label: 'Amber Dun Pearl (Bay-Dun-Champagne-Pearl)' },
  { pattern: /\bsable dun cream\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'Cr' }], label: 'Sable Dun Cream (Sealbrown-Dun-Champagne-Cream)' },
  { pattern: /\bsable dun pearl\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'plpl' }], label: 'Sable Dun Pearl (Sealbrown-Dun-Champagne-Pearl)' },
  { pattern: /\bsealbrown cream dun\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Cream', allele: 'CrCr' }], label: 'Sealbrown Cream Dun (Sealbrown-Dun-doppel-Cream)' },
  { pattern: /\bsealbrown cream champagne\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'CrCr' }], label: 'Sealbrown Cream Champagne (Sealbrown-Champagne-doppel-Cream)' },
  { pattern: /\bclassic dun cream\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'CrCr' }], label: 'Classic Dun Cream (Black-Dun-Champagne-doppel-Cream)' },
  { pattern: /\bclassic dun pearl\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'plpl' }], label: 'Classic Dun Pearl (Black-Dun-Champagne-Pearl)' },
  { pattern: /\bsmoky brown dun\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Cream', allele: 'Cr' }], label: 'Smoky Brown Dun (Sealbrown-Dun-Cream)' },
  { pattern: /\bsmoky cream dun\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Cream', allele: 'CrCr' }], label: 'Smoky Cream Dun (Black-Dun-doppel-Cream)' },
  { pattern: /\bpearl bay dun\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Cream', allele: 'plpl' }], label: 'Pearl Bay Dun (Bay-Dun-Pearl)' },
  { pattern: /\bpearl brown dun\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Cream', allele: 'plpl' }], label: 'Pearl Brown Dun (Sealbrown-Dun-Pearl)' },
  { pattern: /\bpearl black dun\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Cream', allele: 'plpl' }], label: 'Pearl Black Dun (Black-Dun-Pearl)' },
  { pattern: /\bwild dunskin\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Cream', allele: 'Cr' }], label: 'Wild Dunskin (Wildbay-Dun-Cream)' },

  { pattern: /\bsealbrown cream\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Cream', allele: 'CrCr' }], label: 'Sealbrown Cream (Sealbrown-doppel-Cream)' },
  { pattern: /\bsmoky brown\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Cream', allele: 'Cr' }], label: 'Smoky Brown (Sealbrown-Cream)' },
  { pattern: /\bsmoky black\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Cream', allele: 'Cr' }], label: 'Smoky Black (Black-Cream)' },
  { pattern: /\bsmoky cream\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Cream', allele: 'CrCr' }], label: 'Smoky Cream (Black-doppel-Cream)' },
  { pattern: /\bclassic dun\b/i, hints: [{ locus: 'Dun', allele: 'D' }], label: 'Classic Dun (Black-Dun)' },
  { pattern: /\bsmoky grulla\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Cream', allele: 'Cr' }], label: 'Smoky Grulla (Black-Dun-Cream)' },

  { pattern: /\bdunalino\b/i, hints: [{ locus: 'Dun', allele: 'D' }, { locus: 'Cream', allele: 'Cr' }], label: 'Dunalino (Chestnut-Dun-Cream)' },
  { pattern: /\bgold dun\b/i, hints: [{ locus: 'Dun', allele: 'D' }, { locus: 'Champagne', allele: 'Ch' }], label: 'Gold Dun (Chestnut-Dun-Champagne)' },
  { pattern: /\bgold cream\b/i, hints: [{ locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'Cr' }], label: 'Gold Cream (Chestnut-Champagne-Cream)' },
  { pattern: /\bapricot dun\b/i, hints: [{ locus: 'Dun', allele: 'D' }, { locus: 'Cream', allele: 'plpl' }], label: 'Apricot Dun (Chestnut-Dun-Pearl)' },
  { pattern: /\bgold pearl\b/i, hints: [{ locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'plpl' }], label: 'Gold Pearl (Chestnut-Champagne-Pearl)' },
  { pattern: /\bcremello dun\b/i, hints: [{ locus: 'Dun', allele: 'D' }, { locus: 'Cream', allele: 'CrCr' }], label: 'Cremello Dun (Chestnut-Dun-doppel-Cream)' },
  { pattern: /\bcremello champagne\b/i, hints: [{ locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'CrCr' }], label: 'Cremello Champagne (Chestnut-Champagne-doppel-Cream)' },
  { pattern: /\bdunskin\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Cream', allele: 'Cr' }], label: 'Dunskin (Bay-Dun-Cream)' },
  { pattern: /\bamber dun\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Champagne', allele: 'Ch' }], label: 'Amber Dun (Bay-Dun-Champagne)' },
  { pattern: /\bamber cream\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'Cr' }], label: 'Amber Cream (Bay-Champagne-Cream)' },
  { pattern: /\bperlino champagne\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'CrCr' }], label: 'Perlino Champagne (Bay-Champagne-doppel-Cream)' },
  { pattern: /\bsable dun\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }, { locus: 'Champagne', allele: 'Ch' }], label: 'Sable Dun (Sealbrown-Dun-Champagne)' },
  { pattern: /\bsable cream\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'Cr' }], label: 'Sable Cream (Sealbrown-Champagne-Cream)' },
  { pattern: /\bsable pearl\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'plpl' }], label: 'Sable Pearl (Sealbrown-Champagne-Pearl)' },
  { pattern: /\bclassic cream\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'Cr' }], label: 'Classic Cream (Black-Champagne-Cream)' },
  { pattern: /\bclassic pearl\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Champagne', allele: 'Ch' }, { locus: 'Cream', allele: 'plpl' }], label: 'Classic Pearl (Black-Champagne-Pearl)' },

  // Basisfarbe + Verdünnung: diese Namen setzen laut MDR-Farbvererbung
  // Extension zwingend voraus - Agouti bewusst NICHT (siehe Hinweis oben).
  { pattern: /\bgrulla\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Dun', allele: 'D' }], label: 'Grulla (Black-Dun)' },
  { pattern: /\bwildbay\b/i, hints: [{ locus: 'Extension', allele: 'E' }], label: 'Wildbay' },
  { pattern: /\bsealbrown\b|\bbrown\b/i, hints: [{ locus: 'Extension', allele: 'E' }], label: 'Sealbrown/Brown' },
  { pattern: /\bbay\b/i, hints: [{ locus: 'Extension', allele: 'E' }], label: 'Bay' },

  { pattern: /\bpalomino\b/i, hints: [{ locus: 'Cream', allele: 'Cr' }], label: 'Palomino (Chestnut-Cream)' },
  { pattern: /\bcremello\b/i, hints: [{ locus: 'Cream', allele: 'CrCr' }], label: 'Cremello (Chestnut-doppel-Cream)' },
  { pattern: /\bbuckskin\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Cream', allele: 'Cr' }], label: 'Buckskin (Bay-Cream)' },
  { pattern: /\bperlino\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Cream', allele: 'CrCr' }], label: 'Perlino (Bay-doppel-Cream)' },
  { pattern: /\bsmoky\b/i, hints: [{ locus: 'Cream', allele: 'Cr' }], label: 'Smoky' },

  { pattern: /\bsable\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Champagne', allele: 'Ch' }], label: 'Sable (Sealbrown-Champagne)' },
  { pattern: /\bgold\b/i, hints: [{ locus: 'Champagne', allele: 'Ch' }], label: 'Gold (Chestnut-Champagne)' },
  { pattern: /\bamber\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Champagne', allele: 'Ch' }], label: 'Amber (Bay-Champagne)' },
  { pattern: /\bclassic\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Champagne', allele: 'Ch' }], label: 'Classic (Black-Champagne)' },

  { pattern: /varnish roan/i, hints: [{ locus: 'Appaloosa', allele: 'Lp' }], label: 'Varnish Roan' },
  { pattern: /\bchampagne\b/i, hints: [{ locus: 'Champagne', allele: 'Ch' }], label: 'Champagne' },
  { pattern: /\broan\b/i, hints: [{ locus: 'KIT', allele: 'Rn' }], label: 'Roan' },
  { pattern: /\btovero\b/i, hints: [{ locus: 'KIT', allele: 'TO' }, { locus: 'Overo', allele: 'O' }], label: 'Tovero (Tobiano + Overo)' },
  // allele-Schreibweise ("TO"/"SB") passend zu den echten Rohwerten der
  // getesteten Loci gewählt (siehe COLOR_WISH_OPTIONS in js/verpaarung.js),
  // damit getestete und über die Fellfarbe abgeleitete Pferde einheitlich
  // erkannt werden.
  { pattern: /\btobiano\b/i, hints: [{ locus: 'KIT', allele: 'TO' }], label: 'Tobiano' },
  { pattern: /\bsabino\b/i, hints: [{ locus: 'KIT', allele: 'SB' }], label: 'Sabino' },
  { pattern: /\bovero\b/i, hints: [{ locus: 'Overo', allele: 'O' }], label: 'Overo' },
  { pattern: /\bsplashed\b/i, hints: [{ locus: 'Splashed', allele: 'SPL' }], label: 'Splashed White' },
  { pattern: /\bsilver\b/i, hints: [{ locus: 'Extension', allele: 'E' }, { locus: 'Silver', allele: 'Z' }], label: 'Silver' },
  { pattern: /\bdun\b/i, hints: [{ locus: 'Dun', allele: 'D' }], label: 'Dun' },
  { pattern: /\bcream\b/i, hints: [{ locus: 'Cream', allele: 'Cr' }], label: 'Cream' },
  { pattern: /\b(pearl|apricot)\b/i, hints: [{ locus: 'Cream', allele: 'plpl' }], label: 'Pearl' },
  { pattern: /\bgrey\b/i, hints: [{ locus: 'Grey', allele: 'G' }], label: 'Grey' },
  { pattern: /\b(leopard|fewspot|blanket|snowcap|appaloosa)\b/i, hints: [{ locus: 'Appaloosa', allele: 'Lp' }], label: 'Leopard-Musterung' },
  // Flaxen hat keinen eigenen getesteten Locus in der Datenbank - nur als
  // Wort in der Fellfarbe erkennbar, wenn sichtbar (siehe COLOR_WISH_OPTIONS
  // in js/verpaarung.js für die Einschränkung, die daraus folgt). Sichtbar
  // heißt reinerbig (zwei Kopien) - daher "flfl", nicht nur "fl" (das
  // steht für eine einzelne, unsichtbare Trägerschaft-Kopie).
  { pattern: /\bflaxen\b/i, hints: [{ locus: 'Flaxen', allele: 'flfl' }], label: 'Flaxen' },
];

// Anzeige-Reihenfolge (Grundfarbe/Aufhellungen/Sonderfarben/Scheckungen/
// Flaxen) - rein kosmetisch, damit abgeleitete Gene nicht in zufälliger
// Trefferreihenfolge zwischen den getesteten Loci auftauchen.
const GENE_DISPLAY_ORDER = [
  'Extension', 'Agouti', 'Cream', 'Dun', 'Champagne', 'Silver', 'Grey',
  'KIT', 'Overo', 'Splashed', 'Appaloosa', 'PATN1', 'Flaxen',
];
function sortGenesForDisplay(genes) {
  return [...genes].sort((a, b) => {
    const ai = GENE_DISPLAY_ORDER.indexOf(a.locus);
    const bi = GENE_DISPLAY_ORDER.indexOf(b.locus);
    return (ai === -1 ? GENE_DISPLAY_ORDER.length : ai) - (bi === -1 ? GENE_DISPLAY_ORDER.length : bi);
  });
}

// Gibt eine Liste { locus, allele, label } aller aus dem Fellfarbe-Namen
// eindeutig ableitbaren Merkmale zurück. Bereits erkannte Textstellen
// werden aus der Arbeitskopie entfernt, damit z.B. "Varnish Roan" nicht
// zusätzlich das separate "Roan"-Muster auslöst.
function inferGeneticHintsFromPhenotype(coatColorName) {
  if (!coatColorName) return [];
  let working = coatColorName;
  const hints = [];
  for (const { pattern, hints: entryHints, label } of PHENOTYPE_GENE_HINTS) {
    if (pattern.test(working)) {
      for (const h of entryHints) hints.push({ locus: h.locus, allele: h.allele, label });
      working = working.replace(pattern, ' ');
    }
  }
  return hints;
}

function isUntestedLocusValue(value) {
  return /nicht getestet/i.test(value || '');
}

// Zerlegt einen Locus-Rohwert (zwei gleich lange Allel-Tokens) und behält
// nur die "vorhandenen" Allele: großgeschrieben = vorhanden, klein = nicht
// vorhanden. Ausnahme: "pl" (Pearl) gilt immer als vorhanden, obwohl es
// klein geschrieben ist - es ist kein rezessives Gegenstück zu einem
// Großbuchstaben, sondern das eigentliche Allel-Kürzel selbst. Nicht zu
// verwechseln mit "lp" (Appaloosa/Leopard), das weiterhin als "nicht
// vorhanden" gilt, wenn es klein geschrieben ist.
function extractPresentAlleles(rawValue) {
  if (!rawValue || isUntestedLocusValue(rawValue)) return '';
  const half = rawValue.length / 2;
  const tokens = Number.isInteger(half) ? [rawValue.slice(0, half), rawValue.slice(half)] : [rawValue];
  return tokens.filter((t) => t === 'pl' || /[A-Z]/.test(t)).join('');
}

// Fasst alle tatsächlich vorhandenen Gene eines Pferdes zusammen: zuerst
// aus getesteten Loci (siehe extractPresentAlleles), dann - nur für Loci,
// die nicht getestet wurden - aus Hinweisen im Fellfarbe-Namen, in der
// Notiz UND im Anzeigenamen (siehe inferGeneticHintsFromPhenotype) -
// manche Pferde tragen einen Farbhinweis nur im Namen, nicht im separaten
// Fellfarbe-Feld.
function presentGenesSummary(colorRows, coatColorName, notes, horseName) {
  const rows = colorRows || [];
  const confirmed = [];
  const testedLoci = new Set();

  for (const r of rows) {
    if (isUntestedLocusValue(r.value)) continue;
    testedLoci.add(r.label);
    const alleles = extractPresentAlleles(r.value);
    if (alleles) confirmed.push({ locus: r.label, alleles, source: 'getestet' });
  }

  const hints = [
    ...inferGeneticHintsFromPhenotype(coatColorName),
    ...inferGeneticHintsFromPhenotype(notes),
    ...inferGeneticHintsFromPhenotype(horseName),
  ];
  const seen = new Set();
  const inferred = [];
  for (const h of hints) {
    if (testedLoci.has(h.locus)) continue;
    const key = h.locus + h.allele;
    if (seen.has(key)) continue;
    seen.add(key);
    inferred.push({ locus: h.locus, alleles: h.allele, source: 'abgeleitet' });
  }

  return sortGenesForDisplay([...confirmed, ...inferred]);
}

// Schlagwörter (horses.tags), 1:1 aus MDR-Datenbank/js/parser.js portiert,
// damit dieselben Labels/Farben wie dort verwendet werden (dort gepflegt,
// hier nur lesend zur Anzeige gebraucht - MDR-Planer legt selbst keine
// Schlagwörter an, siehe js/tagSuggest.js für den separaten
// Vorschlags-Mechanismus).
const HORSE_TAG_OPTIONS = [
  { label: 'Verkauf', color: 'var(--danger)' },
  { label: 'Reserviert', color: 'var(--warning)' },
  { label: 'Bleibt', color: 'var(--success)' },
  { label: 'Zuchttier', color: 'var(--tag-blue)' },
  { label: 'GBH', color: 'var(--tag-purple)' },
];

function tagColor(label) {
  return HORSE_TAG_OPTIONS.find((t) => t.label === label)?.color || 'var(--muted)';
}

// Rendert die zugewiesenen Schlagwörter eines Pferds als farbige Badges -
// "escapeHtml" wird erst beim tatsächlichen Aufruf gebraucht (nicht beim
// Laden von parser.js selbst) und ist dann bereits durch das jeweilige
// Seiten-Skript global definiert.
function tagsBadgesHtml(tags) {
  return (tags || []).map((tag) => {
    const text = tag.note ? `${tag.label}: ${tag.note}` : tag.label;
    return `<span class="horse-tag-badge" style="background:${tagColor(tag.label)}">${escapeHtml(text)}</span>`;
  }).join('');
}

// Geburtsdatum (horses.birthdate, "JJJJ-MM-TT") -> Alter in vollen
// Spieljahren (abgerundet), 1:1 aus MDR-Datenbank/js/parser.js portiert -
// im Spiel entsprechen 30 reale Tage einem Spieljahr, nicht die reale
// Kalenderzeit. Referenzdatum ist immer "heute", das Alter wird also bei
// jedem Aufruf neu berechnet statt gespeichert. Gibt null zurück, wenn
// kein/ein ungültiges Datum vorliegt.
const REAL_DAYS_PER_GAME_YEAR = 30;
function gameAgeDays(birthdateIso) {
  if (!birthdateIso) return null;
  const birth = new Date(birthdateIso);
  if (Number.isNaN(birth.getTime())) return null;
  const daysSinceBirth = Math.floor((Date.now() - birth.getTime()) / 86400000);
  return daysSinceBirth < 0 ? null : daysSinceBirth;
}
function gameAgeYears(birthdateIso) {
  const days = gameAgeDays(birthdateIso);
  return days == null ? null : Math.floor(days / REAL_DAYS_PER_GAME_YEAR);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseHorseText, HORSE_TAG_OPTIONS, tagColor, tagsBadgesHtml, gameAgeYears };
}
