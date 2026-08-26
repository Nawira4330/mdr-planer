// Genetik-Engine für den "Verpaarungsratgeber" (Zuchtplaner, Tab 2).
//
// Alle Formeln wurden anhand echter Pferdedaten hergeleitet und verifiziert
// (siehe Kommentare je Funktion). Benötigt js/parser.js (scoreExteriorTerm,
// scoreTemperamentTerm, presentGenesSummary, PHENOTYPE_GENE_HINTS),
// js/breeding.js (findSharedNames, hasOveroGene) und js/tournamentScoring.js
// (flattenTraitPotentials, findDisciplineCategory) - muss also nach diesen
// Scripts eingebunden werden.

// --- Exterieur: Zygotie & Fehler/Punkte je Locus ---
//
// Jeder Genotyp-String hat das Format "T1 T2 T3 T4 | T5 T6 T7 T8" (8 Loci,
// durch "|" in "vorne" (1-4) und "hinten" (5-8) geteilt). Zygotie je Locus
// = Anzahl der Großbuchstaben "H" im Token (0=hh, 1=Hh/hH, 2=HH).
//
// Verifiziert anhand eines echten Pferdes (Pawnbarian): der aus dem
// Genotyp berechnete Fehler-Score (0-4, siehe unten) stimmt für alle 14
// Körperbau-Merkmale exakt mit dem geparsten Beschreibungstext überein
// (z.B. Genotyp "hH hh hh HH | hh hh hH hh" -> Fehler 2 -> "Passabel",
// deckt sich mit "Passabler Kopf" im Spieltext).
function parseExteriorLocus(token) {
  return (token.match(/H/g) || []).length;
}

function parseExteriorTokens(genotype) {
  if (!genotype) return null;
  const tokens = genotype.split(/\s+/).map((t) => t.trim()).filter((t) => t && t !== '|');
  if (tokens.length !== 8) return null;
  return tokens;
}

// Für einen einzelnen Locus (vorne ODER hinten) das best-/schlechtmöglichste
// Ergebnis beim Fohlen aus den Eltern-Zygotien herleiten (unabhängige
// Mendel-Segregation: ein Elter mit Zygotie 2 gibt immer H, mit Zygotie 0
// immer h, mit Zygotie 1 kann beides geben).
function achievableFoalZygosity(zA, zB) {
  // Meistmögliche H-Zahl beim Fohlen (0-2): jeder Elter gibt H, falls er
  // kann (Zygotie >= 1).
  const maxZ = (zA >= 1 ? 1 : 0) + (zB >= 1 ? 1 : 0);
  // Wenigstmögliche H-Zahl beim Fohlen (0-2): H wird nur erzwungen, wenn
  // ein Elter homozygot ist (Zygotie 2).
  const minZ = (zA === 2 ? 1 : 0) + (zB === 2 ? 1 : 0);
  return { maxZ, minZ };
}

// Best-/Worst-Case für ein einzelnes Körperbau-Merkmal (14 Vorkommen je
// Pferd): Fehler (0-4, dann +1 auf die 1-5-Skala wie EXTERIOR_TERM_SCORES)
// UND die Rohpunktzahl (0-16, wie die "X/16"-Anzeige im Spiel) in einem
// Durchgang. Vorne will Zygotie >= 1 (H vorhanden), hinten will Zygotie = 0
// (hh) - siehe Plan/Nutzer-Vorgabe.
function exteriorBestWorstForTrait(mareGenotype, stallionGenotype) {
  const mareTokens = parseExteriorTokens(mareGenotype);
  const stallionTokens = parseExteriorTokens(stallionGenotype);
  if (!mareTokens || !stallionTokens) return null;

  let frontFehlerBest = 0, frontFehlerWorst = 0;
  let backFehlerBest = 0, backFehlerWorst = 0;
  let pointsBest = 0, pointsWorst = 0;

  for (let i = 0; i < 8; i++) {
    const zA = parseExteriorLocus(mareTokens[i]);
    const zB = parseExteriorLocus(stallionTokens[i]);
    const { maxZ, minZ } = achievableFoalZygosity(zA, zB);

    if (i < 4) {
      // vorne: Punkt = erreichte H-Zahl (mehr = besser)
      pointsBest += maxZ;
      pointsWorst += minZ;
      if (maxZ === 0) frontFehlerBest++;
      if (minZ === 0) frontFehlerWorst++;
    } else {
      // hinten: Punkt = 2 - erreichte H-Zahl (weniger H = besser)
      pointsBest += 2 - minZ;
      pointsWorst += 2 - maxZ;
      if (minZ > 0) backFehlerBest++;
      if (maxZ > 0) backFehlerWorst++;
    }
  }

  const fehlerBest = Math.max(frontFehlerBest, backFehlerBest);
  const fehlerWorst = Math.max(frontFehlerWorst, backFehlerWorst);
  return {
    scoreBest: fehlerBest + 1,
    scoreWorst: fehlerWorst + 1,
    pointsBest,
    pointsWorst,
  };
}

// Aggregiert über alle Körperbau-Merkmale (Zuordnung per Label, damit
// Reihenfolgeunterschiede zwischen Stute/Hengst keine Rolle spielen).
// extBest/extWorst: Durchschnitt der 1-5-Skala (niedriger = besser, wie
// extAvg an anderer Stelle der Seite). extPctBest/extPctWorst: Summe aller
// Rohpunkte / (Merkmalsanzahl * 16) - exakt dieselbe Formel wie das
// existierende "overall.percent" (verifiziert: 141/224 = 62.95% beim
// Beispielpferd).
function exteriorFoalRange(mare, stallion) {
  const mareRows = mare?.exterior_genetics?.rows || [];
  const stallionByLabel = new Map((stallion?.exterior_genetics?.rows || []).map((r) => [r.label, r]));

  const scoresBest = [], scoresWorst = [];
  let pointsBestSum = 0, pointsWorstSum = 0, maxPoints = 0;

  for (const mareRow of mareRows) {
    const stallionRow = stallionByLabel.get(mareRow.label);
    if (!stallionRow) continue;
    const result = exteriorBestWorstForTrait(mareRow.genotype, stallionRow.genotype);
    if (!result) continue;
    scoresBest.push(result.scoreBest);
    scoresWorst.push(result.scoreWorst);
    pointsBestSum += result.pointsBest;
    pointsWorstSum += result.pointsWorst;
    maxPoints += 16;
  }

  if (!scoresBest.length) return { extBest: null, extWorst: null, extPctBest: null, extPctWorst: null };

  return {
    extBest: scoresBest.reduce((a, b) => a + b, 0) / scoresBest.length,
    extWorst: scoresWorst.reduce((a, b) => a + b, 0) / scoresWorst.length,
    extPctBest: (pointsBestSum / maxPoints) * 100,
    extPctWorst: (pointsWorstSum / maxPoints) * 100,
  };
}

// --- Genort-Ausgleich (Exterieur-Komplementarität) ---
//
// extBest/extPctBest sind rechnerisch nachweisbar eine reine SUMME der
// jeweils EIGENEN Zygotie-Beiträge von Stute und Hengst (kein Schwellenwert,
// keine echte Wechselwirkung) - pointsBest pro Genort vorne = mareContrib +
// stallionContrib, hinten = (1-mareRed) + (1-stallionRed). Für EINE feste
// Stute ist ihr Anteil an dieser Summe für jeden Hengst-Kandidaten exakt
// derselbe konstante Wert - er verschiebt also nur das Gesamtniveau, ändert
// aber NIE die Rangfolge der Hengste untereinander (mathematisch bewiesen,
// mit echten Datenbank-Paaren gegengeprüft: "Vorhersage minus Eigenwert der
// Stute" ergab exakt dieselbe Reihenfolge wie "Bester Best Case"). Dadurch
// gewinnt bei "Bester Best Case"/"Bester Worst Case"/"Beste Datenbank-
// Schätzung" für Ext/Ext% praktisch immer derselbe, individuell stärkste
// Hengst - unabhängig davon, welche Stute gewählt wurde.
//
// Dieser Score misst gezielt, wie viele der eigenen "Problem-Genorte"
// DIESER STUTE (Positionen, an denen sie allein das bestmögliche Ergebnis
// nicht garantieren kann) von GENAU DIESEM Hengst tatsächlich gerettet
// werden ("Fix"-Stufe), UND zusätzlich, wie viele ihrer bereits
// halbwegs sicheren Genorte durch den Hengst NICHT zu einer neuen
// Schwäche werden ("Support"-Stufe, Nutzerwunsch 2026-08-26 - gilt analog
// auch für GP/Ext, siehe gpComplementarityScore/extComplementarityScore) -
// dieselbe Zygotie-Logik wie exteriorBestWorstForTrait, nur pro Genort
// statt als Summe ausgewertet, damit die Stute die Rangfolge tatsächlich
// beeinflusst:
// - Vorne (Genort 1-4, braucht H im Fohlen):
//   - Fix: "Problem" der Stute, wenn sie selbst kein H geben kann (zA=0) -
//     "gerettet", wenn der Hengst H beisteuert (rettet den Best Case).
//     Innerhalb der Rettungen zusätzlich bevorzugt (Nutzerwunsch
//     2026-08-26, dritte Stufe "savedFixFull" unterhalb von Fix, oberhalb
//     von Support): ein homozygoter Hengst (zB=2) sichert an dieser
//     Stelle zusätzlich auch den Worst Case ab, ein nur heterozygoter
//     Hengst (zB=1) rettet lediglich den Best Case - bei gleich vielen
//     geretteten Schwächen gewinnt der Hengst mit mehr davon vollständig
//     (HH) abgesichert.
//   - Support: bei zA=1 (Stute heterozygot, hat H, aber nicht garantiert)
//     ist der Worst Case OHNE Zutun des Hengstes weiterhin 0xH möglich
//     (dieselbe minZ-Formel wie bei achievableFoalZygosity) - "gehalten"
//     nur, wenn der Hengst selbst homozygot ist (zB=2) und damit im Worst
//     Case mindestens 1x H erzwingt. Bei zA=2 besteht kein Risiko (die
//     Stute allein garantiert bereits den Worst Case) - nicht gezählt.
// - Hinten (Genort 5-8, braucht hh im Fohlen): unrettbar, wenn die Stute
//   selbst bereits HH ist (zA=2, kein Hengst kann das ausgleichen) - dann
//   nicht gezählt. Anders als vorne ist "hh" ein UND (beide Eltern müssen
//   mitziehen), kein ODER - eine Stute mit zA=0 (ihre STÄRKE, selbst
//   sicher hh) garantiert den Worst Case damit NICHT automatisch:
//   - Fix: bei zA=1 (Stute selbst heterozygot, für sie bereits ein
//     eigenes Problem) ist der Worst Case unabhängig vom Hengst IMMER
//     verschlechtert (maxZ enthält ihren eigenen Beitrag schon garantiert)
//     - "gerettet" bezieht sich hier wie bisher nur auf den Best Case
//     (zB !== 2). Innerhalb der Rettungen zählt zusätzlich zu savedFixFull
//     (Nutzerwunsch 2026-08-26 - "hinten hh ODER vorne HH" als feine
//     Rangstufe), wenn der Hengst komplett frei von H ist (zB=0) - dasselbe
//     Prinzip wie vorne, nur gespiegelt (hinten will hh statt H).
//   - Support (Nutzerwunsch 2026-08-26 - Stärken der Stute schützen):
//     bei zA=0 (Stute selbst ideal) hängt der Worst Case allein vom
//     Hengst ab (maxZ = 1, falls der Hengst irgendein H hat) - "gehalten"
//     nur, wenn der Hengst selbst komplett frei von H ist (zB=0). Bringt
//     der Hengst auch nur 1x H mit (zB=1), entsteht am eigentlich
//     sicheren Genort der Stute eine neue Schwäche im Fohlen.
// "atStake" (wie viele Genorte die Stute überhaupt zu bieten hat) ist für
// alle Hengst-Kandidaten derselbe Wert, "saved" variiert echt je Hengst -
// die Rangfolge nach "saved"/"weighted" ist damit tatsächlich
// stutenspezifisch. "weighted" gewichtet dreistufig (Reihenfolge Nutzer-
// wunsch 2026-08-26): jede gerettete Problemstelle (Fix) schlägt jede
// Anzahl gehaltener Support-Genorte, die wiederum jede Anzahl vollständig
// abgesicherter Rettungen schlägt (feinster Tiebreak, siehe "hinten hh
// ODER vorne HH" oben) - Fix vs. Support analog zur Gewichtung bei
// Ext/Int, "vollständig abgesichert" kommt bewusst erst danach.
//
// Kein vom Spiel selbst angezeigter Wert, sondern eine zusätzliche
// Heuristik auf Basis derselben verifizierten Zygotie-Mechanik.
function exteriorComplementarityScore(mare, stallion) {
  const mareRows = mare?.exterior_genetics?.rows || [];
  const stallionByLabel = new Map((stallion?.exterior_genetics?.rows || []).map((r) => [r.label, r]));

  let atStakeFix = 0, savedFix = 0, savedFixFull = 0;
  let atStakeSupport = 0, savedSupport = 0;

  for (const mareRow of mareRows) {
    const stallionRow = stallionByLabel.get(mareRow.label);
    if (!stallionRow) continue;
    const mareTokens = parseExteriorTokens(mareRow.genotype);
    const stallionTokens = parseExteriorTokens(stallionRow.genotype);
    if (!mareTokens || !stallionTokens) continue;

    for (let i = 0; i < 8; i++) {
      const zA = parseExteriorLocus(mareTokens[i]);
      const zB = parseExteriorLocus(stallionTokens[i]);
      if (i < 4) {
        if (zA === 0) {
          atStakeFix++;
          if (zB >= 1) { savedFix++; if (zB === 2) savedFixFull++; }
        } else if (zA === 1) {
          atStakeSupport++;
          if (zB === 2) savedSupport++;
        }
      } else if (zA === 1) {
        atStakeFix++;
        if (zB !== 2) { savedFix++; if (zB === 0) savedFixFull++; }
      } else if (zA === 0) {
        atStakeSupport++;
        if (zB === 0) savedSupport++;
      }
    }
  }

  return {
    atStake: atStakeFix + atStakeSupport,
    saved: savedFix + savedSupport,
    weighted: savedFix * 1000000 + savedSupport * 10000 + savedFixFull,
  };
}

// Eigene Kategorie (1-5, wie EXTERIOR_TERM_SCORES/exterior_descriptive)
// EINES Pferds für EIN Merkmal, direkt aus seinem eigenen Genotyp
// abgeleitet - dieselbe Fehler-Zählung wie exteriorBestWorstForTrait,
// aber deterministisch für ein bereits bestehendes Pferd statt als
// Best-/Worst-Case-Spanne für ein hypothetisches Fohlen: ihre Zygotie
// steht schon fest, es gibt keine Unsicherheit. Vorne (Genort 1-4)
// zählt als Fehler, wenn sie selbst kein H hat (zA=0), hinten (Genort
// 5-8), wenn sie selbst mindestens 1x H hat (zA>=1).
function ownExteriorTraitScore(tokens) {
  let frontFehler = 0, backFehler = 0;
  for (let i = 0; i < 8; i++) {
    const z = parseExteriorLocus(tokens[i]);
    if (i < 4) { if (z === 0) frontFehler++; }
    else if (z >= 1) { backFehler++; }
  }
  return Math.max(frontFehler, backFehler) + 1;
}

// Ext-Ausgleich (auf Nutzerwunsch): anders als exteriorComplementarityScore
// (behandelt alle Problem-Genorte gleich) unterscheidet dieser Score nach
// der EIGENEN Ext-Kategorie der Stute je Merkmal (siehe
// ownExteriorTraitScore, direkt aus denselben Genort-Daten wie Ext%
// berechnet) in zwei Prioritätsstufen:
// 1. Priorität ("ausgleichen"): Merkmale mit eigener Kategorie 3/4/5 (In
//    Ordnung/Schlecht/Miserabel bzw. "zu X"/"viel zu X") - dieselbe
//    Genort-Rettung wie exteriorComplementarityScore (vorne: Hengst
//    bringt H; hinten: Hengst bringt kein HH).
// 2. Priorität ("unterstützen"): Merkmale mit eigener Kategorie 1 oder 2
//    (Exzellent/Gut) - bereits gute Genorte sollen nicht verschlechtert
//    werden. Anders als in der Fix-Stufe reicht dafür vorne (Genort 1-4)
//    NICHT dieselbe Rettungs-Bedingung (Hengst hat mind. 1x H) - das
//    sichert nur den Best Case, nicht den Worst Case (siehe
//    achievableFoalZygosity: bei Stute zA=1 bleibt der Worst Case ohne
//    Zutun des Hengstes weiterhin 0xH möglich). Korrigiert (Nutzerwunsch
//    2026-08-26, galt vorher fälschlich als bereits korrekt): nur bei
//    zA=1 überhaupt ein Risiko (bei zA=2 garantiert die Stute den Worst
//    Case bereits allein, kein Genort "at stake"), gehalten nur bei
//    homozygotem Hengst (zB=2), der im Worst Case mind. 1x H erzwingt.
//    Hinten (Genort 5-8): dieselbe Korrektur wie bei
//    exteriorComplementarityScore - "hh" ist ein UND (beide Eltern müssen
//    mitziehen), die alte Bedingung (zB !== 2) für zA=0 (Stute selbst
//    ideal) sicherte nur den Best Case. Jetzt: zA=1 (Stutes eigenes
//    Problem, in beiden Stufen wie gehabt best-case-gerettet durch
//    zB !== 2) getrennt von zA=0 (Stutes eigene Stärke, jetzt worst-case-
//    sicher nur bei zB === 0, sonst neue Schwäche durchs Fohlen).
// "weighted" (nicht "saved") bestimmt die Sortierung (siehe sortKey) -
// jede ausgeglichene Problemstelle (Prio 1) schlägt dabei immer jede
// Anzahl unterstützter guter Genorte (Prio 2), analog zu
// intComplementarityScore. Erst danach (Prio 3, feinster Tiebreak,
// Reihenfolge Nutzerwunsch 2026-08-26) zählt "vollständig abgesichert" -
// "hinten hh ODER vorne HH": vorne rettet ein nur heterozygoter Hengst
// (zB=1) zwar den Best Case, aber nicht den Worst Case, ein homozygoter
// (zB=2) beides; hinten spiegelbildlich ein Hengst mit zB=1 nur den Best
// Case, ein komplett H-freier (zB=0) beides.
function extComplementarityScore(mare, stallion) {
  const mareRows = mare?.exterior_genetics?.rows || [];
  const stallionByLabel = new Map((stallion?.exterior_genetics?.rows || []).map((r) => [r.label, r]));

  let atStakeFix = 0, savedFix = 0, savedFixFull = 0;
  let atStakeSupport = 0, savedSupport = 0;

  for (const mareRow of mareRows) {
    const stallionRow = stallionByLabel.get(mareRow.label);
    if (!stallionRow) continue;
    const mareTokens = parseExteriorTokens(mareRow.genotype);
    const stallionTokens = parseExteriorTokens(stallionRow.genotype);
    if (!mareTokens || !stallionTokens) continue;

    const isFixTier = ownExteriorTraitScore(mareTokens) >= 3;

    for (let i = 0; i < 8; i++) {
      const zA = parseExteriorLocus(mareTokens[i]);
      const zB = parseExteriorLocus(stallionTokens[i]);
      if (i < 4) {
        if (isFixTier) {
          if (zA === 0) { atStakeFix++; if (zB >= 1) { savedFix++; if (zB === 2) savedFixFull++; } }
        } else if (zA === 1) {
          atStakeSupport++;
          if (zB === 2) savedSupport++;
        }
      } else if (isFixTier) {
        if (zA === 1) { atStakeFix++; if (zB !== 2) { savedFix++; if (zB === 0) savedFixFull++; } }
      } else if (zA === 1) {
        atStakeSupport++;
        if (zB !== 2) savedSupport++;
      } else if (zA === 0) {
        atStakeSupport++;
        if (zB === 0) savedSupport++;
      }
    }
  }

  return {
    atStake: atStakeFix + atStakeSupport,
    saved: savedFix + savedSupport,
    weighted: savedFix * 1000000 + savedSupport * 10000 + savedFixFull,
  };
}

// --- Interieur: nur Phänotyp-Kategorie bekannt (kein Gencode) ---
//
// Kategorie -> Bandbreite "Anzahl hh-Loci von 8" (Komplement der
// H-Präsenz-Bandbreite Exzellent=8H, Gut=6-7H, In Ordnung=4-5H,
// Schlecht=4, Miserabel=5). Best-/Worst-Case je Elternpaar direkt aus
// zwei Tabellen. Ursprünglich (Best = "floor((lo+hi)/2)", Worst = feste
// Tabelle) mit dem Nutzer abgestimmt, aber gegen echte Eltern-Fohlen-Trios
// aus foal_reference_data verifiziert (2026-08-24, 251 Trios/~2500
// Merkmals-Beobachtungen, inkl. gelöschter Pferde) - dabei lag der
// tatsächliche Wert bei "1-3"/"2-2"/"2-3"/"2-4"/"3-3" in 15-40% der Fälle
// UNTER dem alten "Best"-Wert (z.B. bei "2-2" 160 von 1033 Beobachtungen:
// beide Eltern "Gut", Fohlen trotzdem "Exzellent") - reine Mittelwert-
// Rundung war dort zu pessimistisch. Ebenso lag der Wert bei "1-1"/"1-2"/
// "1-3"/"2-2" selten (0.2-1.9%) leicht ÜBER dem alten "Worst"-Wert. Beide
// Tabellen unten je Zelle auf den tatsächlich beobachteten Extremwert
// gesetzt (BEST_CASE_TABLE-Einträge ohne Beobachtung fehlen bewusst - dort
// gilt weiterhin "floor((lo+hi)/2)", siehe interieurBestWorstForTrait).
// Für Zellen ganz ohne Beobachtungen in den Trios (1-5/2-5/3-5/4-4/4-5/5-5)
// bleibt WORST_CASE_TABLE unverändert (weiterhin nur die ursprüngliche,
// mit dem Nutzer abgestimmte Schätzung, nicht empirisch geprüft).
//
// Wichtiger Vorbehalt (Nutzer-Hinweis 2026-08-24): wirklich schlecht
// ausgefallene Fohlen werden von Spielern erfahrungsgemäß oft gar nicht
// erst in die Datenbank eingetragen - foal_reference_data ist also nicht
// unverzerrt, sondern tendenziell zu positiv ("Survivorship Bias"). Die
// BEST_CASE-Anhebungen oben bleiben davon unberührt gültig/eher konservativ
// (bessere Ergebnisse werden vermutlich eher vollständig erfasst als
// schlechtere, die Beobachtung "Fohlen besser als bisheriger Best-Case"
// ist also glaubwürdig). Die 100%-Containment für WORST_CASE (0 von 251
// Verletzungen) ist dagegen NICHT als Beweis zu verstehen, dass das echte
// Worst-Case-Minimum nie unterschritten wird - eher als aktuell bester,
// aber möglicherweise noch zu optimistischer Anhaltspunkt aus den
// tatsächlich eingetragenen Daten.
const INTERIEUR_BEST_CASE_TABLE = {
  '1-3': 1, '2-2': 1, '2-3': 1, '2-4': 2, '3-3': 2,
};
const INTERIEUR_WORST_CASE_TABLE = {
  '1-1': 3, '1-2': 4, '1-3': 4, '1-4': 4, '1-5': 5,
  '2-2': 4, '2-3': 4, '2-4': 4, '2-5': 5,
  '3-3': 4, '3-4': 4, '3-5': 5,
  '4-4': 5, '4-5': 5,
  '5-5': 5,
};

function interieurBestWorstForTrait(scoreA, scoreB) {
  const lo = Math.min(scoreA, scoreB);
  const hi = Math.max(scoreA, scoreB);
  const key = `${lo}-${hi}`;
  return {
    best: key in INTERIEUR_BEST_CASE_TABLE ? INTERIEUR_BEST_CASE_TABLE[key] : Math.floor((lo + hi) / 2),
    worst: INTERIEUR_WORST_CASE_TABLE[key],
  };
}

function interieurFoalRange(mare, stallion) {
  const mareRows = mare?.temperament || [];
  const stallionByLabel = new Map((stallion?.temperament || []).map((r) => [r.label, r]));

  const bestScores = [], worstScores = [];

  for (const mareRow of mareRows) {
    const stallionRow = stallionByLabel.get(mareRow.label);
    if (!stallionRow) continue;
    const scoreA = scoreTemperamentTerm(mareRow.value);
    const scoreB = scoreTemperamentTerm(stallionRow.value);
    if (scoreA == null || scoreB == null) continue;

    const { best, worst } = interieurBestWorstForTrait(scoreA, scoreB);
    bestScores.push(best);
    worstScores.push(worst);
  }

  if (!bestScores.length) return { intBest: null, intWorst: null };
  return {
    intBest: bestScores.reduce((a, b) => a + b, 0) / bestScores.length,
    intWorst: worstScores.reduce((a, b) => a + b, 0) / worstScores.length,
  };
}

// Interieur-Best-Case ist bereits ein Mittelwert (nicht max/Summe wie GP)
// und dadurch schon von Natur aus stutenspezifisch (empirisch bestätigt:
// bei 8 echten Stuten 5 verschiedene Gewinner) - dieser Score ergänzt es
// trotzdem um dieselbe "Problem/gerettet"-Darstellung wie bei GP/Ext%, für
// eine einheitliche Anzeige über alle Schwerpunkte hinweg.
//
// Bewusst NICHT (mehr) relativ zum eigenen Durchschnitt der Stute, sondern
// nach absoluter Kategorie in drei Prioritätsstufen gewichtet (auf
// Nutzerwunsch):
// 1. Priorität (höchstes Gewicht): "In Ordnung"/"Schlecht"/"Miserabel"
//    (Score 3-5) - echte Problemstellen, sollen möglichst stark
//    ausgeglichen werden. "Gerettet" zählt, wenn der Hengst dort einen
//    ECHT besseren (niedrigeren) Wert einbringt.
// 2. Priorität: "Exzellent" (Score 1) - lässt sich nicht mehr verbessern,
//    soll aber unterstützt/gehalten werden. "Gerettet" zählt, wenn der
//    Hengst dort ebenfalls exzellent ist (sonst würde der Fohlen-
//    Durchschnitt dort wieder absacken).
// 3. Priorität (niedrigstes Gewicht): "Gut" (Score 2) - dieselbe Logik wie
//    Priorität 2, nur mit weniger Gewicht in der Sortierung.
// "weighted" (nicht "saved") bestimmt die Sortierung (siehe sortKey) -
// dadurch schlägt jede einzelne ausgeglichene Problemstelle (Prio 1) IMMER
// jede beliebige Kombination aus Prio 2+3, unabhängig von deren Anzahl.
// "atStake"/"saved" bleiben die reinen (ungewichteten) Summen aller drei
// Stufen für die "X von Y ausgeglichen"-Anzeige.
function intComplementarityScore(mare, stallion) {
  const stallionByLabel = new Map((stallion?.temperament || []).map((r) => [r.label, r]));
  const scores = (mare?.temperament || [])
    .map((r) => ({ label: r.label, score: scoreTemperamentTerm(r.value) }))
    .filter((r) => r.score != null);
  if (!scores.length) return { atStake: 0, saved: 0, weighted: 0 };

  let atStakeProblem = 0, savedProblem = 0;
  let atStakeExzellent = 0, savedExzellent = 0;
  let atStakeGut = 0, savedGut = 0;

  for (const { label, score: a } of scores) {
    const stallionRow = stallionByLabel.get(label);
    const b = stallionRow ? scoreTemperamentTerm(stallionRow.value) : null;
    if (b == null) continue;

    if (a >= 3) {
      atStakeProblem++;
      if (b < a) savedProblem++;
    } else if (a === 1) {
      atStakeExzellent++;
      if (b === 1) savedExzellent++;
    } else {
      atStakeGut++;
      if (b <= 2) savedGut++;
    }
  }

  return {
    atStake: atStakeProblem + atStakeExzellent + atStakeGut,
    saved: savedProblem + savedExzellent + savedGut,
    weighted: savedProblem * 10000 + savedExzellent * 100 + savedGut,
  };
}

// --- GP (Gesamtpotenzial) ---
//
// Anhand zweier echter Pferde (und erneut bestätigt an "Pawnbarian":
// Grundlagen 229 = Summe der 8 Grundlagen-Potenziale (156) + Summe der 4
// Gangarten-Potenziale des Normal-Satzes (73); Disziplinen 105 = Summe der
// 4 Disziplin-Potenziale der Begabungskategorie "Western"; Gesamtpotenzial
// 334 = 229 + 105) zu 100% verifiziert: GP = Σ(8 Grundlagen) + Σ(4
// relevante Gangarten) + Σ(4 Disziplinen der Begabungskategorie).
const GP_GRUNDLAGEN_NAMES = ['Wendigkeit', 'Gelassenheit', 'Kraft', 'Tempo', 'Beschleunigung', 'Kondition', 'Präzision', 'Ausdruck'];
const GP_NORMAL_GANGARTEN = ['Schritt', 'Trab', 'Galopp', 'Renngalopp'];
const GP_MEHRGANG_GANGARTEN = ['Tölt', 'Pass', 'Foxtrott', 'Rack'];

function sumBestWorst(names, mapA, mapB) {
  let best = 0, worst = 0, complete = true;
  for (const name of names) {
    const a = mapA[name], b = mapB[name];
    if (a == null || b == null) { complete = false; continue; }
    best += Math.max(a, b);
    worst += Math.min(a, b);
  }
  return { best, worst, complete };
}

// Die Begabungskategorie des Fohlens ist nicht vorhersagbar - daher werden
// beide Eltern-Kategorien als Kandidat durchgerechnet (meist identisch)
// und die günstigste/ungünstigste Kombination als Best-/Worst-Case
// genommen. Rohdaten (profile.traits/profile.disciplines) sind exakt die,
// die auch computeTournamentValues/checkLP verwenden - keine neue Formel.
function estimateFoalGP(mare, stallion) {
  if (!mare?.traits || !stallion?.traits || !mare?.disciplines || !stallion?.disciplines) {
    return { gpBest: null, gpWorst: null };
  }
  const mareTraitMap = flattenTraitPotentials(mare.traits);
  const stallionTraitMap = flattenTraitPotentials(stallion.traits);
  const grundlagen = sumBestWorst(GP_GRUNDLAGEN_NAMES, mareTraitMap, stallionTraitMap);
  if (!grundlagen.complete) return { gpBest: null, gpWorst: null };

  const mareCategory = findDisciplineCategory(mare.disciplines, mare.tournament_potential?.['Begabung']);
  const stallionCategory = findDisciplineCategory(stallion.disciplines, stallion.tournament_potential?.['Begabung']);
  const candidates = [...new Set([mareCategory, stallionCategory].filter(Boolean))];
  if (!candidates.length) return { gpBest: null, gpWorst: null };

  let gpBest = null, gpWorst = null;
  for (const category of candidates) {
    const gangartNames = category === 'Mehrgang' ? GP_MEHRGANG_GANGARTEN : GP_NORMAL_GANGARTEN;
    const gangarten = sumBestWorst(gangartNames, mareTraitMap, stallionTraitMap);
    if (!gangarten.complete) continue;

    const discNames = (mare.disciplines[category] || stallion.disciplines[category] || []).map((e) => e.name);
    const mareDiscMap = Object.fromEntries((mare.disciplines[category] || []).map((e) => [e.name, e.potential]));
    const stallionDiscMap = Object.fromEntries((stallion.disciplines[category] || []).map((e) => [e.name, e.potential]));
    const disziplinen = sumBestWorst(discNames, mareDiscMap, stallionDiscMap);
    if (!disziplinen.complete) continue;

    const candidateBest = grundlagen.best + gangarten.best + disziplinen.best;
    const candidateWorst = grundlagen.worst + gangarten.worst + disziplinen.worst;
    if (gpBest == null || candidateBest > gpBest) gpBest = candidateBest;
    if (gpWorst == null || candidateWorst < gpWorst) gpWorst = candidateWorst;
  }
  return { gpBest, gpWorst };
}

// "Bester Best Case" für GP wählt bei jeder Stute fast immer denselben,
// objektiv stärksten Hengst (sumBestWorst nimmt pro Eigenschaft
// max(Stute, Hengst) - hat ein Hengst in fast allen Eigenschaften höhere
// Werte als praktisch jede Stute im Pool, gewinnt er unabhängig von der
// gewählten Stute; empirisch bestätigt: bei 8 echten Stuten 8x derselbe
// Hengst). Analog zu exteriorComplementarityScore/extComplementarityScore
// zählt dieser Score zwei Stufen (Nutzerwunsch 2026-08-26 - die
// "Support"-Stufe fehlte hier ursprünglich komplett):
// - Fix: EIGENE unterdurchschnittliche Werte der Stute (Grundlagen/
//   Gangarten/Disziplinen ihrer eigenen Begabungskategorie, a < avg) -
//   "gerettet", wenn der Hengst-Wert höher ist (b > a, gewinnt also den
//   max() in der Best-Case-Summe).
// - Support: bereits durchschnittliche/überdurchschnittliche Werte der
//   Stute (a >= avg) - "gehalten", wenn der Hengst dort NICHT schwächer
//   ist als die Stute (b >= a) - sonst zieht der Hengst den Worst Case
//   (min(a,b) in sumBestWorst) unter das bisherige Stuten-Niveau und
//   erzeugt an dieser Stelle eine neue Schwäche, die es vorher nicht gab.
function gpComplementarityScore(mare, stallion) {
  const mareTraitMap = flattenTraitPotentials(mare?.traits);
  const stallionTraitMap = flattenTraitPotentials(stallion?.traits);
  let atStakeFix = 0, savedFix = 0;
  let atStakeSupport = 0, savedSupport = 0;

  const countGroup = (names, mapA, mapB) => {
    const values = names.map((n) => mapA[n]).filter((v) => v != null);
    if (!values.length) return;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    for (const name of names) {
      const a = mapA[name], b = mapB[name];
      if (a == null || b == null) continue;
      if (a < avg) {
        atStakeFix++;
        if (b > a) savedFix++;
      } else {
        atStakeSupport++;
        if (b >= a) savedSupport++;
      }
    }
  };

  countGroup(GP_GRUNDLAGEN_NAMES, mareTraitMap, stallionTraitMap);

  const mareCategory = findDisciplineCategory(mare?.disciplines, mare?.tournament_potential?.['Begabung']);
  if (mareCategory) {
    const gangartNames = mareCategory === 'Mehrgang' ? GP_MEHRGANG_GANGARTEN : GP_NORMAL_GANGARTEN;
    countGroup(gangartNames, mareTraitMap, stallionTraitMap);

    const mareDiscMap = Object.fromEntries((mare.disciplines[mareCategory] || []).map((e) => [e.name, e.potential]));
    const stallionDiscMap = Object.fromEntries((stallion?.disciplines?.[mareCategory] || []).map((e) => [e.name, e.potential]));
    countGroup(Object.keys(mareDiscMap), mareDiscMap, stallionDiscMap);
  }

  return {
    atStake: atStakeFix + atStakeSupport,
    saved: savedFix + savedSupport,
    weighted: savedFix * 10000 + savedSupport,
  };
}

// --- Datenbank-Schätzung (3. Version, neben Best-/Worst-Case) ---
//
// Best-/Worst-Case sind theoretische Extreme - selten das tatsächliche
// Ergebnis. Als dritte, realistischere Einschätzung wird der
// Eltern-Mittelwert um die tatsächlich in der Datenbank beobachtete
// Durchschnitts-Abweichung echter Fohlen von ihrem eigenen
// Eltern-Mittelwert korrigiert. Wird bei jedem Laden live aus dem
// aktuellen Datenbestand neu berechnet (keine feste Zahl im Code) -
// mit steigender Anzahl eingetragener Fohlen wird die Schätzung von
// selbst genauer. Anhand einer echten Abfrage (298 Pferde, Stand der
// Herleitung) wurden 28 Eltern-Fohlen-Trios gefunden (23 mit Ext%-
// Daten) - genug für eine einfache additive Korrektur, aber zu wenig
// für ein komplexeres Modell (würde überanpassen).
function horseGP(h) {
  const v = h?.tournament_potential?.['Gesamtpotenzial'];
  return v != null && v !== '' ? Number(v) : null;
}
function horseExt(h) {
  return averageScore(h?.exterior_descriptive, scoreExteriorTerm);
}
function horseExtPct(h) {
  return h?.exterior_genetics?.overall?.percent ?? null;
}
function horseInt(h) {
  return averageScore(h?.temperament, scoreTemperamentTerm);
}

const EMPIRICAL_METRICS = { gp: horseGP, ext: horseExt, extPct: horseExtPct, int: horseInt };

// Ein Pferd mit einem bekannten, von Null verschiedenen Inzuchtkoeffizienten
// (COI/"ico") ist selbst schon durch Inzucht beeinflusst - als Trainingsdatum
// (egal ob als Fohlen oder als Elternteil) würde es die Durchschnitts-
// Abweichung verfälschen und wird daher komplett ausgeschlossen.
function hasKnownCoi(horse) {
  return horse?.ico != null && horse.ico !== 0;
}

// Baut aus allen geladenen Pferden die echten Eltern-Fohlen-Trios (beide
// Eltern UND das Fohlen selbst als eigener Datensatz vorhanden, per Name
// aufgelöst wie überall sonst in diesem Modul) und liefert je Metrik die
// durchschnittliche Abweichung des Fohlens vom Eltern-Mittelwert.
function computeEmpiricalDeviations(allHorses) {
  const cleanHorses = (allHorses || []).filter((h) => !hasKnownCoi(h));

  const byName = new Map();
  for (const h of cleanHorses) {
    const key = normalizeName(h.name);
    if (key && !byName.has(key)) byName.set(key, h);
  }

  const diffs = { gp: [], ext: [], extPct: [], int: [] };
  for (const child of cleanHorses) {
    const anc = pedigreeAncestorNames(child);
    const fatherName = anc[0] && normalizeName(anc[0]) !== 'unbekannt' ? anc[0] : null;
    const motherName = anc[1] && normalizeName(anc[1]) !== 'unbekannt' ? anc[1] : null;
    if (!fatherName || !motherName) continue;
    const father = byName.get(normalizeName(fatherName));
    const mother = byName.get(normalizeName(motherName));
    if (!father || !mother) continue;

    // GP eines Rasselosen Fohlens ist nur dann nicht mit den Eltern
    // vergleichbar, wenn Vater und Mutter unterschiedliche Hauptdisziplinen
    // haben (welche Kategorie das Fohlen "erbt", ist dann nicht vorhersagbar)
    // - Ext/Ext%/Int sind davon nicht betroffen.
    const fatherCategory = findDisciplineCategory(father.disciplines, father.tournament_potential?.['Begabung']);
    const motherCategory = findDisciplineCategory(mother.disciplines, mother.tournament_potential?.['Begabung']);
    const skipGpForRasselos = child.breed === 'Rasselos'
      && fatherCategory && motherCategory && fatherCategory !== motherCategory;

    for (const [metric, getValue] of Object.entries(EMPIRICAL_METRICS)) {
      if (metric === 'gp' && skipGpForRasselos) continue;
      const childVal = getValue(child);
      const fatherVal = getValue(father);
      const motherVal = getValue(mother);
      if (childVal == null || fatherVal == null || motherVal == null) continue;
      diffs[metric].push(childVal - (fatherVal + motherVal) / 2);
    }
  }

  const result = {};
  for (const metric of Object.keys(EMPIRICAL_METRICS)) {
    const values = diffs[metric];
    result[metric] = {
      n: values.length,
      meanDiff: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    };
  }
  return result;
}

// Eltern-Mittelwert der zwei ausgewählten Pferde + die passende
// Durchschnitts-Abweichung aus computeEmpiricalDeviations. Liefert je
// Metrik null, wenn einem Elternteil der Wert fehlt oder keine
// Eltern-Fohlen-Trios für diese Metrik gefunden wurden (n=0). GP wird nicht
// geschätzt, wenn mindestens ein Elternteil Rasselos ist UND Stute/Hengst
// unterschiedliche Hauptdisziplinen haben (siehe computeEmpiricalDeviations
// - dieselbe Regel wie beim Aufbau der Trainingsdaten).
function estimateFoalEmpirical(mare, stallion, deviations) {
  const result = {};
  const eitherRasselos = mare?.breed === 'Rasselos' || stallion?.breed === 'Rasselos';
  const mareCategory = findDisciplineCategory(mare?.disciplines, mare?.tournament_potential?.['Begabung']);
  const stallionCategory = findDisciplineCategory(stallion?.disciplines, stallion?.tournament_potential?.['Begabung']);
  const skipGpForRasselos = eitherRasselos && mareCategory && stallionCategory && mareCategory !== stallionCategory;
  for (const [metric, getValue] of Object.entries(EMPIRICAL_METRICS)) {
    const a = getValue(mare);
    const b = getValue(stallion);
    const dev = deviations?.[metric];
    if ((metric === 'gp' && skipGpForRasselos) || a == null || b == null || !dev || !dev.n) {
      result[metric] = null;
    } else {
      result[metric] = (a + b) / 2 + dev.meanDiff;
    }
  }
  return result;
}

// --- Farbwünsche ---

// Pearl (pl) sitzt am selben Locus wie Cream und ist in der Datenbank ein
// echter, oft getesteter Wert ("crpl" = 1 Kopie, "plpl" = 2 Kopien) - daher
// zusätzlich mit "homozygousOnly" als eigene Option für "reinerbig" (plpl).
// Flaxen (fl) hat dagegen KEINEN eigenen getesteten Genort in der
// Datenbank (698 Pferde geprüft: kein "Flaxen"-Eintrag in colors, keine
// Erwähnung in notes) - es taucht nur als Wort in der Fellfarbe auf, wenn
// es sichtbar ist (= reinerbig, wie im echten Pferde-Vorbild). Eine
// unsichtbare Trägerschaft lässt sich trotzdem indirekt erkennen, wenn ein
// ELTERNTEIL sichtbar Flaxen ist (siehe hasFlaxenTrait) - das Pferd selbst
// muss dann mindestens eine rezessive fl-Kopie geerbt haben, auch wenn es
// selbst nicht sichtbar Flaxen ist.
const COLOR_WISH_OPTIONS = [
  { label: 'Overo', locus: 'Overo', allele: 'O' },
  // Tobiano/Sabino: Groß-/Kleinschreibung MUSS exakt der Rohdaten aus der
  // DB entsprechen ("TO"/"SB", komplett großgeschrieben) - anders als
  // Roan ("Rn", gemischt). extractPresentAlleles() (js/parser.js) behält
  // das Roh-Token unverändert bei, der Abgleich per .includes() ist
  // case-sensitiv. Mit den ursprünglich falschen 'To'/'Sb' schlug der
  // Filter bei JEDEM genetisch getesteten Pferd fehl (nur bei
  // ungetesteten, über den Fellfarbe-Namen erkannten Pferden - siehe
  // PHENOTYPE_GENE_HINTS in js/parser.js - funktionierte er zufällig).
  { label: 'Tobiano', locus: 'KIT', allele: 'TO' },
  { label: 'Sabino', locus: 'KIT', allele: 'SB' },
  { label: 'Roan', locus: 'KIT', allele: 'Rn' },
  { label: 'Champagne', locus: 'Champagne', allele: 'Ch' },
  { label: 'Dun', locus: 'Dun', allele: 'D' },
  { label: 'Cream', locus: 'Cream', allele: 'Cr' },
  { label: 'Pearl (pl)', locus: 'Cream', allele: 'pl' },
  { label: 'Pearl reinerbig (plpl)', locus: 'Cream', allele: 'pl', homozygousOnly: true },
  { label: 'Grey', locus: 'Grey', allele: 'G' },
  { label: 'Silver', locus: 'Silver', allele: 'Z' },
  { label: 'Splashed', locus: 'Splashed', allele: 'SPL' },
  { label: 'Leopard/Appaloosa', locus: 'Appaloosa', allele: 'Lp' },
  { label: 'Flaxen (sichtbar)', locus: 'Flaxen', allele: 'fl' },
  { label: 'Flaxen-Träger (auch über Elternteil)', locus: 'Flaxen', allele: 'fl', viaParent: true },
];

function isVisiblyFlaxen(horse) {
  return /\bflaxen\b/i.test(horse?.coat_color || '');
}

// Flaxen-Trägerschaft: sichtbar am Pferd selbst ODER (da es keinen eigenen
// getesteten Genort gibt) indirekt über zwei Signale, beide nur eine
// Generation weit - NICHT weiter (Großeltern etc.), weil dort keine
// Gewissheit mehr besteht:
// 1. Eltern - ist Vater ODER Mutter selbst sichtbar Flaxen (= reinerbig
//    fl/fl), geben sie zu 100% eine fl-Kopie weiter - das Pferd MUSS
//    mindestens eine rezessive Kopie geerbt haben, ganz gleich wie das
//    zweite Allel aussieht. Bewusst NICHT auf Großeltern/Urgroßeltern
//    ausgeweitet: ist z.B. nur der Urgroßvater sichtbar Flaxen, ist seine
//    fl-Kopie beim eigenen Kind bereits nur noch zu 50% vorhanden (Fl/fl,
//    da dessen zweiter Elternteil sie mit hoher Wahrscheinlichkeit nicht
//    trägt) und vererbt sich von dort nur noch zufällig weiter (bei
//    Urgroßeltern nur noch ~12,5%-Wahrscheinlichkeit) - keine Gewissheit
//    mehr, würde also fälschlich Nicht-Träger als Träger einstufen.
// 2. Nachkommen - ist ein BEKANNTES eigenes Fohlen sichtbar Flaxen, MUSS
//    dieses Pferd zwingend selbst Träger sein (genetisch bewiesen bei
//    einem rezessiven Merkmal: für ein sichtbares Fohlen müssen BEIDE
//    Eltern mindestens eine Kopie beisteuern) - unabhängig davon, ob die
//    eigenen Vorfahren des Pferds überhaupt in der Datenbank stehen. In
//    der Praxis oft der wirksamere der beiden Wege: viele Stammbäume
//    verweisen auf Namen, die nie als eigener Datensatz erfasst wurden
//    (externe/importierte Pferde), wodurch Weg 1 oft ins Leere läuft,
//    auch wenn eine Trägerschaft tatsächlich vorliegt.
// byNameMap: Map<normalisierter Name, Pferd mit coat_color> aus einem
// möglichst breiten Bestand (siehe flaxenLookup in js/zuchtplaner.js).
// childrenByParentName: Map<normalisierter Name, Pferd[]> - Reverse-Index
// aus demselben Bestand (siehe flaxenChildrenByName in js/zuchtplaner.js).
function hasFlaxenTrait(horse, byNameMap, childrenByParentName) {
  if (isVisiblyFlaxen(horse)) return true;
  if (byNameMap) {
    const anc = pedigreeAncestorNames(horse);
    for (const name of [anc[0], anc[1]]) {
      if (!name || normalizeName(name) === 'unbekannt') continue;
      const parent = byNameMap.get(normalizeName(name));
      if (parent && isVisiblyFlaxen(parent)) return true;
    }
  }
  if (childrenByParentName) {
    const children = childrenByParentName.get(normalizeName(horse.name)) || [];
    if (children.some((c) => isVisiblyFlaxen(c))) return true;
  }
  return false;
}

// Prüft NUR den Kandidaten (nicht auch das fest gewählte Pferd) - kein
// vollständiges Dominant-/rezessiv-Modell je Locus. Ausnahmen:
// "homozygousOnly" zählt exakte 2-Zeichen-Allel-Token (z.B. "plpl" -> 2x
// "pl"), statt nur "kommt mindestens einmal vor" zu prüfen - nötig, um
// Pearl (1 Kopie reicht) von Pearl reinerbig (2 Kopien nötig) zu
// unterscheiden. "locus === 'Flaxen'" nutzt hasFlaxenTrait statt
// presentGenesSummary, da Flaxen keinen eigenen Locus hat.
//
// War ursprünglich "Stute ODER Hengst hat das Gen" (genetisch korrekt,
// da das Fohlen es von jedem Elternteil erben kann) - das machte den
// Filter aber zum Blindgänger, sobald das fest gewählte Pferd das Merkmal
// selbst schon trägt: dann bestanden ALLE Kandidaten die Prüfung, auch
// die ganz ohne das Merkmal (Nutzer-Feedback: bei einer Flaxen-Träger-
// Stute wurden 111 von 116 Hengsten angezeigt, obwohl nur 5 davon
// tatsächlich Träger waren). Auf Nutzerwunsch geändert auf "nur der
// Kandidat selbst trägt es" - eindeutig, nie wirkungslos.
//
// Wichtig: über ALLE Einträge mit passendem Locus prüfen (nicht nur den
// ersten per find()) - bei ungetesteten Loci liefert
// inferGeneticHintsFromPhenotype() für jedes erkannte Merkmal einen
// EIGENEN Eintrag (z.B. "Chestnut Roan Sabino" -> je ein KIT-Eintrag für
// Roan UND für Sabino statt eines zusammengeführten). Mit find() wurde
// bisher nur der zuerst gefundene Eintrag geprüft - z.B. "Roan" bei einem
// Pferd mit "Roan Sabino"-Fellfarbe traf dadurch IMMER zu, unabhängig vom
// tatsächlich gesuchten Merkmal, und machte den Filter effektiv wirkungslos.
function colorWishPossible(candidate, wish, flaxenLookup, flaxenChildrenByName) {
  if (wish.locus === 'Flaxen') {
    return wish.viaParent ? hasFlaxenTrait(candidate, flaxenLookup, flaxenChildrenByName) : isVisiblyFlaxen(candidate);
  }
  const genes = presentGenesSummary(candidate.colors, candidate.coat_color, candidate.notes, candidate.name, candidate.color_gene_overrides);
  const entries = genes.filter((g) => g.locus === wish.locus);
  if (!entries.length) return false;
  if (!wish.homozygousOnly) return entries.some((e) => e.alleles.includes(wish.allele));
  return entries.some((e) => {
    const tokens = e.alleles.match(/../g) || [];
    return tokens.filter((t) => t === wish.allele).length >= 2;
  });
}

// --- Ranking ---

// Von 10 auf 20 erhöht (Nutzerwunsch "mehr Hengstvarianten") - mehr
// Auswahl auf einen Blick, ohne die Ausschluss-/Sortierlogik selbst zu
// ändern.
const RANK_RESULT_COUNT = 20;

// Höher = besser für GP/Ext%, niedriger = besser für Ext/Int (1=exzellent
// ... 5=miserabel-Skala) - siehe Plan.
const SCHWERPUNKT_HIGHER_IS_BETTER = { gp: true, ext: false, extpct: true, int: false };
const SCHWERPUNKT_BEST_FIELD = { gp: 'gpBest', ext: 'extBest', extpct: 'extPctBest', int: 'intBest' };
const SCHWERPUNKT_WORST_FIELD = { gp: 'gpWorst', ext: 'extWorst', extpct: 'extPctWorst', int: 'intWorst' };
// Schwerpunkt-Schlüssel ("extpct") -> Metrik-Schlüssel in EMPIRICAL_METRICS
// bzw. im Rückgabewert von estimateFoalEmpirical ("extPct").
const SCHWERPUNKT_EMPIRICAL_METRIC = { gp: 'gp', ext: 'ext', extpct: 'extPct', int: 'int' };

// Sortierung ist unabhängig vom Schwerpunkt wählbar:
// - "best"/"worst": der jeweilige Fohlen-Wert (Best-/Worst-Case) des
//   gewählten Schwerpunkts, in dessen eigener Richtung (höher/niedriger =
//   besser je nach Schwerpunkt).
// - "empirical": die Datenbank-Schätzung des gewählten Schwerpunkts, in
//   derselben Richtung wie best/worst - Kandidaten ohne Schätzung (z.B.
//   fehlende Trios oder GP bei Rasselos, siehe estimateFoalEmpirical)
//   landen wie überall sonst am Ende der Liste.
// - "complement": schwerpunktabhängige Komplementarität - wie viele der
//   EIGENEN Problemstellen des Ausgangspferds (Ext%: Genorte, GP:
//   unterdurchschnittliche Grundlagen/Gangarten/Disziplinen, Int:
//   unterdurchschnittliche Eigenschaften) der Kandidat tatsächlich
//   ausgleicht (siehe exteriorComplementarityScore/
//   gpComplementarityScore/intComplementarityScore) - im Gegensatz zu
//   "best"/"worst"/"empirical" bei GP/Ext% wirklich stutenspezifisch statt
//   praktisch immer derselbe Kandidat (siehe Kommentare dort).
// - "diff-asc"/"diff-desc": Abstand zwischen Best- und Worst-Case
//   (unabhängig von der Richtung) - klein = verlässliches Ergebnis, groß =
//   große Schwankungsbreite (Risiko/Chance).
function sortKey(candidate, schwerpunkt, sortMode) {
  if (sortMode === 'empirical') {
    const metric = SCHWERPUNKT_EMPIRICAL_METRIC[schwerpunkt] || 'gp';
    return candidate.emp ? candidate.emp[metric] : null;
  }
  if (sortMode === 'complement') {
    if (!candidate.complement) return null;
    // "weighted" gibt es nur bei Int/Ext (Prioritätsstufen, siehe
    // intComplementarityScore/extComplementarityScore) - bei Ext%/GP ist
    // "saved" bereits der richtige Sortierwert.
    return candidate.complement.weighted ?? candidate.complement.saved;
  }
  if (sortMode === 'combo') {
    return candidate.comboScore;
  }

  const bestField = SCHWERPUNKT_BEST_FIELD[schwerpunkt] || 'gpBest';
  const worstField = SCHWERPUNKT_WORST_FIELD[schwerpunkt] || 'gpWorst';
  const best = candidate[bestField];
  const worst = candidate[worstField];

  if (sortMode === 'diff-asc' || sortMode === 'diff-desc') {
    if (best == null || worst == null) return null;
    return Math.abs(best - worst);
  }
  return sortMode === 'worst' ? worst : best;
}

// Wählt die passende Komplementaritäts-Funktion für einen Schwerpunkt-
// Schlüssel - gemeinsam genutzt vom 1. Kriterium (schwerpunkt) und, bei
// sortMode "combo", vom 2. Kriterium (comboSecond).
function complementScoreFor(schwerpunktKey, mare, stallion) {
  if (schwerpunktKey === 'gp') return gpComplementarityScore(mare, stallion);
  if (schwerpunktKey === 'int') return intComplementarityScore(mare, stallion);
  if (schwerpunktKey === 'ext') return extComplementarityScore(mare, stallion);
  return exteriorComplementarityScore(mare, stallion); // 'extpct' (Default)
}

// Prozentsatz "ausgeglichen" (0-100) aus einem Komplementaritäts-Ergebnis -
// gemeinsame Normierung, um zwei UNTERSCHIEDLICHE Metriken (z.B. GP mit
// ~16 Grundlagen/Gangarten/Disziplinen vs. Ext% mit ~70-90 Genorten)
// überhaupt vergleichbar zu machen (siehe sortMode "combo"). Kein
// "atStake" (0) heißt: keine Problemstellen vorhanden, also bereits
// perfekt -> 100%, nicht 0%.
function complementPercent(c) {
  if (!c || !c.atStake) return 100;
  return (c.saved / c.atStake) * 100;
}

// Harte Ausschlüsse zuerst (Inzucht, doppeltes Overo, nicht erfüllbare
// Farbwünsche), danach Sortierung nach dem gewählten Schwerpunkt +
// Sortiermodus, Top 20 (RANK_RESULT_COUNT).
function rankStallions(mare, stallions, {
  schwerpunkt, farbwuensche, sortMode, empiricalDeviations, flaxenLookup, flaxenChildrenByName,
  comboSecond, comboWeight,
}) {
  const mareHasOvero = hasOveroGene(mare);
  const wishes = (farbwuensche || []).map((label) => COLOR_WISH_OPTIONS.find((o) => o.label === label)).filter(Boolean);

  const candidates = stallions.filter((stallion) => {
    if (findSharedNames(mare, stallion).length > 0) return false;
    if (mareHasOvero && hasOveroGene(stallion)) return false;
    if (wishes.length && !wishes.every((wish) => colorWishPossible(stallion, wish, flaxenLookup, flaxenChildrenByName))) return false;
    return true;
  });

  // "combo" (Nutzerwunsch): kombiniert IMMER genau 2 Kriterien - Schwerpunkt
  // (1. Kriterium) + comboSecond (2. Kriterium), individuell gewichtet
  // über comboWeight (0-100, Anteil des 1. Kriteriums; Rest zählt für das
  // 2.). Jedes Kriterium wird zuerst einzeln auf 0-100% normiert (siehe
  // complementPercent), erst DANACH gewichtet gemischt - so bleiben
  // beliebige Metrik-Kombinationen vergleichbar, auch wenn ihre
  // "atStake"-Größenordnungen stark unterschiedlich sind.
  const isCombo = sortMode === 'combo' && comboSecond;
  const weightA = isCombo ? Math.min(100, Math.max(0, comboWeight ?? 50)) : 50;

  const scored = candidates.map((stallion) => {
    const ext = exteriorFoalRange(mare, stallion);
    const int = interieurFoalRange(mare, stallion);
    const gp = estimateFoalGP(mare, stallion);
    const emp = empiricalDeviations ? estimateFoalEmpirical(mare, stallion, empiricalDeviations) : null;
    const complement = complementScoreFor(schwerpunkt, mare, stallion);
    let comboComplement = null;
    let comboScore = null;
    if (isCombo) {
      comboComplement = complementScoreFor(comboSecond, mare, stallion);
      comboScore = (complementPercent(complement) * weightA + complementPercent(comboComplement) * (100 - weightA)) / 100;
    }
    return { stallion, ...ext, ...int, ...gp, emp, complement, comboComplement, comboScore };
  });

  const mode = sortMode || 'best';
  // Bei "diff": größere Differenz zuerst bei diff-desc, kleinere zuerst bei
  // diff-asc. Bei "complement"/"combo": mehr gerettete Problem-Genorte
  // bzw. höherer kombinierter Prozentsatz zuerst (immer "höher = besser",
  // unabhängig vom Schwerpunkt). Bei "best"/"worst"/"empirical": Richtung
  // folgt dem Schwerpunkt selbst (z.B. bei Int ist niedriger immer besser,
  // ob Best- oder Worst-Case).
  const ascending = mode === 'diff-asc'
    ? true
    : mode === 'diff-desc' || mode === 'complement' || mode === 'combo'
      ? false
      : SCHWERPUNKT_HIGHER_IS_BETTER[schwerpunkt] === false;

  scored.sort((a, b) => {
    const va = sortKey(a, schwerpunkt, mode);
    const vb = sortKey(b, schwerpunkt, mode);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return ascending ? va - vb : vb - va;
  });

  return { total: stallions.length, candidateCount: candidates.length, top: scored.slice(0, RANK_RESULT_COUNT) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseExteriorLocus, exteriorBestWorstForTrait, exteriorFoalRange,
    exteriorComplementarityScore, extComplementarityScore, gpComplementarityScore, intComplementarityScore,
    interieurBestWorstForTrait, interieurFoalRange, estimateFoalGP,
    horseGP, horseExt, horseExtPct, horseInt,
    computeEmpiricalDeviations, estimateFoalEmpirical,
    COLOR_WISH_OPTIONS, colorWishPossible, rankStallions,
    isVisiblyFlaxen, hasFlaxenTrait,
  };
}
