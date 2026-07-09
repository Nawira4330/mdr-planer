// Turnierwert-Berechnung und Prämierungs-Prüfung für den Turnierplaner.
//
// WICHTIG: Die tatsächliche Formel, nach der das Spiel aus Grundlagen,
// Gangarten, Exterieur, Interieur und Begabung einen Turnierwert je
// Disziplin bildet, sowie die genauen Prämierungs-Kriterien, sind hier noch
// NICHT bekannt - der Nutzer liefert diese Kriterien noch nach ("Alle
// Kriterien zur Auswahl gebe ich später ein"). Bis dahin ist dies bewusst
// nur ein einfacher Platzhalter (grober Mittelwert der verfügbaren
// Potenzialwerte), absichtlich isoliert in genau diesen zwei Funktionen,
// damit später nur hier etwas ersetzt werden muss - UI und Datenfluss
// bleiben unverändert.

function toNumber(value) {
  if (value == null) return null;
  const n = parseFloat(String(value).replace(',', '.').replace('%', '').trim());
  return Number.isNaN(n) ? null : n;
}

// Platzhalter: Mittelwert aus Disziplin-Potenzial, Gesamtpotenzial (GP),
// genetischem Exterieur-Gesamtwert (%) und einem aus dem Interieur
// abgeleiteten Prozentwert (1=exzellent → 100%, 5=stark abweichend → 0%).
function computeTournamentValues(profile) {
  if (!profile) return [];

  const gp = toNumber(profile.tournament_potential?.['Gesamtpotenzial']);
  const extPct = profile.exterior_genetics?.overall?.percent ?? null;
  const intAvg = averageScore(profile.temperament, scoreTemperamentTerm);
  const intPct = intAvg != null ? ((5 - intAvg) / 4) * 100 : null;

  const disciplines = profile.disciplines || {};
  const results = [];
  for (const [group, entries] of Object.entries(disciplines)) {
    for (const entry of entries) {
      const parts = [entry.potential, gp, extPct, intPct].filter((v) => v != null && !Number.isNaN(v));
      const value = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
      results.push({ group, name: entry.name, value });
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
  module.exports = { computeTournamentValues, checkPraemierung };
}
