// Hilfsfunktionen für den Zuchtplaner (Inzuchtprüfung per Namensdopplung,
// Overo-Erkennung). Reine Funktionen ohne DB-Zugriff, damit sie sowohl in
// der UI als auch (später) anderswo wiederverwendet werden können.
//
// Benötigt js/parser.js (für presentGenesSummary), muss also nach diesem
// Script eingebunden werden.

// In der Datenbank kommen zwei "pedigree"-Formate vor (je nachdem, wann
// bzw. mit welcher Parser-Version das Pferd zuletzt gespeichert wurde):
//
// 1. Altes Format: flaches Array, Index 0 ist das Pferd selbst, danach
//    folgen die Vorfahren in der Reihenfolge Eltern (2) → Großeltern (4)
//    → Urgroßeltern (8) - siehe auch pedigreeHtml in js/horseForm.js.
// 2. Neues Format: Objekt "{ sections, ancestors }", wobei "ancestors"
//    bereits die reine 14-köpfige Vorfahrenliste in derselben Reihenfolge
//    ist - OHNE das Pferd selbst als erstes Element.
//
// Nur diese 14 Vorfahren gelten als "sichtbar" im Sinn der
// Inzuchtprüfung; eventuell weitere vom Parser gefundene Namen werden
// ignoriert.
function pedigreeAncestorNames(horse) {
  const pedigree = horse?.pedigree;
  if (Array.isArray(pedigree)) {
    // Altes Format: slice(1, 15), nicht slice(1, 14), sonst fehlt der
    // letzte Urgroßelternteil.
    return pedigree.slice(1, 15).map((p) => p.name).filter(Boolean);
  }
  if (pedigree && Array.isArray(pedigree.ancestors)) {
    return pedigree.ancestors.slice(0, 14).map((p) => p.name).filter(Boolean);
  }
  return [];
}

// Wie viele der maximal 14 sichtbaren Vorfahren-Plätze tatsächlich einen
// Namen haben - dient als Warnhinweis, wenn der Stammbaum nur unvollständig
// erfasst wurde (dann kann eine "kein Risiko"-Aussage trügerisch sein).
function pedigreeDepth(horse) {
  return pedigreeAncestorNames(horse).length;
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

// Baut den sichtbaren Stammbaum DES FOHLENS (nicht den der Elterntiere!)
// aus Stute und Hengst: Eltern (2) = Stute+Hengst selbst, Großeltern (4) =
// je die ersten 2 Vorfahren (= eigene Eltern) von Stute und Hengst,
// Urgroßeltern (8) = je die nächsten 4 Vorfahren (= eigene Großeltern) von
// Stute und Hengst. Die eigenen Urgroßeltern von Stute/Hengst (Positionen
// 7-14 in pedigreeAncestorNames) wären erst die Ururgroßeltern des
// Fohlens und damit außerhalb der "sichtbaren" 3 Generationen - werden
// hier bewusst NICHT einbezogen.
//
// Rückgabe: flache Liste von { name, side: 'Mutter'|'Vater',
// generation: 'Elternteil'|'Großeltern'|'Urgroßeltern' } (max. 14
// Einträge, in Anzeige-Reihenfolge).
function foalPedigreeNodes(mare, stallion) {
  const mareAnc = pedigreeAncestorNames(mare);
  const stallionAnc = pedigreeAncestorNames(stallion);
  const tag = (side, generation) => (name) => ({ name, side, generation });
  return [
    { name: mare?.name, side: 'Mutter', generation: 'Elternteil' },
    { name: stallion?.name, side: 'Vater', generation: 'Elternteil' },
    ...mareAnc.slice(0, 2).map(tag('Mutter', 'Großeltern')),
    ...stallionAnc.slice(0, 2).map(tag('Vater', 'Großeltern')),
    ...mareAnc.slice(2, 6).map(tag('Mutter', 'Urgroßeltern')),
    ...stallionAnc.slice(2, 6).map(tag('Vater', 'Urgroßeltern')),
  ];
}

// Prüft, ob im sichtbaren Stammbaum DES FOHLENS (siehe foalPedigreeNodes,
// max. 14 Positionen: Eltern + Großeltern + Urgroßeltern) ein Name
// mehrfach vorkommt - das ist die vom Nutzer gewünschte, vereinfachte
// Inzuchtprüfung (keine Berechnung eines Inzuchtkoeffizienten, nur
// Namensdopplung).
//
// Rückgabe: Array von { name, occurrences } für jeden doppelt (oder
// öfter) vorkommenden Namen; leeres Array = keine Dopplung gefunden.
// "occurrences" listet je Fundstelle { side: 'Mutter'|'Vater', role }.
//
// "Unbekannt" (Platzhalter des Spiels für einen nicht erfassten Vorfahren)
// wird dabei ausdrücklich ignoriert - mehrere unbekannte Vorfahren sind
// keine echte Namensdopplung und sollen keinen Inzuchtalarm auslösen.
function findSharedNames(mare, stallion) {
  const pool = foalPedigreeNodes(mare, stallion)
    .filter((entry) => entry.name)
    .filter((entry) => normalizeName(entry.name) !== 'unbekannt');

  const byNormalized = new Map();
  for (const entry of pool) {
    const key = normalizeName(entry.name);
    if (!byNormalized.has(key)) byNormalized.set(key, []);
    byNormalized.get(key).push(entry);
  }

  const duplicates = [];
  for (const entries of byNormalized.values()) {
    if (entries.length > 1) {
      duplicates.push({
        name: entries[0].name,
        occurrences: entries.map((e) => ({
          side: e.side,
          role: e.generation === 'Elternteil'
            ? e.side
            : `${e.generation} ${e.side === 'Mutter' ? 'mütterlicherseits' : 'väterlicherseits'}`,
        })),
      });
    }
  }
  return duplicates;
}

// Ob ein Pferd (getestet oder aus der Fellfarbe abgeleitet) das
// Overo-Merkmal trägt - nutzt presentGenesSummary aus js/parser.js, die
// bereits getestete Loci UND (nur bei nicht getesteten Loci) Hinweise aus
// dem Fellfarbe-Namen zusammenführt.
function hasOveroGene(horse) {
  if (!horse) return false;
  const genes = presentGenesSummary(horse.colors, horse.coat_color, horse.notes, horse.name);
  return genes.some((g) => g.locus === 'Overo');
}

// --- Allgemeine Verwandtschaftsprüfung (Verwandtschaftsmatrix) ---
//
// Anders als findSharedNames (das den hypothetischen Stammbaum EINES
// FOHLENS aus Stute+Hengst prüft) geht es hier um die direkte Frage "sind
// diese zwei bereits existierenden Pferde miteinander verwandt" - dafür
// zählt der komplette sichtbare Stammbaum JEDES der beiden Pferde für
// sich (das Pferd selbst + seine 14 Vorfahren), nicht nur die für ein
// gemeinsames Fohlen relevanten Positionen.

// Baut den vollständigen "Namenspool" eines Pferds: das Pferd selbst +
// seine 14 sichtbaren Vorfahren, je mit Positions-Label. "Unbekannt" wird
// wie überall ignoriert.
function pedigreeNamePool(horse) {
  if (!horse?.name) return [];
  const pool = [{ name: horse.name, position: 'Pferd selbst' }];
  pedigreeAncestorNames(horse).forEach((name, i) => {
    if (!name || normalizeName(name) === 'unbekannt') return;
    pool.push({ name, position: i < 2 ? 'Elternteil' : i < 6 ? 'Großeltern' : 'Urgroßeltern' });
  });
  return pool;
}

// Liefert alle Namen, die sich die sichtbaren Stammbäume zweier Pferde
// teilen (inkl. der Pferde selbst), mit der jeweiligen Position bei BEIDEN
// Pferden - z.B. { name: 'Rock my Heart', positionA: 'Großeltern',
// positionB: 'Pferd selbst' } (= Rock my Heart ist Großelternteil von
// Pferd A und ist selbst Pferd B).
function findRelations(horseA, horseB) {
  if (!horseA || !horseB || horseA.id === horseB.id) return [];
  const poolA = pedigreeNamePool(horseA);
  const poolB = pedigreeNamePool(horseB);
  const matches = [];
  for (const a of poolA) {
    for (const b of poolB) {
      if (normalizeName(a.name) === normalizeName(b.name)) {
        matches.push({ name: a.name, positionA: a.position, positionB: b.position });
      }
    }
  }
  return matches;
}

function areRelated(horseA, horseB) {
  return findRelations(horseA, horseB).length > 0;
}

// Erbkrankheiten-Rohwerte folgen NICHT derselben Groß-/Kleinschreibungs-
// Konvention wie die Farbgenetik-Loci, sondern immer "Allel1/Allel2" in
// GROSSBUCHSTABEN: "NN" ist das gesunde/normale Allel, jeder andere
// 2-Buchstaben-Code ein krankheitsspezifisches Risiko-Allel (z.B. "HE" für
// HERDA, "JE" für JEB) - "NN/NN" = frei, "HE/NN" = Träger (1 Kopie),
// hypothetisch "HE/HE" = ausgeprägt betroffen (2 Kopien). Zusätzlich gibt
// es "Nicht getestet" (unbekannt - zählt NICHT als Träger). Verifiziert
// gegen alle in der Datenbank vorkommenden Rohwerte alle 10 erfassten
// Krankheiten (nie Kleinbuchstaben, immer NN/XX-Format oder "Nicht
// getestet").
function diseaseAlleles(value) {
  if (!value) return null;
  const parts = value.split('/').map((p) => p.trim()).filter(Boolean);
  return parts.length === 2 ? parts : null;
}

// Ein Erbkrankheiten-Wert gilt als "nicht sauber" (Träger ODER ausgeprägt
// betroffen), sobald mindestens ein Allel nicht "NN" ist - "Nicht
// getestet" zählt bewusst NICHT als Träger (unbekannt ist etwas anderes
// als bestätigt betroffen).
function isDiseaseCarrierOrAffected(value) {
  const alleles = diseaseAlleles(value);
  if (!alleles) return false;
  return alleles.some((a) => a !== 'NN');
}

// Liefert die Labels aller Erbkrankheiten (EKH), bei denen BEIDE
// Elterntiere mindestens Träger sind (Abgleich per Label, z.B. "HERDA") -
// nur dann besteht bei gleicher Krankheit auf beiden Seiten ein erhöhtes
// Risiko für ein ausgeprägt betroffenes Fohlen (analog zur
// Overo-Doppelträger-Warnung oben).
function sharedDiseaseRisks(mare, stallion) {
  const mareAffected = new Set(
    (mare?.genetic_diseases || []).filter((d) => isDiseaseCarrierOrAffected(d.value)).map((d) => d.label),
  );
  return (stallion?.genetic_diseases || [])
    .filter((d) => isDiseaseCarrierOrAffected(d.value) && mareAffected.has(d.label))
    .map((d) => d.label);
}

// --- Verwandtschaftsgrad (Inzuchtkoeffizient nach Wright'scher Pfad-Methode) ---
//
// Anders als findRelations/findSharedNames (die nur den SICHTBAREN,
// höchstens 3 Generationen tiefen Stammbaum jedes Pferds für sich
// betrachten) rechnet dies einen echten Verwandtschaftsgrad in Prozent aus:
// jeder gemeinsame Vorfahre trägt mit (0.5)^(nA+nB+1) bei (nA/nB =
// Generationen-Abstand zu Pferd A bzw. B), aufsummiert über alle
// gemeinsamen Vorfahren - das entspricht dem erwarteten Inzuchtkoeffizienten
// eines hypothetischen gemeinsamen Fohlens von A und B. Vom Prinzip her 1:1
// aus js/pedigree.js (estimateCOI) im separaten HorseReality-Datenbank-
// Projekt übernommen, hier an das hiesige, flachere Stammbaum-Format
// angepasst: dort gibt es Spiel-IDs und einen gespeicherten eigenen
// COI-Wert je Pferd (der als F_Vorfahre-Korrektur einfließt), hier nur die
// 14 sichtbaren Vorfahren-NAMEN je Pferd (siehe pedigreeAncestorNames) -
// die F_Vorfahre-Korrektur entfällt deshalb hier (wird wie 0 behandelt),
// und die Verkettung über mehrere Generationen läuft per Namensabgleich
// gegen einen übergebenen Pferde-Pool statt über Spiel-IDs.

// Bis zu welcher Generation die Kette über mehrfach im Bestand gespeicherte
// Vorfahren weiterverfolgt wird - der Beitrag eines gemeinsamen Vorfahren
// schrumpft mit (0.5)^Generation, ab hier praktisch vernachlässigbar
// (< 0.1%).
const COI_MAX_GENERATION = 10;

// Generation eines der 14 sichtbaren Vorfahren-Plätze relativ zum Pferd
// selbst (0/1 = Elternteil, 2-5 = Großeltern, 6-13 = Urgroßeltern), siehe
// pedigreeAncestorNames.
function ancestorLocalGeneration(index) {
  return index < 2 ? 1 : index < 6 ? 2 : 3;
}

// Index Name -> Pferd über einen beliebigen Pferde-Pool (z.B. alle auf der
// jeweiligen Seite geladenen Pferde) - für die Verkettung über mehrere
// Generationen hinweg (siehe buildDeepPedigree). Nur der jeweils erste
// Treffer je Name zählt (wie überall sonst bei Namensabgleich in diesem
// Repo).
function buildPedigreeNameIndex(pool) {
  const index = new Map();
  for (const h of pool || []) {
    const key = normalizeName(h.name);
    if (key && !index.has(key)) index.set(key, h);
  }
  return index;
}

// Baut den tiefen Stammbaum eines Pferds als flache Liste { name,
// generation }, EINSCHLIESSLICH des Pferds selbst (generation 0 - wichtig,
// damit z.B. ein direkter Eltern-Kind-Vergleich über findDeepCommonAncestors
// erkannt wird: das Elternteil taucht dann als "gemeinsamer Vorfahre" bei
// sich selbst mit Generation 0 und beim Kind mit Generation 1 auf). Darüber
// hinaus wird für jeden der 14 sichtbaren Vorfahren, der sich per Name auf
// ein anderes Pferd im "nameIndex" auflösen lässt, dessen eigener
// Stammbaum ebenfalls angehängt (Generation entsprechend verschoben) -
// rekursiv bis maxGeneration. Ein Name, der im eigenen Pfad schon vorkam,
// wird nicht erneut aufgelöst (schützt vor Endlosschleifen bei
// fehlerhaften/zirkulären Angaben).
function buildDeepPedigree(horse, nameIndex, maxGeneration = COI_MAX_GENERATION) {
  const result = horse?.name ? [{ name: horse.name, generation: 0 }] : [];
  const visited = new Set(horse?.name ? [normalizeName(horse.name)] : []);
  function walk(h, offset) {
    pedigreeAncestorNames(h).forEach((name, i) => {
      const key = normalizeName(name);
      if (!key || key === 'unbekannt') return;
      const generation = offset + ancestorLocalGeneration(i);
      result.push({ name, generation });
      if (generation >= maxGeneration || visited.has(key)) return;
      const resolved = nameIndex.get(key);
      if (!resolved) return;
      visited.add(key);
      walk(resolved, generation);
    });
  }
  walk(horse, 0);
  return result;
}

// Gemeinsame Vorfahren zweier tiefer Stammbäume (siehe buildDeepPedigree) -
// jedes Namens-Vorkommen auf beiden Seiten zählt einzeln (ein Vorfahre kann
// auf einer Seite über mehrere Pfade auftauchen, falls dort schon Inzucht
// vorliegt).
function findDeepCommonAncestors(pedigreeA, pedigreeB) {
  const byNameA = new Map();
  for (const n of pedigreeA) {
    const key = normalizeName(n.name);
    if (!byNameA.has(key)) byNameA.set(key, []);
    byNameA.get(key).push(n);
  }
  const common = [];
  for (const b of pedigreeB) {
    const matches = byNameA.get(normalizeName(b.name));
    if (!matches) continue;
    for (const a of matches) common.push({ name: b.name, generationA: a.generation, generationB: b.generation });
  }
  return common;
}

function coiFromCommonAncestors(commonAncestors) {
  let coi = 0;
  for (const c of commonAncestors) coi += Math.pow(0.5, c.generationA + c.generationB + 1);
  return Math.round(coi * 1000) / 10;
}

// Verwandtschaftsgrad zweier Pferde in Prozent (Inzuchtkoeffizient eines
// hypothetischen gemeinsamen Fohlens) - "pool" ist der Pferde-Bestand, über
// den Vorfahren-Namen zu tatsächlich gespeicherten Pferden aufgelöst werden
// (siehe buildDeepPedigree). null, wenn eines der beiden Pferde fehlt oder
// beide dasselbe Pferd sind.
function estimateRelatedness(horseA, horseB, pool, maxGeneration = COI_MAX_GENERATION) {
  if (!horseA || !horseB) return null;
  if (horseA === horseB || (horseA.id && horseB.id && horseA.id === horseB.id)) return null;
  const nameIndex = buildPedigreeNameIndex(pool);
  const pedA = buildDeepPedigree(horseA, nameIndex, maxGeneration);
  const pedB = buildDeepPedigree(horseB, nameIndex, maxGeneration);
  return coiFromCommonAncestors(findDeepCommonAncestors(pedA, pedB));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pedigreeAncestorNames, pedigreeDepth, foalPedigreeNodes, findSharedNames, hasOveroGene,
    isDiseaseCarrierOrAffected, sharedDiseaseRisks,
    pedigreeNamePool, findRelations, areRelated,
    buildPedigreeNameIndex, buildDeepPedigree, findDeepCommonAncestors, coiFromCommonAncestors, estimateRelatedness,
  };
}
