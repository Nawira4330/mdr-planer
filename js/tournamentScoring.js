// Turnierwert- (LK-) Berechnung für den Turnierplaner, nach den vom Nutzer
// gelieferten Spielregeln:
//
// Für jede Disziplin zählen 7 (teils 5-6) Leistungswerte: das Potenzial der
// Disziplin selbst sowie die dafür benötigten Grundlagen/Gangarten-
// Potenziale. Der SCHLECHTESTE (niedrigste) dieser Werte bestimmt die
// Leistungsklasse (LK10 = 0-9% ... LK1 = 90-100%). Zusätzlich sind pro
// Disziplin 3-4 Interieur-Werte relevant (nur informativ, nicht Teil der
// LK-Bestimmung).
//
// Die Zuordnung Disziplin -> benötigte Grundlagen/Interieur-Werte ist fest
// vom Spiel vorgegeben (vom Nutzer geliefert) und wird hier 1:1 abgebildet.
//
// Prämierungs-Kriterien sind weiterhin nicht bekannt und bleiben ein
// Platzhalter.

const DISCIPLINE_REQUIREMENTS = {
  'Dressur': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Kraft', 'Präzision', 'Ausdruck'], interieur: ['Gelehrigkeit', 'Aufmerksamkeit', 'Intelligenz'] },
  'Springen': { grundlagen: ['Galopp', 'Beschleunigung', 'Wendigkeit', 'Kondition', 'Kraft', 'Tempo'], interieur: ['Furchtlosigkeit', 'Leistungsbereitschaft', 'Temperament'] },
  'Cross Country': { grundlagen: ['Galopp', 'Beschleunigung', 'Wendigkeit', 'Kondition', 'Kraft', 'Tempo'], interieur: ['Nervenstärke', 'Aufmerksamkeit', 'Leistungsbereitschaft'] },
  'Distanz': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Kondition', 'Tempo'], interieur: ['Gelassenheit', 'Gutmütigkeit', 'Nervenstärke', 'Temperament'] },

  'Flachrennen': { grundlagen: ['Renngalopp', 'Beschleunigung', 'Kondition', 'Tempo', 'Kraft'], interieur: ['Gelassenheit', 'Siegeswille', 'Leistungsbereitschaft', 'Temperament'] },
  'Hindernisrennen': { grundlagen: ['Renngalopp', 'Beschleunigung', 'Kondition', 'Tempo', 'Kraft'], interieur: ['Gelassenheit', 'Siegeswille', 'Nervenstärke', 'Aufmerksamkeit'] },
  'Seejagdrennen': { grundlagen: ['Renngalopp', 'Beschleunigung', 'Kondition', 'Tempo', 'Kraft'], interieur: ['Gelassenheit', 'Siegeswille', 'Nervenstärke', 'Furchtlosigkeit'] },
  'Trabrennen': { grundlagen: ['Trab', 'Beschleunigung', 'Kondition', 'Tempo', 'Kraft'], interieur: ['Gelassenheit', 'Temperament', 'Siegeswille', 'Leistungsbereitschaft'] },

  'Reining': { grundlagen: ['Schritt', 'Galopp', 'Beschleunigung', 'Wendigkeit', 'Kondition', 'Präzision'], interieur: ['Temperament', 'Leistungsbereitschaft', 'Intelligenz'] },
  'Trail': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Wendigkeit', 'Präzision'], interieur: ['Gelassenheit', 'Aufmerksamkeit', 'Gelehrigkeit', 'Intelligenz'] },
  'Pleasure': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Ausdruck', 'Präzision'], interieur: ['Gelassenheit', 'Sozialverhalten', 'Gutmütigkeit', 'Gelehrigkeit'] },
  'Horsemanship': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Ausdruck', 'Präzision'], interieur: ['Gelassenheit', 'Gutmütigkeit', 'Gelehrigkeit', 'Intelligenz'] },

  'Cutting': { grundlagen: ['Galopp', 'Beschleunigung', 'Wendigkeit', 'Kraft', 'Tempo'], interieur: ['Gelassenheit', 'Furchtlosigkeit', 'Nervenstärke', 'Intelligenz'] },
  'Roping': { grundlagen: ['Galopp', 'Beschleunigung', 'Präzision', 'Kraft', 'Tempo'], interieur: ['Gelassenheit', 'Aufmerksamkeit', 'Furchtlosigkeit', 'Nervenstärke'] },
  'Pole Bending': { grundlagen: ['Galopp', 'Beschleunigung', 'Wendigkeit', 'Präzision', 'Kraft', 'Tempo'], interieur: ['Leistungsbereitschaft', 'Siegeswille', 'Temperament'] },
  'Barrel Racing': { grundlagen: ['Galopp', 'Beschleunigung', 'Wendigkeit', 'Präzision', 'Kraft', 'Tempo'], interieur: ['Leistungsbereitschaft', 'Siegeswille', 'Temperament'] },

  'Dressurfahren': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Wendigkeit', 'Präzision', 'Ausdruck'], interieur: ['Sozialverhalten', 'Gelehrigkeit', 'Intelligenz'] },
  'Hindernisfahren': { grundlagen: ['Galopp', 'Tempo', 'Wendigkeit', 'Präzision', 'Kondition', 'Kraft'], interieur: ['Sozialverhalten', 'Aufmerksamkeit', 'Furchtlosigkeit'] },
  'Geländefahren': { grundlagen: ['Galopp', 'Tempo', 'Wendigkeit', 'Kondition', 'Kraft'], interieur: ['Gelassenheit', 'Sozialverhalten', 'Nervenstärke', 'Furchtlosigkeit'] },
  'Holzrücken': { grundlagen: ['Schritt', 'Kraft', 'Kondition', 'Wendigkeit', 'Ausdruck'], interieur: ['Gelassenheit', 'Nervenstärke', 'Furchtlosigkeit', 'Gutmütigkeit'] },

  'Klassische Dressur': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Kraft', 'Präzision', 'Ausdruck'], interieur: ['Gelehrigkeit', 'Aufmerksamkeit', 'Intelligenz'] },
  'Spanische Gänge': { grundlagen: ['Schritt', 'Trab', 'Wendigkeit', 'Präzision', 'Ausdruck'], interieur: ['Gelassenheit', 'Gutmütigkeit', 'Aufmerksamkeit', 'Intelligenz'] },
  'Schulsprünge': { grundlagen: ['Kraft', 'Präzision', 'Ausdruck', 'Kondition', 'Wendigkeit'], interieur: ['Gelassenheit', 'Temperament', 'Leistungsbereitschaft', 'Nervenstärke'] },
  'Hohe Schule': { grundlagen: ['Schritt', 'Trab', 'Galopp', 'Kraft', 'Präzision', 'Ausdruck'], interieur: ['Gelehrigkeit', 'Leistungsbereitschaft', 'Intelligenz'] },

  'Tölt-Prüfung': { grundlagen: ['Tölt', 'Kraft', 'Präzision', 'Ausdruck', 'Kondition'], interieur: ['Gelassenheit', 'Gutmütigkeit', 'Sozialverhalten', 'Aufmerksamkeit'] },
  'Passrennen': { grundlagen: ['Pass', 'Beschleunigung', 'Kondition', 'Tempo', 'Kraft'], interieur: ['Gelassenheit', 'Sozialverhalten', 'Siegeswille', 'Temperament'] },
  'Foxtrott Pleasure': { grundlagen: ['Foxtrott', 'Ausdruck', 'Präzision', 'Kondition', 'Wendigkeit'], interieur: ['Gelassenheit', 'Gutmütigkeit', 'Sozialverhalten', 'Gelehrigkeit'] },
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
// "wert" = Potenzial der Disziplin selbst. "lk" = Leistungsklasse anhand
// des schlechtesten Werts aus Disziplin-Potenzial + benötigten
// Grundlagen-Potenzialen (nur berechnet, wenn alle benötigten Werte im
// Profil vorhanden sind - sonst "complete: false" und lk = null, damit kein
// falscher Wert vorgetäuscht wird). "interieur" = Mittelwert der
// benötigten Interieur-Werte (1 = exzellent ... 4 = schlecht), sofern
// vorhanden.
function computeTournamentValues(profile) {
  if (!profile) return [];
  const traitMap = flattenTraitPotentials(profile.traits);
  const tempMap = temperamentScoreMap(profile.temperament);

  const results = [];
  for (const [category, entries] of Object.entries(profile.disciplines || {})) {
    for (const entry of entries) {
      const req = DISCIPLINE_REQUIREMENTS[entry.name];
      const wert = entry.potential;

      let lk = null;
      let complete = false;
      if (req) {
        const values = [wert, ...req.grundlagen.map((n) => traitMap[n])];
        complete = values.every((v) => v != null && !Number.isNaN(v));
        if (complete) lk = lkFromPercent(Math.min(...values));
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
