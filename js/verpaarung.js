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

// --- Interieur: nur Phänotyp-Kategorie bekannt (kein Gencode) ---
//
// Kategorie -> Bandbreite "Anzahl hh-Loci von 8" (Komplement der
// H-Präsenz-Bandbreite Exzellent=8H, Gut=6-7H, In Ordnung=4-5H,
// Schlecht=2-3H, Miserabel=0-1H).
const INTERIEUR_HH_RANGE = { 1: [0, 0], 2: [1, 2], 3: [3, 4], 4: [5, 6], 5: [7, 8] };

function hhRangeForScore(score) {
  return INTERIEUR_HH_RANGE[score] || null;
}

function interieurCategoryFromHHCount(hhCount) {
  if (hhCount <= 0) return 1;
  if (hhCount <= 2) return 2;
  if (hhCount <= 4) return 3;
  if (hhCount <= 6) return 4;
  return 5;
}

// Best Case: optimistischste (niedrigste) hh-Zahl je Elter annehmen, dann
// per Pigeonhole-Prinzip die minimal erzwungene Überlappung berechnen
// (max(0, A_low + B_low - 8)) - das ist die Mindestzahl an Loci, die beim
// Fohlen zwangsläufig hh werden. Worst Case: aus einer Phänotyp-Kategorie
// ist echte Homozygotie (HH) nie nachweisbar, daher ist "Miserabel" für
// JEDE Anpaarung als schlechtmöglichster Fall erreichbar (mit dem Nutzer
// abgestimmt).
function interieurFoalRange(mare, stallion) {
  const mareRows = mare?.temperament || [];
  const stallionByLabel = new Map((stallion?.temperament || []).map((r) => [r.label, r]));

  const bestScores = [];
  let worstCount = 0;

  for (const mareRow of mareRows) {
    const stallionRow = stallionByLabel.get(mareRow.label);
    if (!stallionRow) continue;
    const scoreA = scoreTemperamentTerm(mareRow.value);
    const scoreB = scoreTemperamentTerm(stallionRow.value);
    if (scoreA == null || scoreB == null) continue;

    const rangeA = hhRangeForScore(scoreA);
    const rangeB = hhRangeForScore(scoreB);
    const overlap = Math.max(0, rangeA[0] + rangeB[0] - 8);
    bestScores.push(interieurCategoryFromHHCount(overlap));
    worstCount++;
  }

  if (!bestScores.length) return { intBest: null, intWorst: null };
  return {
    intBest: bestScores.reduce((a, b) => a + b, 0) / bestScores.length,
    intWorst: 5, // Miserabel - siehe Erklärung oben
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

// --- Farbwünsche ---

const COLOR_WISH_OPTIONS = [
  { label: 'Overo', locus: 'Overo', allele: 'O' },
  { label: 'Tobiano', locus: 'KIT', allele: 'To' },
  { label: 'Sabino', locus: 'KIT', allele: 'Sb' },
  { label: 'Roan', locus: 'KIT', allele: 'Rn' },
  { label: 'Champagne', locus: 'Champagne', allele: 'Ch' },
  { label: 'Dun', locus: 'Dun', allele: 'D' },
  { label: 'Cream', locus: 'Cream', allele: 'Cr' },
  { label: 'Grey', locus: 'Grey', allele: 'G' },
  { label: 'Splashed', locus: 'Splashed', allele: 'SPL' },
  { label: 'Leopard/Appaloosa', locus: 'Appaloosa', allele: 'Lp' },
];

// Bewusst vereinfacht (analog zu hasOveroGene): das Merkmal gilt als
// möglich, wenn Stute ODER Hengst das Gen laut presentGenesSummary trägt -
// kein vollständiges Dominant-/rezessiv-Modell je Locus.
function colorWishPossible(mare, stallion, wish) {
  const hasWish = (horse) => {
    const genes = presentGenesSummary(horse.colors, horse.coat_color, horse.notes);
    return genes.some((g) => g.locus === wish.locus && g.alleles.includes(wish.allele));
  };
  return hasWish(mare) || hasWish(stallion);
}

// --- Ranking ---

// Höher = besser für GP/Ext%, niedriger = besser für Ext/Int (1=exzellent
// ... 5=miserabel-Skala) - siehe Plan.
const SCHWERPUNKT_HIGHER_IS_BETTER = { gp: true, ext: false, extpct: true, int: false };
const SCHWERPUNKT_FIELD = { gp: 'gpBest', ext: 'extBest', extpct: 'extPctBest', int: 'intBest' };

// Harte Ausschlüsse zuerst (Inzucht, doppeltes Overo, nicht erfüllbare
// Farbwünsche), danach Sortierung nach dem Fohlen-Best-Case-Wert des
// gewählten Schwerpunkts, Top 10.
function rankStallions(mare, stallions, { schwerpunkt, farbwuensche }) {
  const mareHasOvero = hasOveroGene(mare);
  const wishes = (farbwuensche || []).map((label) => COLOR_WISH_OPTIONS.find((o) => o.label === label)).filter(Boolean);

  const candidates = stallions.filter((stallion) => {
    if (findSharedNames(mare, stallion).length > 0) return false;
    if (mareHasOvero && hasOveroGene(stallion)) return false;
    if (wishes.length && !wishes.every((wish) => colorWishPossible(mare, stallion, wish))) return false;
    return true;
  });

  const scored = candidates.map((stallion) => {
    const ext = exteriorFoalRange(mare, stallion);
    const int = interieurFoalRange(mare, stallion);
    const gp = estimateFoalGP(mare, stallion);
    return { stallion, ...ext, ...int, ...gp };
  });

  const field = SCHWERPUNKT_FIELD[schwerpunkt] || 'gpBest';
  const higherIsBetter = SCHWERPUNKT_HIGHER_IS_BETTER[schwerpunkt] !== false;
  scored.sort((a, b) => {
    const va = a[field], vb = b[field];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return higherIsBetter ? vb - va : va - vb;
  });

  return { total: stallions.length, candidateCount: candidates.length, top: scored.slice(0, 10) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseExteriorLocus, exteriorBestWorstForTrait, exteriorFoalRange,
    hhRangeForScore, interieurFoalRange, estimateFoalGP,
    COLOR_WISH_OPTIONS, colorWishPossible, rankStallions,
  };
}
