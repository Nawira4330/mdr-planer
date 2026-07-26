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
// Dieser Score misst stattdessen gezielt, wie viele der eigenen "Problem-
// Genorte" DIESER STUTE (Positionen, an denen sie allein das bestmögliche
// Ergebnis nicht garantieren kann) von GENAU DIESEM Hengst tatsächlich
// gerettet bzw. nicht verschlechtert werden - dieselbe Zygotie-Logik wie
// exteriorBestWorstForTrait (vorne: mind. 1x H nötig; hinten: kein HH
// erlaubt), nur pro Genort statt als Summe ausgewertet, damit die Stute die
// Rangfolge tatsächlich beeinflusst:
// - Vorne (Genort 1-4, braucht H): "Problem" der Stute, wenn sie selbst
//   kein H geben kann (zA=0) - "gerettet", wenn der Hengst H beisteuert.
// - Hinten (Genort 5-8, braucht hh): unrettbar, wenn die Stute selbst
//   bereits HH ist (zA=2, kein Hengst kann das ausgleichen) - sonst zählt
//   der Genort, wenn der Hengst SELBST nicht HH beisteuert ("nicht
//   verschlechtert").
// "atStake" (wie viele Problem-Genorte die Stute überhaupt hat) ist für
// alle Hengst-Kandidaten derselbe Wert, "saved" variiert echt je Hengst -
// die Rangfolge nach "saved" ist damit tatsächlich stutenspezifisch.
//
// Kein vom Spiel selbst angezeigter Wert, sondern eine zusätzliche
// Heuristik auf Basis derselben verifizierten Zygotie-Mechanik.
function exteriorComplementarityScore(mare, stallion) {
  const mareRows = mare?.exterior_genetics?.rows || [];
  const stallionByLabel = new Map((stallion?.exterior_genetics?.rows || []).map((r) => [r.label, r]));

  let atStake = 0;
  let saved = 0;

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
          atStake++;
          if (zB >= 1) saved++;
        }
      } else if (zA !== 2) {
        atStake++;
        if (zB !== 2) saved++;
      }
    }
  }

  return { atStake, saved };
}

// --- Interieur: nur Phänotyp-Kategorie bekannt (kein Gencode) ---
//
// Kategorie -> Bandbreite "Anzahl hh-Loci von 8" (Komplement der
// H-Präsenz-Bandbreite Exzellent=8H, Gut=6-7H, In Ordnung=4-5H,
// Schlecht=4, Miserabel=5). Best-/Worst-Case je Elternpaar direkt aus
// einer Tabelle (mit dem Nutzer abgestimmt): schlechte Werte des einen
// Elters werden vom guten Partner tendenziell ausgeglichen, gute/exzellente
// Werte werden unterstützt. Ausgangspunkt sind immer die Eltern-Werte
// selbst - sie verbessern sich im besten Fall bzw. verschlechtern sich im
// schlechtesten Fall um 1-2 Punkte (oder bleiben gleich), nie darüber
// hinaus. Bei gleichen Eltern-Werten (z.B. 3+3) gilt dasselbe Muster wie
// bei den vom Nutzer vorgegebenen Fällen 1+1 und 2+2: Best Case bleibt
// gleich, Worst Case verschlechtert sich um 1 (bei 5+5 an der Skala
// gedeckelt).
const INTERIEUR_WORST_CASE_TABLE = {
  '1-1': 2, '1-2': 3, '1-3': 3, '1-4': 4, '1-5': 5,
  '2-2': 3, '2-3': 4, '2-4': 4, '2-5': 5,
  '3-3': 4, '3-4': 4, '3-5': 5,
  '4-4': 5, '4-5': 5,
  '5-5': 5,
};

function interieurBestWorstForTrait(scoreA, scoreB) {
  const lo = Math.min(scoreA, scoreB);
  const hi = Math.max(scoreA, scoreB);
  return {
    best: Math.floor((lo + hi) / 2),
    worst: INTERIEUR_WORST_CASE_TABLE[`${lo}-${hi}`],
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
// eine einheitliche Anzeige über alle Schwerpunkte hinweg. "Problem" ist
// eine Eigenschaft, bei der die Stute SCHLECHTER als ihr eigener
// Durchschnitt abschneidet (höhere Zahl = schlechter), "gerettet", wenn
// der Hengst dort einen besseren (niedrigeren) Wert einbringt.
function intComplementarityScore(mare, stallion) {
  const stallionByLabel = new Map((stallion?.temperament || []).map((r) => [r.label, r]));
  const scores = (mare?.temperament || [])
    .map((r) => ({ label: r.label, score: scoreTemperamentTerm(r.value) }))
    .filter((r) => r.score != null);
  if (!scores.length) return { atStake: 0, saved: 0 };
  const avg = scores.reduce((a, r) => a + r.score, 0) / scores.length;

  let atStake = 0, saved = 0;
  for (const { label, score: a } of scores) {
    if (a <= avg) continue;
    const stallionRow = stallionByLabel.get(label);
    const b = stallionRow ? scoreTemperamentTerm(stallionRow.value) : null;
    if (b == null) continue;
    atStake++;
    if (b < a) saved++;
  }
  return { atStake, saved };
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
// Hengst). Analog zu exteriorComplementarityScore wird hier stattdessen
// gezählt, wie viele der EIGENEN unterdurchschnittlichen Werte der Stute
// (Grundlagen/Gangarten/Disziplinen ihrer eigenen Begabungskategorie) ein
// Hengst-Kandidat tatsächlich anhebt (sein Wert > ihrer, gewinnt also den
// max() in der Best-Case-Summe) - dadurch stutenspezifisch statt praktisch
// immer derselbe Kandidat.
function gpComplementarityScore(mare, stallion) {
  const mareTraitMap = flattenTraitPotentials(mare?.traits);
  const stallionTraitMap = flattenTraitPotentials(stallion?.traits);
  let atStake = 0, saved = 0;

  const countGroup = (names, mapA, mapB) => {
    const values = names.map((n) => mapA[n]).filter((v) => v != null);
    if (!values.length) return;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    for (const name of names) {
      const a = mapA[name], b = mapB[name];
      if (a == null || b == null || a >= avg) continue;
      atStake++;
      if (b > a) saved++;
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

  return { atStake, saved };
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
// getesteten Genort gibt) wenn mindestens ein Elternteil sichtbar Flaxen
// ist - das Pferd hat dann zwingend mindestens eine rezessive fl-Kopie
// geerbt, auch wenn selbst nicht sichtbar. byNameMap: Map<normalisierter
// Name, Pferd mit coat_color> aus einem möglichst breiten Bestand (siehe
// flaxenLookup in js/zuchtplaner.js), damit auch Elternteile gefunden
// werden, die selbst nicht (mehr) im ZZL-Kandidatenpool stehen.
function hasFlaxenTrait(horse, byNameMap) {
  if (isVisiblyFlaxen(horse)) return true;
  if (!byNameMap) return false;
  const anc = pedigreeAncestorNames(horse);
  for (const name of [anc[0], anc[1]]) {
    if (!name || normalizeName(name) === 'unbekannt') continue;
    const parent = byNameMap.get(normalizeName(name));
    if (parent && isVisiblyFlaxen(parent)) return true;
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
function colorWishPossible(candidate, wish, flaxenLookup) {
  if (wish.locus === 'Flaxen') {
    return wish.viaParent ? hasFlaxenTrait(candidate, flaxenLookup) : isVisiblyFlaxen(candidate);
  }
  const genes = presentGenesSummary(candidate.colors, candidate.coat_color, candidate.notes);
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
    return candidate.complement ? candidate.complement.saved : null;
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

// Harte Ausschlüsse zuerst (Inzucht, doppeltes Overo, nicht erfüllbare
// Farbwünsche), danach Sortierung nach dem gewählten Schwerpunkt +
// Sortiermodus, Top 20 (RANK_RESULT_COUNT).
function rankStallions(mare, stallions, { schwerpunkt, farbwuensche, sortMode, empiricalDeviations, flaxenLookup }) {
  const mareHasOvero = hasOveroGene(mare);
  const wishes = (farbwuensche || []).map((label) => COLOR_WISH_OPTIONS.find((o) => o.label === label)).filter(Boolean);

  const candidates = stallions.filter((stallion) => {
    if (findSharedNames(mare, stallion).length > 0) return false;
    if (mareHasOvero && hasOveroGene(stallion)) return false;
    if (wishes.length && !wishes.every((wish) => colorWishPossible(stallion, wish, flaxenLookup))) return false;
    return true;
  });

  const scored = candidates.map((stallion) => {
    const ext = exteriorFoalRange(mare, stallion);
    const int = interieurFoalRange(mare, stallion);
    const gp = estimateFoalGP(mare, stallion);
    const emp = empiricalDeviations ? estimateFoalEmpirical(mare, stallion, empiricalDeviations) : null;
    const complement = schwerpunkt === 'gp' ? gpComplementarityScore(mare, stallion)
      : schwerpunkt === 'int' ? intComplementarityScore(mare, stallion)
      : exteriorComplementarityScore(mare, stallion); // 'ext'/'extpct' (Default)
    return { stallion, ...ext, ...int, ...gp, emp, complement };
  });

  const mode = sortMode || 'best';
  // Bei "diff": größere Differenz zuerst bei diff-desc, kleinere zuerst bei
  // diff-asc. Bei "complement": mehr gerettete Problem-Genorte zuerst
  // (immer "höher = besser", unabhängig vom Schwerpunkt). Bei
  // "best"/"worst"/"empirical": Richtung folgt dem Schwerpunkt selbst
  // (z.B. bei Int ist niedriger immer besser, ob Best- oder Worst-Case).
  const ascending = mode === 'diff-asc'
    ? true
    : mode === 'diff-desc' || mode === 'complement'
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
    exteriorComplementarityScore, gpComplementarityScore, intComplementarityScore,
    interieurBestWorstForTrait, interieurFoalRange, estimateFoalGP,
    horseGP, horseExt, horseExtPct, horseInt,
    computeEmpiricalDeviations, estimateFoalEmpirical,
    COLOR_WISH_OPTIONS, colorWishPossible, rankStallions,
    isVisiblyFlaxen, hasFlaxenTrait,
  };
}
