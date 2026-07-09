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
  const list = horse?.pedigree || [];
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

// Prüft, ob im sichtbaren Stammbaum von Stute und Hengst zusammen (inkl.
// der beiden Elterntiere selbst) ein Name mehrfach vorkommt - das ist die
// vom Nutzer gewünschte, vereinfachte Inzuchtprüfung (keine Berechnung
// eines Inzuchtkoeffizienten, nur Namensdopplung).
//
// Rückgabe: Array von { name, occurrences } für jeden doppelt (oder
// öfter) vorkommenden Namen; leeres Array = keine Dopplung gefunden.
// "occurrences" listet je Fundstelle { side: 'Stute'|'Hengst', role }.
function findSharedNames(mare, stallion) {
  const pool = [
    { name: mare?.name, side: 'Stute', role: 'Stute selbst' },
    { name: stallion?.name, side: 'Hengst', role: 'Hengst selbst' },
    ...pedigreeAncestorNames(mare).map((name) => ({ name, side: 'Stute', role: 'Vorfahre der Stute' })),
    ...pedigreeAncestorNames(stallion).map((name) => ({ name, side: 'Hengst', role: 'Vorfahre des Hengstes' })),
  ].filter((entry) => entry.name);

  const byNormalized = new Map();
  for (const entry of pool) {
    const key = normalizeName(entry.name);
    if (!byNormalized.has(key)) byNormalized.set(key, []);
    byNormalized.get(key).push(entry);
  }

  const duplicates = [];
  for (const entries of byNormalized.values()) {
    if (entries.length > 1) {
      duplicates.push({ name: entries[0].name, occurrences: entries });
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
  module.exports = { pedigreeAncestorNames, pedigreeDepth, findSharedNames, hasOveroGene };
}
