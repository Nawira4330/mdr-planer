// Wiederverwendbarer Rassen-Filter (Checkdrop-Häkchenliste), überall
// eingebunden, wo ein Pferd ausgewählt werden kann (Zuchtplaner Stute/
// Hengst, Turnierplaner, Zuchtbuch). Zeigt nur Rassen an, die in der
// jeweils übergebenen Pferdeliste tatsächlich vorkommen - "American Paint
// Horse" (APH) ist standardmäßig angehakt, falls vorhanden. Die Rasse
// "Rasselos" bekommt zusätzlich ein Dropdown für einen Reinrassigkeit-
// Schwellenwert (purebred_pct) - normales Häkchen ansonsten, beliebig mit
// anderen Rassen kombinierbar (kein Sonderzwang).
//
// Nutzerwunsch: Rassen lassen sich auch AUSSCHLIESSEN - Dreifach-Zustand wie
// beim Schlagwort-Filter: erster Klick = einschließen (grün, ✓), zweiter =
// ausschließen (rot, ✕), dritter = neutral. Ausgeschlossene Rassen fallen
// immer raus, eingeschlossene wirken wie bisher (ODER); beides ist
// kombinierbar. Nur Ausschlüsse gesetzt = alle übrigen Rassen bleiben.
//
// Nutzerwunsch: bei "Rasselos" lassen sich zusätzlich die ERLAUBTEN Rassen
// wählen. Rasselose Pferde sind Mischlinge - ihre Zusammensetzung steht im
// Feld breed_composition (Text wie "50.00% Knabstrupper, 50.00% American
// Paint Horse", siehe parseBreedComposition in der MDR-Datenbank). Unter dem
// Schwellenwert erscheint eine Liste aller Rassen, die in den Mischungen der
// geladenen rasselosen Pferde vorkommen; wird dort etwas angehakt, bleiben
// nur rasselose Pferde übrig, deren Mischung AUSSCHLIESSLICH aus erlaubten
// Rassen besteht. Ohne Häkchen keine Einschränkung. Pferde ohne erfasste
// Rasseanteile lassen sich nicht prüfen und fallen bei aktiver Einschränkung
// raus. Die Liste erscheint nur, wo die Seite breed_composition mitlädt.

const RASSELOS_LABEL = 'Rasselos';
const RASSELOS_THRESHOLDS = [
  { value: '', label: 'Alle' },
  { value: 'gt25', label: '> 25%' },
  { value: 'lt25', label: '< 25%' },
  { value: 'gt50', label: '> 50%' },
  { value: 'lt50', label: '< 50%' },
  { value: 'gt75', label: '> 75%' },
  { value: 'lt75', label: '< 75%' },
];

function isDefaultBreedSelection(breed) {
  const b = (breed || '').toUpperCase();
  return b.includes('APH') || b === 'AMERICAN PAINT HORSE';
}

function matchesRasselosThreshold(pct, threshold) {
  if (!threshold) return true;
  if (pct == null) return false;
  const direction = threshold.startsWith('gt') ? '>' : '<';
  const num = parseInt(threshold.slice(2), 10);
  return direction === '>' ? pct > num : pct < num;
}

// "50.00% Knabstrupper, 25% American Paint Horse" -> ['Knabstrupper',
// 'American Paint Horse']; leer/unbekannt -> [].
function rasselosMixBreeds(horse) {
  const text = horse?.breed_composition;
  if (!text) return [];
  return text.split(',')
    .map((part) => part.trim().match(/^[\d.,]+\s*%\s+(.+)$/))
    .filter(Boolean)
    .map((m) => m[1].trim());
}

function escapeHtmlBreed(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// rootEl: Element mit der Struktur <div class="checkdrop">
//   <button class="checkdrop-toggle">Alle</button>
//   <div class="checkdrop-panel" hidden></div>
// </div>
// initialSelection (optional): Array von Rassen ODER eine Funktion, die ein
// solches Array liefert (wird erst beim ersten setHorses()-Aufruf
// ausgewertet, z.B. um von einem anderen, bereits initialisierten
// Rassen-Filter zu übernehmen) - überschreibt dann die sonst übliche
// APH-Standardauswahl. Nur die Erstbefüllung wird davon beeinflusst, spätere
// manuelle Änderungen bleiben unangetastet.
function createBreedFilter(rootEl, { onChange, initialSelection } = {}) {
  const toggle = rootEl.querySelector('.checkdrop-toggle');
  const panel = rootEl.querySelector('.checkdrop-panel');
  let breeds = [];
  let selected = new Set();
  let excluded = new Set();
  let rasselosThreshold = '';
  let mixBreeds = []; // Rassen, die in den Mischungen der geladenen Rasselosen vorkommen
  let allowedMix = new Set();
  let initialized = false;

  const stateOf = (b) => (selected.has(b) ? 'include' : excluded.has(b) ? 'exclude' : 'neutral');

  function render() {
    if (!breeds.length) {
      panel.innerHTML = '<div class="checkdrop-empty">Keine Rassen vorhanden</div>';
      updateToggleLabel();
      return;
    }
    panel.innerHTML = '<div class="checkdrop-empty">Klick = nur diese, zweiter Klick = ausschließen</div>' + breeds.map((b) => {
      const isRasselos = b === RASSELOS_LABEL;
      const state = stateOf(b);
      let html = `<div class="checkdrop-item checkdrop-tristate" data-value="${escapeHtmlBreed(b)}" data-state="${state}" role="button" tabindex="0">
        <span class="tristate-box"></span><span>${escapeHtmlBreed(b)}</span>
      </div>`;
      // Schwellenwert/erlaubte Mix-Rassen gelten nur, solange "Rasselos"
      // eingeschlossen ist (bei ausgeschlossen/neutral ohne Wirkung).
      if (isRasselos && state === 'include') {
        html += `<select class="rasselos-threshold" style="margin:0 0 0.3rem 1.6rem; width:calc(100% - 1.6rem);">
          ${RASSELOS_THRESHOLDS.map((t) => `<option value="${t.value}"${t.value === rasselosThreshold ? ' selected' : ''}>${escapeHtmlBreed(t.label)}</option>`).join('')}
        </select>`;
        if (mixBreeds.length) {
          html += `<div class="rasselos-allowed">
            <div class="checkdrop-empty">Erlaubte Rassen im Mix (leer = alle):</div>
            ${mixBreeds.map((m) => `<label class="checkdrop-item">
              <input type="checkbox" data-allowed-mix value="${escapeHtmlBreed(m)}" ${allowedMix.has(m) ? 'checked' : ''} />
              <span>${escapeHtmlBreed(m)}</span>
            </label>`).join('')}
          </div>`;
        }
      }
      return html;
    }).join('');
    updateToggleLabel();
  }

  // Ein Klick zyklt neutral -> einschließen -> ausschließen -> neutral (wie
  // der Schlagwort-Filter und die Farbwünsche im Zuchtplaner).
  function cycle(item) {
    const b = item.dataset.value;
    const state = stateOf(b);
    selected.delete(b);
    excluded.delete(b);
    if (state === 'neutral') selected.add(b);
    else if (state === 'include') excluded.add(b);
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
  panel.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches && t.matches('input[data-allowed-mix]')) {
      if (t.checked) allowedMix.add(t.value); else allowedMix.delete(t.value);
      render();
      if (onChange) onChange();
    } else if (t.matches && t.matches('.rasselos-threshold')) {
      rasselosThreshold = t.value;
      if (onChange) onChange();
    }
  });

  function updateToggleLabel() {
    if (!selected.size && !excluded.size) {
      toggle.textContent = 'Alle';
      toggle.removeAttribute('title');
      return;
    }
    // Reihenfolge wie in "breeds" (alphabetisch), nicht wie angeklickt.
    const parts = [];
    if (selected.size) parts.push(breeds.filter((b) => selected.has(b)).join(', '));
    if (excluded.size) parts.push('ohne: ' + breeds.filter((b) => excluded.has(b)).join(', '));
    const label = parts.join(' | ');
    toggle.textContent = label;
    toggle.title = label; // volle Liste per Hover, falls der Button die Namen abschneidet
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!rootEl.contains(e.target)) panel.hidden = true;
  });

  return {
    // Baut die Rassenliste aus den tatsächlich vorhandenen Werten neu auf.
    // Die Auswahl selbst wird nur beim allerersten Aufruf mit der
    // Standardauswahl (APH) vorbelegt - bei erneutem Aufruf (z.B. nach
    // Neuladen) bleiben bereits getroffene Haekchen erhalten, nur nicht
    // mehr vorhandene Rassen fallen aus der Auswahl.
    setHorses(horses) {
      breeds = [...new Set((horses || []).map((h) => h.breed).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
      mixBreeds = [...new Set((horses || []).filter((h) => h.breed === RASSELOS_LABEL).flatMap(rasselosMixBreeds))]
        .sort((a, b) => a.localeCompare(b, 'de'));
      allowedMix = new Set([...allowedMix].filter((m) => mixBreeds.includes(m)));
      if (!initialized) {
        const seed = typeof initialSelection === 'function' ? initialSelection() : initialSelection;
        // Array.isArray statt "seed && seed.length" - so lässt sich ein
        // bewusst LEERES Array ("Alle Rassen", z.B. aus dem gespeicherten
        // preferred_breeds-Nutzer-Setting) von "gar keine Vorgabe vorhanden"
        // (null/undefined, z.B. Gast ohne Login) unterscheiden. Nur im
        // zweiten Fall greift der APH-Standard.
        if (Array.isArray(seed)) {
          breeds.forEach((b) => { if (seed.includes(b)) selected.add(b); });
        } else {
          breeds.forEach((b) => { if (isDefaultBreedSelection(b)) selected.add(b); });
        }
        initialized = true;
      } else {
        selected = new Set([...selected].filter((b) => breeds.includes(b)));
        excluded = new Set([...excluded].filter((b) => breeds.includes(b)));
      }
      render();
    },
    matches(horse) {
      const breed = horse.breed;
      if (breed && excluded.has(breed)) return false;
      if (!selected.size) return true; // keine Einschließen-Auswahl -> alles übrige zeigen
      if (!breed || !selected.has(breed)) return false;
      if (breed === RASSELOS_LABEL) {
        if (!matchesRasselosThreshold(horse.purebred_pct, rasselosThreshold)) return false;
        if (allowedMix.size) {
          const mix = rasselosMixBreeds(horse);
          return mix.length > 0 && mix.every((m) => allowedMix.has(m));
        }
      }
      return true;
    },
    getSelected() {
      return [...selected];
    },
    getExcluded() {
      return [...excluded];
    },
    getAllowedMix() {
      return [...allowedMix];
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createBreedFilter };
}
