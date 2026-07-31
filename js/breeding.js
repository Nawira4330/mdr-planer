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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pedigreeAncestorNames, pedigreeDepth, foalPedigreeNodes, findSharedNames, hasOveroGene,
    isDiseaseCarrierOrAffected, sharedDiseaseRisks,
    pedigreeNamePool, findRelations, areRelated,
  };
}
