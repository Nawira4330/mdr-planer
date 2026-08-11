// Schlagwort-Vorschlag: schreibt einen Eintrag in die "tag_suggestions"-
// Tabelle der MDR-Datenbank (migration_023_tag_suggestions.sql +
// migration_024_tag_suggestions_authenticated.sql). Nutzerwunsch: nur für
// in der Pferdedatenbank eingeloggte Nutzer sichtbar/nutzbar (siehe
// js/authStatus.js) - anders als der ältere Decksprung-Button
// (js/zuchtplaner.js), der bewusst auch ohne Login funktioniert. MDR-
// Planer selbst liest/ändert horses.tags NICHT - der Vorschlag erscheint
// nur als Hinweis in der MDR-Datenbank zum manuellen Übernehmen oder
// Verwerfen. Labels sind bewusst eine feste Auswahl (kein Freitext),
// identisch zu HORSE_TAG_OPTIONS in der MDR-Datenbank (js/parser.js dort).
const TAG_SUGGESTION_LABELS = ['Verkauf', 'Reserviert', 'Bleibt', 'GBH'];

// horseId fehlt bei datenbankfremden (per Freitext eingelesenen) Pferden -
// dafür gibt es keinen Vorschlag-Button, da tag_suggestions.horse_id eine
// echte Pferde-ID braucht. Ohne Login gibt es statt des Buttons nur einen
// Hinweistext (die Datenbank würde den Insert ohnehin per RLS ablehnen).
// Nutzerwunsch: der Button soll außerdem nur für den Besitzer des jeweiligen
// Pferdes erscheinen, nicht für jedes eingeloggte Konto (siehe isOwnerOf in
// js/authStatus.js) - bei fremden Pferden erscheint dafür gar nichts (kein
// Hinweistext), um die Liste bei vielen fremden Pferden nicht mit sich
// wiederholenden Hinweisen zuzumüllen.
function tagSuggestButtonHtml(horseId, owner) {
  if (!horseId) return '';
  if (!isLoggedIn()) {
    return '<span class="small muted">Schlagwort vorschlagen: nur für in der Pferdedatenbank eingeloggte Nutzer.</span>';
  }
  if (!isOwnerOf(owner)) return '';
  const options = TAG_SUGGESTION_LABELS.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
  return `<span class="tag-suggest-wrap" data-horse-id="${escapeHtml(horseId)}">
    <button type="button" class="btn secondary tag-suggest-toggle">Schlagwort vorschlagen</button>
    <span class="tag-suggest-form" hidden>
      <select class="tag-suggest-label">${options}</select>
      <input type="text" class="tag-suggest-note" placeholder="Zusatztext (optional)" />
      <button type="button" class="btn tag-suggest-confirm">Vorschlagen</button>
      <button type="button" class="btn secondary tag-suggest-cancel">Abbrechen</button>
    </span>
    <span class="small muted tag-suggest-status"></span>
  </span>`;
}

// "source" (z.B. "Zuchtbuch"/"Fohlen-Tracker"/"Verwandtschaftsmatrix")
// wird einmal pro Seite fest übergeben und bei jedem Vorschlag mitgesendet
// - rein informativ für die Anzeige in der MDR-Datenbank, keine Logik
// hängt daran. Delegiert auf document, da die Buttons bei jedem
// Neu-Rendern neu entstehen (Muster wie decksprung-btn in
// js/zuchtplaner.js).
function wireTagSuggestHandlers(source) {
  document.addEventListener('click', async (e) => {
    const toggle = e.target.closest('.tag-suggest-toggle');
    if (toggle) {
      const wrap = toggle.closest('.tag-suggest-wrap');
      toggle.hidden = true;
      wrap.querySelector('.tag-suggest-form').hidden = false;
      return;
    }
    const cancel = e.target.closest('.tag-suggest-cancel');
    if (cancel) {
      const wrap = cancel.closest('.tag-suggest-wrap');
      wrap.querySelector('.tag-suggest-form').hidden = true;
      wrap.querySelector('.tag-suggest-toggle').hidden = false;
      wrap.querySelector('.tag-suggest-status').textContent = '';
      return;
    }
    const confirmBtn = e.target.closest('.tag-suggest-confirm');
    if (confirmBtn) {
      const wrap = confirmBtn.closest('.tag-suggest-wrap');
      const horseId = wrap.dataset.horseId;
      const label = wrap.querySelector('.tag-suggest-label').value;
      const note = wrap.querySelector('.tag-suggest-note').value.trim();
      const statusEl = wrap.querySelector('.tag-suggest-status');

      confirmBtn.disabled = true;
      statusEl.textContent = 'Speichert…';
      const { error } = await supabaseClient.from('tag_suggestions').insert({
        horse_id: horseId, label, note: note || null, source,
      });
      confirmBtn.disabled = false;
      if (error) {
        statusEl.textContent = 'Fehler beim Speichern: ' + error.message;
        return;
      }
      wrap.querySelector('.tag-suggest-form').hidden = true;
      statusEl.textContent = '✓ Vorgeschlagen - wird in der Pferdedatenbank geprüft';
    }
  });
}
