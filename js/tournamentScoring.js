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
// Leistungsprüfung (LP, vormals "Prämierung" genannt): Bestehens-Prüfung
// nach inoffiziellen, von der Community ermittelten Kriterien (siehe
// checkLP unten) - keine offiziellen MDR-Regeln, daher keine Garantie auf
// Richtigkeit.

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

// Leistungsprüfung (LP) - Bestehens-Prüfung nach inoffiziellen,
// community-ermittelten Kriterien (nicht von MDR selbst, siehe Hinweis in
// der UI). Ein Genotyp gilt als "ausgeprägt betroffen" (nicht erlaubt),
// wenn er ausschließlich aus Kleinbuchstaben besteht (kein Trägerallel als
// Großbuchstabe mehr vorhanden) - Träger (gemischte Groß-/Kleinschreibung)
// sind laut Kriterien erlaubt.
function isDiseaseAusgepraegt(value) {
  if (!value) return false;
  return /[a-z]/.test(value) && !/[A-Z]/.test(value);
}

// Wie in horseForm.js (js/list.js-Pendant in MDR-Datenbank): die
// "Hauptdisziplin" ist die übergeordnete Kategorie der Begabung (z.B.
// "Western" für die Begabung "Reining"), nicht die Begabung selbst.
function findDisciplineCategory(disciplines, name) {
  if (!disciplines || !name) return null;
  for (const [category, entries] of Object.entries(disciplines)) {
    if (entries.some((e) => e.name === name)) return category;
  }
  return null;
}

// Von den 8 Gangarten zählen für die LP nur die 4 "normalen" Gangarten -
// Tölt/Pass/Foxtrott/Rack (Gangpferd-spezifisch) bleiben unberücksichtigt.
const LP_RELEVANT_GANGARTEN = ['Schritt', 'Trab', 'Galopp', 'Renngalopp'];

// Kriterien:
// - Krankheiten: keine ausgeprägten Erbkrankheiten (Träger erlaubt)
// - Interieur (Skala 1=exzellent...5=miserabel): kein miserabler Wert,
//   max. 2 schlechte Werte, mind. 5x gut oder exzellent
// - Exterieur/Körperbau (Skala 1=exzellent...5=viel zu X, hier als
//   "grün"=1-2, "gelb"=3, "sehr schlecht"=5 interpretiert): max. 2 sehr
//   schlechte Werte, mind. 5x gelb oder grün, mind. 1x grün
// - Disziplinen: nur innerhalb der Hauptdisziplin (Kategorie der
//   Begabung, z.B. "Western") - mind. 20% in allen deren Disziplinen,
//   mind. 1x 25%
// - Eigenschaften (Grundlagen + die 4 relevanten Gangarten): mind. 15%
//   in allen, mind. 6x 20%+ insgesamt, davon mind. 4x in Grundlagen und
//   mind. 1x in den relevanten Gangarten
//
// Rückgabe: { possible: true/false/null, reasons: [...Gründe für
// voraussichtliches Nichtbestehen...], warnings: [...fehlende Daten...] }.
// possible=null nur, wenn gar keine der benötigten Datenblöcke vorhanden
// sind (Prüfung nicht möglich).
function checkLP(profile) {
  const reasons = [];
  const warnings = [];
  if (!profile) return { possible: null, reasons, warnings: ['Kein Pferd ausgewählt.'] };

  // Krankheiten
  if (profile.genetic_diseases && profile.genetic_diseases.length) {
    const affected = profile.genetic_diseases.filter((d) => isDiseaseAusgepraegt(d.value));
    if (affected.length) {
      reasons.push(`Ausgeprägte Erbkrankheit(en): ${affected.map((d) => d.label).join(', ')} (Träger sind erlaubt, homozygot betroffen nicht)`);
    }
  } else {
    warnings.push('Erbkrankheiten: keine Daten vorhanden, Kriterium nicht geprüft.');
  }

  // Interieur
  if (profile.temperament && profile.temperament.length) {
    const scored = profile.temperament
      .map((r) => ({ label: r.label, score: scoreTemperamentTerm(r.value) }))
      .filter((r) => r.score != null);
    const miserabel = scored.filter((r) => r.score === 5);
    const schlecht = scored.filter((r) => r.score === 4);
    const gutPlus = scored.filter((r) => r.score <= 2);
    if (miserabel.length) {
      reasons.push(`Interieur: miserabler Wert vorhanden (${miserabel.map((r) => r.label).join(', ')})`);
    }
    if (schlecht.length > 2) {
      reasons.push(`Interieur: ${schlecht.length} schlechte Werte, max. 2 erlaubt (${schlecht.map((r) => r.label).join(', ')})`);
    }
    if (gutPlus.length < 5) {
      reasons.push(`Interieur: nur ${gutPlus.length}x gut/exzellent, mind. 5 nötig`);
    }
  } else {
    warnings.push('Interieur: keine Daten vorhanden, Kriterium nicht geprüft.');
  }

  // Exterieur (Körperbau)
  if (profile.exterior_descriptive && profile.exterior_descriptive.length) {
    const scored = profile.exterior_descriptive
      .map((r) => ({ label: r.label, score: scoreExteriorTerm(r.value) }))
      .filter((r) => r.score != null);
    const sehrSchlecht = scored.filter((r) => r.score === 5);
    const gelbGruen = scored.filter((r) => r.score <= 3);
    const gruen = scored.filter((r) => r.score <= 2);
    if (sehrSchlecht.length > 2) {
      reasons.push(`Exterieur: ${sehrSchlecht.length} sehr schlechte Werte, max. 2 erlaubt (${sehrSchlecht.map((r) => r.label).join(', ')})`);
    }
    if (gelbGruen.length < 5) {
      reasons.push(`Exterieur: nur ${gelbGruen.length}x gelb/grün, mind. 5 nötig`);
    }
    if (gruen.length < 1) {
      reasons.push('Exterieur: kein grüner Wert vorhanden, mind. 1 nötig');
    }
  } else {
    warnings.push('Exterieur: keine Daten vorhanden, Kriterium nicht geprüft.');
  }

  // Disziplinen (nur Hauptdisziplin-Kategorie, siehe findDisciplineCategory)
  const begabung = profile.tournament_potential?.['Begabung'];
  const hauptkategorie = findDisciplineCategory(profile.disciplines, begabung);
  const relevantDisciplines = hauptkategorie ? (profile.disciplines[hauptkategorie] || []) : [];
  if (relevantDisciplines.length) {
    const under20 = relevantDisciplines.filter((e) => e.potential != null && e.potential < 20);
    const ab25 = relevantDisciplines.filter((e) => e.potential != null && e.potential >= 25);
    if (under20.length) {
      reasons.push(`Disziplinen (Hauptdisziplin ${hauptkategorie}) unter 20% Potenzial: ${under20.map((e) => `${e.name} (${e.potential}%)`).join(', ')}`);
    }
    if (ab25.length < 1) {
      reasons.push(`Keine Disziplin in der Hauptdisziplin (${hauptkategorie}) mit mind. 25% Potenzial vorhanden`);
    }
  } else {
    warnings.push('Disziplinen: Hauptdisziplin (Kategorie der Begabung) konnte nicht ermittelt werden, Kriterium nicht geprüft.');
  }

  // Eigenschaften (Grundlagen + die 4 relevanten Gangarten)
  const grundlagen = profile.traits?.['Grundlagen'] || [];
  const gangarten = (profile.traits?.['Gangarten'] || []).filter((e) => LP_RELEVANT_GANGARTEN.includes(e.name));
  if (grundlagen.length || gangarten.length) {
    const alle = [...grundlagen, ...gangarten];
    const under15 = alle.filter((e) => e.potential != null && e.potential < 15);
    const grundlagenAb20 = grundlagen.filter((e) => e.potential != null && e.potential >= 20);
    const gangartenAb20 = gangarten.filter((e) => e.potential != null && e.potential >= 20);
    const totalAb20 = grundlagenAb20.length + gangartenAb20.length;
    if (under15.length) {
      reasons.push(`Eigenschaften unter 15% Potenzial: ${under15.map((e) => `${e.name} (${e.potential}%)`).join(', ')}`);
    }
    if (totalAb20 < 6 || grundlagenAb20.length < 4 || gangartenAb20.length < 1) {
      reasons.push(`Nur ${totalAb20}x ≥20% in den Eigenschaften (${grundlagenAb20.length}x Grundlagen, ${gangartenAb20.length}x Gangarten) - nötig: mind. 6 gesamt, davon mind. 4x Grundlagen und mind. 1x Gangarten`);
    }
  } else {
    warnings.push('Eigenschaften: keine Daten vorhanden, Kriterium nicht geprüft.');
  }

  if (warnings.length === 5) return { possible: null, reasons, warnings };
  return { possible: reasons.length === 0, reasons, warnings };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DISCIPLINE_REQUIREMENTS, lkFromPercent, computeTournamentValues, isDiseaseAusgepraegt, checkLP };
}
