// Wiederverwendbarer Schlagwörter-Filter (Checkdrop-Häkchenliste), nach
// demselben Muster wie js/breedFilter.js - überall eingebunden, wo auch ein
// Rassen-Filter existiert. Anders als Rassen sind Schlagwörter eine feste,
// kleine Liste (HORSE_TAG_OPTIONS aus js/parser.js) statt aus den geladenen
// Pferden abgeleitet - die Optionen stehen daher schon beim Erzeugen fest
// (kein setHorses() nötig) und bleiben auch sichtbar, wenn aktuell kein
// Pferd das jeweilige Schlagwort trägt. "Kein Schlagwort" filtert auf
// Pferde ganz ohne Eintrag (Muster/ODER-Semantik wie matchesTags in
// MDR-Datenbank/js/list.js).
//
// Nutzerwunsch: Schlagwörter lassen sich zusätzlich AUSSCHLIESSEN. Je Zeile
// gibt es zwei unabhängige Häkchen - "einschließen" (wie bisher: mindestens
// eines der angehakten Schlagwörter muss zutreffen) und "✕ ausschließen"
// (trifft eines der so markierten Schlagwörter zu, fällt das Pferd raus,
// auch wenn es die Einschließen-Bedingung erfüllt). Ein Schlagwort kann
// nie gleichzeitig ein- und ausgeschlossen sein (das eine Häkchen nimmt das
// andere zurück). "Kein Schlagwort" ausschließen = nur Pferde MIT
// mindestens einem Schlagwort.

const TAG_FILTER_NONE = '__none__';

function escapeHtmlTagFilter(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// rootEl: Element mit der Struktur <div class="checkdrop">
//   <button class="checkdrop-toggle">Alle</button>
//   <div class="checkdrop-panel" hidden></div>
// </div>
function createTagFilter(rootEl, { onChange } = {}) {
  const toggle = rootEl.querySelector('.checkdrop-toggle');
  const panel = rootEl.querySelector('.checkdrop-panel');
  const options = [...HORSE_TAG_OPTIONS.map((t) => t.label), TAG_FILTER_NONE];
  const optionLabel = (v) => (v === TAG_FILTER_NONE ? 'Kein Schlagwort' : v);
  let selected = new Set();
  let excluded = new Set();

  function render() {
    const rows = options.map((v) => `<div class="checkdrop-item tag-filter-row">
        <label class="tag-filter-include">
          <input type="checkbox" data-mode="in" value="${escapeHtmlTagFilter(v)}" ${selected.has(v) ? 'checked' : ''} />
          <span>${escapeHtmlTagFilter(optionLabel(v))}</span>
        </label>
        <label class="tag-filter-exclude" title="Dieses Schlagwort ausschließen">
          <input type="checkbox" data-mode="ex" value="${escapeHtmlTagFilter(v)}" ${excluded.has(v) ? 'checked' : ''} />
          <span>✕</span>
        </label>
      </div>`).join('');
    panel.innerHTML = `<div class="checkdrop-empty">Häkchen = nur diese zeigen, ✕ = ausschließen</div>${rows}`;

    panel.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const target = cb.dataset.mode === 'ex' ? excluded : selected;
        const other = cb.dataset.mode === 'ex' ? selected : excluded;
        if (cb.checked) {
          target.add(cb.value);
          other.delete(cb.value);
        } else {
          target.delete(cb.value);
        }
        render();
        if (onChange) onChange();
      });
    });
    updateToggleLabel();
  }

  function updateToggleLabel() {
    if (!selected.size && !excluded.size) {
      toggle.textContent = 'Alle';
      toggle.removeAttribute('title');
      return;
    }
    const parts = [];
    if (selected.size) parts.push(options.filter((v) => selected.has(v)).map(optionLabel).join(', '));
    if (excluded.size) parts.push('ohne: ' + options.filter((v) => excluded.has(v)).map(optionLabel).join(', '));
    const label = parts.join(' | ');
    toggle.textContent = label;
    toggle.title = label;
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!rootEl.contains(e.target)) panel.hidden = true;
  });

  render();

  return {
    matches(horse) {
      const tags = horse.tags || [];
      const hit = (v) => (v === TAG_FILTER_NONE ? !tags.length : tags.some((t) => t.label === v));
      if (excluded.size && [...excluded].some(hit)) return false;
      if (!selected.size) return true; // keine Einschließen-Auswahl -> alles übrige zeigen
      return [...selected].some(hit);
    },
    getSelected() {
      return [...selected];
    },
    getExcluded() {
      return [...excluded];
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createTagFilter };
}
