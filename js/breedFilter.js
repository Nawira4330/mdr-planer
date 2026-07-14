// Wiederverwendbarer Rassen-Filter (Checkdrop-Häkchenliste), überall
// eingebunden, wo ein Pferd ausgewählt werden kann (Zuchtplaner Stute/
// Hengst, Turnierplaner, Zuchtbuch). Zeigt nur Rassen an, die in der
// jeweils übergebenen Pferdeliste tatsächlich vorkommen - "American Paint
// Horse" (APH) ist standardmäßig angehakt, falls vorhanden. Die Rasse
// "Rasselos" bekommt zusätzlich ein Dropdown für einen Reinrassigkeit-
// Schwellenwert (purebred_pct) - normales Häkchen ansonsten, beliebig mit
// anderen Rassen kombinierbar (kein Sonderzwang).

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
  let rasselosThreshold = '';
  let initialized = false;

  function render() {
    if (!breeds.length) {
      panel.innerHTML = '<div class="checkdrop-empty">Keine Rassen vorhanden</div>';
      updateToggleLabel();
      return;
    }
    panel.innerHTML = breeds.map((b) => {
      const isRasselos = b === RASSELOS_LABEL;
      const checked = selected.has(b);
      let html = `<label class="checkdrop-item">
        <input type="checkbox" value="${escapeHtmlBreed(b)}" ${checked ? 'checked' : ''} />
        <span>${escapeHtmlBreed(b)}</span>
      </label>`;
      if (isRasselos) {
        html += `<select class="rasselos-threshold" ${checked ? '' : 'disabled'} style="margin:0 0 0.3rem 1.6rem; width:calc(100% - 1.6rem);">
          ${RASSELOS_THRESHOLDS.map((t) => `<option value="${t.value}"${t.value === rasselosThreshold ? ' selected' : ''}>${escapeHtmlBreed(t.label)}</option>`).join('')}
        </select>`;
      }
      return html;
    }).join('');

    panel.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
        render();
        if (onChange) onChange();
      });
    });
    const rasselosSelect = panel.querySelector('.rasselos-threshold');
    if (rasselosSelect) {
      rasselosSelect.addEventListener('change', () => {
        rasselosThreshold = rasselosSelect.value;
        if (onChange) onChange();
      });
    }
    updateToggleLabel();
  }

  function updateToggleLabel() {
    toggle.textContent = selected.size ? `${selected.size} ausgewählt` : 'Alle';
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
      if (!initialized) {
        const seed = typeof initialSelection === 'function' ? initialSelection() : initialSelection;
        if (seed && seed.length) {
          breeds.forEach((b) => { if (seed.includes(b)) selected.add(b); });
        } else {
          breeds.forEach((b) => { if (isDefaultBreedSelection(b)) selected.add(b); });
        }
        initialized = true;
      } else {
        selected = new Set([...selected].filter((b) => breeds.includes(b)));
      }
      render();
    },
    matches(horse) {
      if (!selected.size) return true; // kein Filter aktiv -> alles zeigen
      const breed = horse.breed;
      if (!breed || !selected.has(breed)) return false;
      if (breed === RASSELOS_LABEL) return matchesRasselosThreshold(horse.purebred_pct, rasselosThreshold);
      return true;
    },
    getSelected() {
      return [...selected];
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createBreedFilter };
}
