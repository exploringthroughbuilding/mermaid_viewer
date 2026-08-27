// Persisted UI preferences: pointer sensitivity, panel sizes and index
// settings, plus the drag / keyboard resizers that change them.
const sensitivityStorageKey = "mermaid-atlas-interaction-settings";
const panelSizeStorageKey = "mermaid-atlas-panel-sizes";
const indexSettingsStorageKey = "mermaid-atlas-index-settings:v1";

const defaultSensitivity = { zoom: 1, pan: 1, device: "trackpad" };
const defaultPanelSizes = { source: 228, index: 136, sidebar: 360 };
const defaultIndexSettings = { grouped: false, sort: "label-asc" };
const allowedSorts = new Set(["label-asc", "label-desc", "connections-desc", "connections-asc"]);

function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Preferences still apply for the session when storage is unavailable.
  }
}

const clamp = (value, min, max, fallback) => Math.min(max, Math.max(min, Number(value) || fallback));

export function createPanels(elements, { onSidebarResize, onIndexSettingsChange }) {
  const stored = readStorage(sensitivityStorageKey);
  const sensitivity = {
    zoom: clamp(stored?.zoom, 0.25, 3, defaultSensitivity.zoom),
    pan: clamp(stored?.pan, 0.25, 2.5, defaultSensitivity.pan),
    device: stored?.device === "mouse" ? "mouse" : "trackpad",
  };
  const storedSizes = readStorage(panelSizeStorageKey);
  const panelSizes = {
    source: clamp(storedSizes?.source, 190, 500, defaultPanelSizes.source),
    index: clamp(storedSizes?.index, 80, 500, defaultPanelSizes.index),
    sidebar: clamp(storedSizes?.sidebar, 280, 760, defaultPanelSizes.sidebar),
  };
  const storedIndex = readStorage(indexSettingsStorageKey);
  const indexSettings = {
    grouped: storedIndex?.grouped === true,
    sort: allowedSorts.has(storedIndex?.sort) ? storedIndex.sort : defaultIndexSettings.sort,
  };

  const updateSensitivityControls = () => {
    elements.zoomSensitivity.value = sensitivity.zoom;
    elements.panSensitivity.value = sensitivity.pan;
    elements.zoomSensitivityValue.value = `${sensitivity.zoom.toFixed(2)}×`;
    elements.zoomSensitivityValue.textContent = elements.zoomSensitivityValue.value;
    elements.panSensitivityValue.value = `${sensitivity.pan.toFixed(2)}×`;
    elements.panSensitivityValue.textContent = elements.panSensitivityValue.value;
    elements.pointerDevice.value = sensitivity.device;
    writeStorage(sensitivityStorageKey, sensitivity);
  };

  const updateIndexControls = () => {
    elements.groupIndex.setAttribute("aria-pressed", String(indexSettings.grouped));
    elements.groupIndex.classList.toggle("active", indexSettings.grouped);
    elements.indexSort.value = indexSettings.sort;
    writeStorage(indexSettingsStorageKey, indexSettings);
  };

  const applyPanelSizes = () => {
    elements.rail.style.setProperty("--source-panel-height", `${panelSizes.source}px`);
    elements.rail.style.setProperty("--index-panel-height", `${panelSizes.index}px`);
    elements.workbench.style.setProperty("--sidebar-width", `${panelSizes.sidebar}px`);
    elements.panelResizers.forEach((resizer) => resizer.setAttribute("aria-valuenow", Math.round(panelSizes[resizer.dataset.resize])));
    writeStorage(panelSizeStorageKey, panelSizes);
  };

  const panelSizeLimit = (section) => {
    const brandHeight = elements.rail.querySelector(".brand").getBoundingClientRect().height;
    const fixedOther = section === "source" ? panelSizes.index : panelSizes.source;
    const available = elements.rail.clientHeight - brandHeight - fixedOther - 110 - 14;
    return Math.max(section === "source" ? 190 : 80, Math.min(500, available));
  };

  const setPanelSize = (section, value) => {
    panelSizes[section] = Math.min(panelSizeLimit(section), Math.max(section === "source" ? 190 : 80, value));
    applyPanelSizes();
  };

  const setSidebarWidth = (value) => {
    const maximum = Math.max(280, Math.min(760, window.innerWidth - 420));
    panelSizes.sidebar = Math.min(maximum, Math.max(280, value));
    applyPanelSizes();
    onSidebarResize?.();
  };

  const bindResizer = (resizer, axis, getStart, setValue) => {
    resizer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const origin = axis === "x" ? event.clientX : event.clientY;
      const start = getStart();
      resizer.setPointerCapture(event.pointerId);
      resizer.classList.add("active");
      document.body.classList.add(axis === "x" ? "resizing-sidebar" : "resizing-panels");
      const move = (moveEvent) => setValue(start + (axis === "x" ? moveEvent.clientX : moveEvent.clientY) - origin);
      const finish = (upEvent) => {
        resizer.releasePointerCapture(upEvent.pointerId);
        resizer.classList.remove("active");
        document.body.classList.remove("resizing-sidebar", "resizing-panels");
        resizer.removeEventListener("pointermove", move);
        resizer.removeEventListener("pointerup", finish);
        resizer.removeEventListener("pointercancel", finish);
      };
      resizer.addEventListener("pointermove", move);
      resizer.addEventListener("pointerup", finish);
      resizer.addEventListener("pointercancel", finish);
    });
  };

  elements.panelResizers.forEach((resizer) => {
    const section = resizer.dataset.resize;
    bindResizer(resizer, "y", () => panelSizes[section], (value) => setPanelSize(section, value));
    resizer.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      setPanelSize(section, panelSizes[section] + (event.key === "ArrowDown" ? 1 : -1) * (event.shiftKey ? 25 : 8));
    });
    resizer.addEventListener("dblclick", () => {
      panelSizes[section] = defaultPanelSizes[section];
      applyPanelSizes();
    });
  });
  bindResizer(elements.sidebarResizer, "x", () => panelSizes.sidebar, setSidebarWidth);
  elements.sidebarResizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setSidebarWidth(panelSizes.sidebar + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 40 : 10));
  });
  elements.sidebarResizer.addEventListener("dblclick", () => setSidebarWidth(defaultPanelSizes.sidebar));

  elements.zoomSensitivity.addEventListener("input", () => {
    sensitivity.zoom = Number(elements.zoomSensitivity.value);
    updateSensitivityControls();
  });
  elements.panSensitivity.addEventListener("input", () => {
    sensitivity.pan = Number(elements.panSensitivity.value);
    updateSensitivityControls();
  });
  elements.pointerDevice.addEventListener("change", () => {
    sensitivity.device = elements.pointerDevice.value;
    updateSensitivityControls();
  });
  elements.resetSettings.addEventListener("click", () => {
    Object.assign(sensitivity, defaultSensitivity);
    updateSensitivityControls();
  });
  elements.openSettings.addEventListener("click", () => elements.settingsDialog.showModal());
  elements.settingsDialog.addEventListener("click", (event) => {
    if (event.target === elements.settingsDialog) elements.settingsDialog.close();
  });
  elements.groupIndex.addEventListener("click", () => {
    indexSettings.grouped = !indexSettings.grouped;
    updateIndexControls();
    onIndexSettingsChange?.();
  });
  elements.indexSort.addEventListener("change", () => {
    indexSettings.sort = allowedSorts.has(elements.indexSort.value) ? elements.indexSort.value : defaultIndexSettings.sort;
    updateIndexControls();
    onIndexSettingsChange?.();
  });

  updateSensitivityControls();
  updateIndexControls();
  applyPanelSizes();

  return { sensitivity, indexSettings };
}
