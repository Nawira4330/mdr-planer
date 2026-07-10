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
  const genes = presentGenesSummary(horse.colors, horse.coat_color, horse.notes);
  return genes.some((g) => g.locus === 'Overo');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pedigreeAncestorNames, pedigreeDepth, foalPedigreeNodes, findSharedNames, hasOveroGene };
}
