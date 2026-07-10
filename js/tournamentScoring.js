// Turnierwert- (Punkte/LK/Interieur-) Berechnung für den Turnierplaner.
//
// Anhand eines vom Nutzer gelieferten Beispielpferds (alle Rohdaten +
// tatsächliche Spiel-Ausgabe der "Turnierwerte"-Tabelle) wurde die Formel
// für alle 28 Disziplinen exakt nachgerechnet und stimmt zu 100% mit der
// echten Ausgabe überein:
//
// - Pro Disziplin zählen 7 Werte: das Potenzial der Disziplin selbst sowie
//   6 benötigte Grundlagen-/Gangarten-Potenziale (fest vom Spiel
//   vorgegeben, hier 1:1 abgebildet).
// - "Wert" (im Spiel "Punkte" genannt) = 3 × Disziplin-Potenzial + Summe
//   der 6 Grundlagen-Potenziale (das eigene Potenzial zählt also dreifach).
// - "LK" (Leistungsklasse) ergibt sich aus dem NIEDRIGSTEN der 7
//   Einzelwerte (nicht aus "Wert"!): LK10 = 0-9% ... LK1 = 90-100%.
// - "Interieur" = Mittelwert der 3 benötigten Interieur-Werte (Skala
//   1 = exzellent ... 4 = schlecht). Wichtig: "Gelassenheit" ist ein
//   Grundlagen-Wert (Prozent-Potenzial), keine Interieur-Eigenschaft -
//   das game-eigene "Interieur/Mentalität" umfasst nur: Gelehrigkeit,
//   Aufmerksamkeit, Intelligenz, Nervenstärke, Gutmütigkeit,
//   Sozialverhalten, Temperament, Leistungsbereitschaft, Siegeswille,
//   Furchtlosigkeit.
//
// Prämierungs-Kriterien sind weiterhin nicht bekannt und bleiben ein
// Platzhalter.

const DISCIPLINE_REQUIREMENTS = {
  'Dressur': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Kraft', 'Präzision', 'Ausdruck'], interieur: ['Gelehrigkeit', 'Aufmerksamkeit', 'Intelligenz'] },
  'Springen': { grundlagen: ['Galopp', 'Beschleunigung', 'Wendigkeit', 'Kondition', 'Kraft', 'Tempo'], interieur: ['Furchtlosigkeit', 'Leistungsbereitschaft', 'Temperament'] },
  'Cross Country': { grundlagen: ['Galopp', 'Beschleunigung', 'Wendigkeit', 'Kondition', 'Kraft', 'Tempo'], interieur: ['Nervenstärke', 'Aufmerksamkeit', 'Leistungsbereitschaft'] },
  'Distanz': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Kondition', 'Tempo', 'Gelassenheit'], interieur: ['Gutmütigkeit', 'Nervenstärke', 'Temperament'] },

  'Flachrennen': { grundlagen: ['Renngalopp', 'Beschleunigung', 'Kondition', 'Tempo', 'Kraft', 'Gelassenheit'], interieur: ['Siegeswille', 'Leistungsbereitschaft', 'Temperament'] },
  'Hindernisrennen': { grundlagen: ['Renngalopp', 'Beschleunigung', 'Kondition', 'Tempo', 'Kraft', 'Gelassenheit'], interieur: ['Siegeswille', 'Nervenstärke', 'Aufmerksamkeit'] },
  'Seejagdrennen': { grundlagen: ['Renngalopp', 'Beschleunigung', 'Kondition', 'Tempo', 'Kraft', 'Gelassenheit'], interieur: ['Siegeswille', 'Nervenstärke', 'Furchtlosigkeit'] },
  'Trabrennen': { grundlagen: ['Trab', 'Beschleunigung', 'Kondition', 'Tempo', 'Kraft', 'Gelassenheit'], interieur: ['Temperament', 'Siegeswille', 'Leistungsbereitschaft'] },

  'Reining': { grundlagen: ['Schritt', 'Galopp', 'Beschleunigung', 'Wendigkeit', 'Kondition', 'Präzision'], interieur: ['Temperament', 'Leistungsbereitschaft', 'Intelligenz'] },
  'Trail': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Wendigkeit', 'Präzision', 'Gelassenheit'], interieur: ['Aufmerksamkeit', 'Gelehrigkeit', 'Intelligenz'] },
  'Pleasure': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Ausdruck', 'Präzision', 'Gelassenheit'], interieur: ['Sozialverhalten', 'Gutmütigkeit', 'Gelehrigkeit'] },
  'Horsemanship': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Ausdruck', 'Präzision', 'Gelassenheit'], interieur: ['Gutmütigkeit', 'Gelehrigkeit', 'Intelligenz'] },

  'Cutting': { grundlagen: ['Galopp', 'Beschleunigung', 'Wendigkeit', 'Kraft', 'Tempo', 'Gelassenheit'], interieur: ['Furchtlosigkeit', 'Nervenstärke', 'Intelligenz'] },
  'Roping': { grundlagen: ['Galopp', 'Beschleunigung', 'Präzision', 'Kraft', 'Tempo', 'Gelassenheit'], interieur: ['Aufmerksamkeit', 'Furchtlosigkeit', 'Nervenstärke'] },
  'Pole Bending': { grundlagen: ['Galopp', 'Beschleunigung', 'Wendigkeit', 'Präzision', 'Kraft', 'Tempo'], interieur: ['Leistungsbereitschaft', 'Siegeswille', 'Temperament'] },
  'Barrel Racing': { grundlagen: ['Galopp', 'Beschleunigung', 'Wendigkeit', 'Präzision', 'Kraft', 'Tempo'], interieur: ['Leistungsbereitschaft', 'Siegeswille', 'Temperament'] },

  'Dressurfahren': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Wendigkeit', 'Präzision', 'Ausdruck'], interieur: ['Sozialverhalten', 'Gelehrigkeit', 'Intelligenz'] },
  'Hindernisfahren': { grundlagen: ['Galopp', 'Tempo', 'Wendigkeit', 'Präzision', 'Kondition', 'Kraft'], interieur: ['Sozialverhalten', 'Aufmerksamkeit', 'Furchtlosigkeit'] },
  'Geländefahren': { grundlagen: ['Galopp', 'Tempo', 'Wendigkeit', 'Kondition', 'Kraft', 'Gelassenheit'], interieur: ['Sozialverhalten', 'Nervenstärke', 'Furchtlosigkeit'] },
  'Holzrücken': { grundlagen: ['Schritt', 'Kraft', 'Kondition', 'Wendigkeit', 'Ausdruck', 'Gelassenheit'], interieur: ['Nervenstärke', 'Furchtlosigkeit', 'Gutmütigkeit'] },

  'Klassische Dressur': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Kraft', 'Präzision', 'Ausdruck'], interieur: ['Gelehrigkeit', 'Aufmerksamkeit', 'Intelligenz'] },
  'Spanische Gänge': { grundlagen: ['Schritt', 'Trab', 'Wendigkeit', 'Präzision', 'Ausdruck', 'Gelassenheit'], interieur: ['Gutmütigkeit', 'Aufmerksamkeit', 'Intelligenz'] },
  'Schulsprünge': { grundlagen: ['Kraft', 'Präzision', 'Ausdruck', 'Kondition', 'Wendigkeit', 'Gelassenheit'], interieur: ['Temperament', 'Leistungsbereitschaft', 'Nervenstärke'] },
  'Hohe Schule': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Kraft', 'Präzision', 'Ausdruck'], interieur: ['Gelehrigkeit', 'Leistungsbereitschaft', 'Intelligenz'] },

  'Tölt-Prüfung': { grundlagen: ['Tölt', 'Kraft', 'Präzision', 'Ausdruck', 'Kondition', 'Gelassenheit'], interieur: ['Gutmütigkeit', 'Sozialverhalten', 'Aufmerksamkeit'] },
  'Passrennen': { grundlagen: ['Pass', 'Beschleunigung', 'Kondition', 'Tempo', 'Kraft', 'Gelassenheit'], interieur: ['Sozialverhalten', 'Siegeswille', 'Temperament'] },
  'Foxtrott Pleasure': { grundlagen: ['Foxtrott', 'Ausdruck', 'Präzision', 'Kondition', 'Wendigkeit', 'Gelassenheit'], interieur: ['Gutmütigkeit', 'Sozialverhalten', 'Gelehrigkeit'] },
  'Racking': { grundlagen: ['Rack', 'Tempo', 'Ausdruck', 'Präzision', 'Kondition', 'Beschleunigung'], interieur: ['Gutmütigkeit', 'Sozialverhalten', 'Gelehrigkeit'] },
};

// LK10 = 0-9%, LK9 = 10-19%, ... LK1 = 90-100%.
function lkFromPercent(pct) {
  if (pct == null || Number.isNaN(pct)) return null;
  const bucket = Math.min(9, Math.max(0, Math.floor(pct / 10)));
  return 10 - bucket;
}

// Alle Grundlagen-/Gangarten-Potenziale (aus profile.traits, gruppiert nach
// z.B. "Grundlagen"/"Gangarten") flach nach Name zusammengeführt, damit
// unabhängig von der Untergruppe per Namen nachgeschlagen werden kann.
function flattenTraitPotentials(traits) {
  const map = {};
  for (const entries of Object.values(traits || {})) {
    for (const e of entries) map[e.name] = e.potential;
  }
  return map;
}

// Interieur-Rohwerte (profile.temperament, qualitativ) in die 1
// (exzellent) ... 4 (schlecht) Skala übersetzt, nach Name nachschlagbar.
function temperamentScoreMap(temperament) {
  const map = {};
  for (const row of temperament || []) {
    const score = scoreTemperamentTerm(row.value);
    if (score != null) map[row.label] = score;
  }
  return map;
}

// Ergebnis je Disziplin: { category, name, wert, interieur, lk, complete }.
// "wert" (= "Punkte" im Spiel) und "lk" werden nur berechnet, wenn alle 6
// benötigten Grundlagen-Potenziale im Profil vorhanden sind (sonst
// complete: false, damit kein falscher Wert vorgetäuscht wird).
function computeTournamentValues(profile) {
  if (!profile) return [];
  const traitMap = flattenTraitPotentials(profile.traits);
  const tempMap = temperamentScoreMap(profile.temperament);

  const results = [];
  for (const [category, entries] of Object.entries(profile.disciplines || {})) {
    for (const entry of entries) {
      const req = DISCIPLINE_REQUIREMENTS[entry.name];
      const disziplinPotential = entry.potential;

      let wert = null;
      let lk = null;
      let complete = false;
      if (req) {
        const grundlagenValues = req.grundlagen.map((n) => traitMap[n]);
        complete = disziplinPotential != null && grundlagenValues.every((v) => v != null && !Number.isNaN(v));
        if (complete) {
          wert = 3 * disziplinPotential + grundlagenValues.reduce((a, b) => a + b, 0);
          lk = lkFromPercent(Math.min(disziplinPotential, ...grundlagenValues));
        }
      }

      let interieur = null;
      if (req) {
        const scores = req.interieur.map((n) => tempMap[n]).filter((v) => v != null);
        if (scores.length) interieur = scores.reduce((a, b) => a + b, 0) / scores.length;
      }

      results.push({ category, name: entry.name, wert, interieur, lk, complete });
    }
  }
  return results;
}

// Platzhalter: die genauen Prämierungs-Kriterien sind noch unbekannt.
function checkPraemierung(profile) {
  return {
    status: 'unbekannt',
    hint: 'Prämierungs-Kriterien werden vom Nutzer noch ergänzt - noch keine echte Prüfung möglich.',
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DISCIPLINE_REQUIREMENTS, lkFromPercent, computeTournamentValues, checkPraemierung };
}
