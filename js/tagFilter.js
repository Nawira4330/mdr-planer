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
// Nutzerwunsch: Schlagwörter lassen sich zusätzlich AUSSCHLIESSEN - wie bei
// den Farbwünschen im Zuchtplaner und den Genetik-Filtern der MDR-Datenbank
// per Dreifach-Zustand: ein Klick auf ein Schlagwort = einschließen (grün,
// ✓), ein zweiter Klick = ausschließen (rot, ✕), ein dritter = wieder
// neutral. Einschließen (ODER, mindestens eines muss zutreffen) und
// Ausschließen (trifft eines zu, fällt das Pferd raus) lassen sich
// kombinieren. "Kein Schlagwort" ausschließen = nur Pferde MIT mindestens
// einem Schlagwort.

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

  const stateOf = (v) => (selected.has(v) ? 'include' : excluded.has(v) ? 'exclude' : 'neutral');

  function render() {
    panel.innerHTML = '<div class="checkdrop-empty">Klick = nur diese, zweiter Klick = ausschließen</div>' +
      options.map((v) => `<div class="checkdrop-item checkdrop-tristate" data-value="${escapeHtmlTagFilter(v)}" data-state="${stateOf(v)}" role="button" tabindex="0">
        <span class="tristate-box"></span><span>${escapeHtmlTagFilter(optionLabel(v))}</span>
      </div>`).join('');
    updateToggleLabel();
  }

  function cycle(item) {
    const v = item.dataset.value;
    const state = stateOf(v);
    selected.delete(v);
    excluded.delete(v);
    if (state === 'neutral') selected.add(v);
    else if (state === 'include') excluded.add(v);
    render();
    if (onChange) onChange();
  }

  // Delegiert auf das Panel (render() baut den Inhalt bei jeder Änderung neu).
  panel.addEventListener('click', (e) => {
    const item = e.target.closest('.checkdrop-tristate');
    if (item) cycle(item);
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('.checkdrop-tristate');
    if (!item) return;
    e.preventDefault();
    cycle(item);
  });

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
