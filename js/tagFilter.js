// Wiederverwendbarer Schlagwörter-Filter (Checkdrop-Häkchenliste), nach
// demselben Muster wie js/breedFilter.js - überall eingebunden, wo auch ein
// Rassen-Filter existiert. Anders als Rassen sind Schlagwörter eine feste,
// kleine Liste (HORSE_TAG_OPTIONS aus js/parser.js) statt aus den geladenen
// Pferden abgeleitet - die Optionen stehen daher schon beim Erzeugen fest
// (kein setHorses() nötig) und bleiben auch sichtbar, wenn aktuell kein
// Pferd das jeweilige Schlagwort trägt. "Kein Schlagwort" filtert auf
// Pferde ganz ohne Eintrag (Muster/ODER-Semantik wie matchesTags in
// MDR-Datenbank/js/list.js).

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

  function render() {
    panel.innerHTML = options.map((v) => {
      const checked = selected.has(v);
      return `<label class="checkdrop-item">
        <input type="checkbox" value="${escapeHtmlTagFilter(v)}" ${checked ? 'checked' : ''} />
        <span>${escapeHtmlTagFilter(optionLabel(v))}</span>
      </label>`;
    }).join('');

    panel.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
        render();
        if (onChange) onChange();
      });
    });
    updateToggleLabel();
  }

  function updateToggleLabel() {
    if (!selected.size) {
      toggle.textContent = 'Alle';
      toggle.removeAttribute('title');
      return;
    }
    const label = options.filter((v) => selected.has(v)).map(optionLabel).join(', ');
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
      if (!selected.size) return true; // kein Filter aktiv -> alles zeigen
      const tags = horse.tags || [];
      return [...selected].some((v) => {
        if (v === TAG_FILTER_NONE) return !tags.length;
        return tags.some((t) => t.label === v);
      });
    },
    getSelected() {
      return [...selected];
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createTagFilter };
}
