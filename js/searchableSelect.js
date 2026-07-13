// Durchsuchbares Auswahlfeld (Text-Input + Ergebnisliste) für lange
// Pferdelisten. Im Gegensatz zum nativen <select>-Tippverhalten des
// Browsers (das nur ab dem ANFANG des Textes springt) filtert dies nach
// Vorkommen der Eingabe an BELIEBIGER Stelle im Namen.
//
// inputEl: <input type="text">, panelEl: leeres <div> direkt darunter für
// die Ergebnisliste (Positionierung per CSS-Klasse "searchselect").
function createSearchableSelect(inputEl, panelEl, { onChange } = {}) {
  let items = []; // [{ id, label }]
  let filtered = [];
  let selectedId = '';
  let activeIndex = -1;

  function matches(text) {
    const q = text.trim().toLowerCase();
    return q ? items.filter((it) => it.label.toLowerCase().includes(q)) : items;
  }

  function renderPanel() {
    filtered = matches(inputEl.value);
    activeIndex = -1;
    panelEl.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'checkdrop-empty';
      empty.textContent = 'Keine Treffer';
      panelEl.appendChild(empty);
    } else {
      filtered.forEach((it) => {
        const row = document.createElement('div');
        row.className = 'searchselect-item';
        row.textContent = it.label;
        // mousedown statt click, damit die Auswahl vor dem blur-Event des
        // Inputs (das das Panel sonst zuerst schließen würde) verarbeitet wird.
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          choose(it);
        });
        panelEl.appendChild(row);
      });
    }
    panelEl.hidden = false;
  }

  function highlight(index) {
    const rows = panelEl.querySelectorAll('.searchselect-item');
    rows.forEach((r) => r.classList.remove('active'));
    activeIndex = index;
    if (index >= 0 && index < rows.length) {
      rows[index].classList.add('active');
      rows[index].scrollIntoView({ block: 'nearest' });
    }
  }

  function choose(item) {
    selectedId = item ? item.id : '';
    inputEl.value = item ? item.label : '';
    panelEl.hidden = true;
    if (onChange) onChange(selectedId);
  }

  inputEl.addEventListener('input', () => {
    selectedId = '';
    renderPanel();
  });
  // Öffnet das Dropdown und markiert den kompletten Text, damit ein bereits
  // ausgewählter Name nicht erst manuell gelöscht werden muss - der nächste
  // Tastendruck ersetzt ihn direkt und startet eine neue Suche. Das
  // Markieren geschieht per setTimeout(0), da der Browser die Cursor-
  // Position beim Klick sonst NACH unserem focus-Handler neu setzt und die
  // Markierung damit wieder aufheben würde.
  function openAndSelectAll() {
    renderPanel();
    setTimeout(() => inputEl.select(), 0);
  }
  inputEl.addEventListener('focus', openAndSelectAll);
  inputEl.addEventListener('click', openAndSelectAll);
  inputEl.addEventListener('blur', () => {
    setTimeout(() => { panelEl.hidden = true; }, 150);
  });
  inputEl.addEventListener('keydown', (e) => {
    if (panelEl.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      renderPanel();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlight(Math.min(activeIndex + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && filtered[activeIndex]) {
        e.preventDefault();
        choose(filtered[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      panelEl.hidden = true;
    }
  });

  return {
    setItems(newItems) {
      items = newItems;
    },
    getValue() {
      return selectedId;
    },
    setValue(id) {
      choose(items.find((it) => it.id === id) || null);
    },
    clear() {
      choose(null);
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createSearchableSelect };
}
