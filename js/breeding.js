// Hilfsfunktionen für den Zuchtplaner (Inzuchtprüfung per Namensdopplung,
// Overo-Erkennung). Reine Funktionen ohne DB-Zugriff, damit sie sowohl in
// der UI als auch (später) anderswo wiederverwendet werden können.
//
// Benötigt js/parser.js (für presentGenesSummary), muss also nach diesem
// Script eingebunden werden.

// pedigree[0] ist laut Parser (siehe js/parser.js parsePedigree) immer das
// Pferd selbst, danach folgen die Vorfahren in der Reihenfolge Eltern (2) →
// Großeltern (4) → Urgroßeltern (8) - siehe auch pedigreeHtml in
// js/horseForm.js, die dieselbe Aufteilung für die Anzeige nutzt. Nur diese
// ersten 14 Vorfahren gelten als "sichtbar" im Sinn der Inzuchtprüfung;
// eventuell weitere vom Parser gefundene Namen werden ignoriert.
function pedigreeAncestorNames(horse) {
  // In der Datenbank steht "pedigree" nicht bei jedem Pferd garantiert als
  // Array (z.B. leeres Objekt "{}" statt "[]" bei manuell/älter
  // angelegten Einträgen) - Array.isArray() schützt davor, dass .slice()
  // dann mit einem Laufzeitfehler abbricht.
  const list = Array.isArray(horse?.pedigree) ? horse.pedigree : [];
  // list[0] ist das Pferd selbst, list[1..14] sind die 14 sichtbaren
  // Vorfahren (Eltern 2 + Großeltern 4 + Urgroßeltern 8) - slice(1, 15),
  // nicht slice(1, 14), sonst fehlt der letzte Urgroßelternteil.
  return list.slice(1, 15).map((p) => p.name).filter(Boolean);
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
function findSharedNames(mare, stallion) {
  const pool = foalPedigreeNodes(mare, stallion).filter((entry) => entry.name);

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
