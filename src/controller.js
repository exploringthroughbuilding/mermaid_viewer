import mermaid from "mermaid";
import elkLayouts from "@mermaid-js/layout-elk";

const sample = `flowchart LR
    Source[Paste Mermaid code] --> Render[Render locally]
    Render --> Explore[Pan and zoom]
    Render --> Select[Select a node]
    Select --> Neighbors[Inspect attached nodes]
    Explore --> Large[No 500-edge ceiling]
    Neighbors --> Large`;

const elements = {
  rail: document.querySelector(".rail"),
  workbench: document.querySelector(".workbench"),
  sidebarResizer: document.querySelector("#sidebar-resizer"),
  source: document.querySelector("#source"),
  sourceSize: document.querySelector("#source-size"),
  render: document.querySelector("#render"),
  file: document.querySelector("#file-input"),
  blockPickerWrap: document.querySelector("#block-picker-wrap"),
  blockPicker: document.querySelector("#block-picker"),
  viewport: document.querySelector("#viewport"),
  stage: document.querySelector("#stage"),
  canvasEmpty: document.querySelector("#canvas-empty"),
  status: document.querySelector("#status"),
  statusDot: document.querySelector("#status-dot"),
  stats: document.querySelector("#graph-stats"),
  search: document.querySelector("#node-search"),
  nodeList: document.querySelector("#node-list"),
  selection: document.querySelector("#selection-content"),
  clearSelection: document.querySelector("#clear-selection"),
  zoomLevel: document.querySelector("#zoom-level"),
  zoomIn: document.querySelector("#zoom-in"),
  zoomOut: document.querySelector("#zoom-out"),
  fit: document.querySelector("#fit"),
  actualSize: document.querySelector("#actual-size"),
  openSettings: document.querySelector("#open-settings"),
  settingsDialog: document.querySelector("#settings-dialog"),
  zoomSensitivity: document.querySelector("#zoom-sensitivity"),
  zoomSensitivityValue: document.querySelector("#zoom-sensitivity-value"),
  panSensitivity: document.querySelector("#pan-sensitivity"),
  panSensitivityValue: document.querySelector("#pan-sensitivity-value"),
  pointerDevice: document.querySelector("#pointer-device"),
  resetSettings: document.querySelector("#reset-settings"),
  panelResizers: [...document.querySelectorAll(".panel-resizer")],
};

let transform = { x: 0, y: 0, scale: 1 };
let graph = { nodes: new Map(), edges: [], incoming: new Map(), outgoing: new Map(), markerCache: new Map() };
let selectedKey = null;
let markdownBlocks = [];
let renderSequence = 0;
const sensitivityStorageKey = "mermaid-atlas-interaction-settings";
const defaultSensitivity = { zoom: 1, pan: 1, device: "trackpad" };
let sensitivity = loadSensitivity();
const panelSizeStorageKey = "mermaid-atlas-panel-sizes";
const defaultPanelSizes = { source: 228, index: 105, sidebar: 360 };
let panelSizes = loadPanelSizes();

function loadSensitivity() {
  try {
    const stored = JSON.parse(localStorage.getItem(sensitivityStorageKey));
    return {
      zoom: Math.min(3, Math.max(0.25, Number(stored?.zoom) || defaultSensitivity.zoom)),
      pan: Math.min(2.5, Math.max(0.25, Number(stored?.pan) || defaultSensitivity.pan)),
      device: stored?.device === "mouse" ? "mouse" : "trackpad",
    };
  } catch {
    return { ...defaultSensitivity };
  }
}

function updateSensitivityControls() {
  elements.zoomSensitivity.value = sensitivity.zoom;
  elements.panSensitivity.value = sensitivity.pan;
  elements.zoomSensitivityValue.value = `${sensitivity.zoom.toFixed(2)}×`;
  elements.zoomSensitivityValue.textContent = elements.zoomSensitivityValue.value;
  elements.panSensitivityValue.value = `${sensitivity.pan.toFixed(2)}×`;
  elements.panSensitivityValue.textContent = elements.panSensitivityValue.value;
  elements.pointerDevice.value = sensitivity.device;
  localStorage.setItem(sensitivityStorageKey, JSON.stringify(sensitivity));
}

function loadPanelSizes() {
  try {
    const stored = JSON.parse(localStorage.getItem(panelSizeStorageKey));
    return {
      source: Math.min(500, Math.max(190, Number(stored?.source) || defaultPanelSizes.source)),
      index: Math.min(500, Math.max(80, Number(stored?.index) || defaultPanelSizes.index)),
      sidebar: Math.min(760, Math.max(280, Number(stored?.sidebar) || defaultPanelSizes.sidebar)),
    };
  } catch {
    return { ...defaultPanelSizes };
  }
}

function applyPanelSizes() {
  elements.rail.style.setProperty("--source-panel-height", `${panelSizes.source}px`);
  elements.rail.style.setProperty("--index-panel-height", `${panelSizes.index}px`);
  elements.workbench.style.setProperty("--sidebar-width", `${panelSizes.sidebar}px`);
  elements.panelResizers.forEach((resizer) => {
    resizer.setAttribute("aria-valuenow", Math.round(panelSizes[resizer.dataset.resize]));
  });
  localStorage.setItem(panelSizeStorageKey, JSON.stringify(panelSizes));
}

function panelSizeLimit(section) {
  const brandHeight = elements.rail.querySelector(".brand").getBoundingClientRect().height;
  const fixedOther = section === "source" ? panelSizes.index : panelSizes.source;
  const minimumSelectionHeight = 110;
  const handlesHeight = 14;
  const available = elements.rail.clientHeight - brandHeight - fixedOther - minimumSelectionHeight - handlesHeight;
  return Math.max(section === "source" ? 190 : 80, Math.min(500, available));
}

function setPanelSize(section, value) {
  const minimum = section === "source" ? 190 : 80;
  panelSizes[section] = Math.min(panelSizeLimit(section), Math.max(minimum, value));
  applyPanelSizes();
}

function setSidebarWidth(value) {
  const maximum = Math.max(280, Math.min(760, window.innerWidth - 420));
  panelSizes.sidebar = Math.min(maximum, Math.max(280, value));
  applyPanelSizes();
  if (elements.stage.querySelector("svg")) applyTransform();
}

mermaid.registerLayoutLoaders(elkLayouts);
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  maxEdges: 20_000,
  maxTextSize: 5_000_000,
  deterministicIds: false,
  theme: "base",
  layout: "elk",
  flowchart: {
    defaultRenderer: "elk",
    htmlLabels: true,
    useMaxWidth: false,
    curve: "basis",
    nodeSpacing: 48,
    rankSpacing: 72,
  },
  themeVariables: {
    background: "#f7f8fa",
    primaryColor: "#eef4ff",
    primaryTextColor: "#172033",
    primaryBorderColor: "#59749b",
    lineColor: "#8997ab",
    secondaryColor: "#f1edff",
    tertiaryColor: "#e9f7f2",
    clusterBkg: "#f3f5f8",
    clusterBorder: "#aab5c4",
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif",
  },
});

function setStatus(message, state = "idle") {
  elements.status.textContent = message;
  elements.statusDot.className = `status-dot ${state}`;
}

function extractMermaidBlocks(value) {
  return [...value.matchAll(/```mermaid\s*\n([\s\S]*?)```/gi)].map((match) => match[1].trim());
}

function activeSource() {
  return markdownBlocks.length ? markdownBlocks[Number(elements.blockPicker.value) || 0] : elements.source.value.trim();
}

function updateSourceMeta() {
  elements.sourceSize.textContent = `${elements.source.value.length.toLocaleString()} chars`;
}

function updateBlockPicker() {
  markdownBlocks = extractMermaidBlocks(elements.source.value);
  elements.blockPickerWrap.hidden = markdownBlocks.length === 0;
  elements.blockPicker.innerHTML = markdownBlocks
    .map((block, index) => `<option value="${index}">Diagram ${index + 1} · ${block.split("\n")[0]}</option>`)
    .join("");
}

function canonical(value) {
  const flowchartMarker = "-flowchart-";
  const markerIndex = value.indexOf(flowchartMarker);
  const withoutRenderPrefix = markerIndex >= 0
    ? value.slice(markerIndex + flowchartMarker.length)
    : value.replace(/^flowchart-/, "");
  return withoutRenderPrefix.replace(/-\d+$/, "");
}

function nodeKey(node) {
  return node.dataset.id || canonical(node.id);
}

function indexRenderedGraph() {
  const svg = elements.stage.querySelector("svg");
  const nodes = new Map();

  svg.querySelectorAll("g.node").forEach((node) => {
    const key = nodeKey(node);
    const label = (node.querySelector(".nodeLabel")?.textContent || node.textContent || key).trim().replace(/\s+/g, " ");
    node.dataset.graphKey = key;
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `${label}. Select to show attached nodes.`);
    nodes.set(key, { key, label, element: node });
  });

  const resolveKey = (candidate) => {
    if (nodes.has(candidate)) return candidate;
    const normalized = canonical(candidate);
    return [...nodes.keys()].find((key) => canonical(key) === normalized) || candidate;
  };

  const nodeKeysByLength = [...nodes.keys()].sort((a, b) => b.length - a.length);
  const endpointsFromDataID = (path) => {
    const dataID = path.dataset.id;
    if (!dataID?.startsWith("L_")) return undefined;
    const joinedEndpoints = dataID.replace(/^L_/, "").replace(/_\d+$/, "");
    for (const from of nodeKeysByLength) {
      if (!joinedEndpoints.startsWith(`${from}_`)) continue;
      const to = joinedEndpoints.slice(from.length + 1);
      if (nodes.has(to)) return { from, to };
    }
    return undefined;
  };

  const edges = [];
  svg.querySelectorAll("path.flowchart-link, g.edgePath path").forEach((path) => {
    const classes = [...path.classList];
    const startClass = classes.find((name) => name.startsWith("LS-"));
    const endClass = classes.find((name) => name.startsWith("LE-"));
    const dataEndpoints = endpointsFromDataID(path);
    const from = dataEndpoints?.from || (startClass ? resolveKey(startClass.slice(3)) : undefined);
    const to = dataEndpoints?.to || (endClass ? resolveKey(endClass.slice(3)) : undefined);
    if (!nodes.has(from) || !nodes.has(to)) return;
    const visual = path.closest("g.edgePath") || path;
    edges.push({
      from,
      to,
      path,
      visual,
      originalMarkerStart: path.getAttribute("marker-start"),
      originalMarkerEnd: path.getAttribute("marker-end"),
    });
  });

  const incoming = new Map([...nodes.keys()].map((key) => [key, new Set()]));
  const outgoing = new Map([...nodes.keys()].map((key) => [key, new Set()]));
  edges.forEach(({ from, to }) => {
    outgoing.get(from)?.add(to);
    incoming.get(to)?.add(from);
  });

  graph = { nodes, edges, incoming, outgoing, markerCache: new Map() };
  elements.stats.textContent = `${nodes.size.toLocaleString()} nodes · ${edges.length.toLocaleString()} edges`;
  renderNodeList();

  nodes.forEach(({ element }, key) => {
    element.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      event.stopPropagation();
      selectNode(key);
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectNode(key);
      }
    });
  });
}

function renderNodeList() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const matches = [...graph.nodes.values()]
    .filter(({ label, key }) => !query || `${label} ${key}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (!matches.length) {
    elements.nodeList.className = "node-list empty-state";
    elements.nodeList.textContent = graph.nodes.size ? "No nodes match that search." : "Render a diagram to build its index.";
    return;
  }

  elements.nodeList.className = "node-list";
  elements.nodeList.innerHTML = matches
    .map(({ key, label }) => {
      const attached = new Set([...(graph.incoming.get(key) || []), ...(graph.outgoing.get(key) || [])]);
      return `<button type="button" data-node-key="${escapeAttribute(key)}" class="node-index-item${key === selectedKey ? " active" : ""}"><span>${escapeHTML(label)}</span><small>${attached.size}</small></button>`;
    })
    .join("");
}

function escapeHTML(value) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function escapeAttribute(value) {
  return escapeHTML(value);
}

function markerID(reference) {
  return reference?.match(/url\(["']?#([^"')]+)["']?\)/)?.[1];
}

function markerForRole(reference, role) {
  const sourceID = markerID(reference);
  if (!sourceID) return reference;
  const cacheKey = `${sourceID}:${role}`;
  if (graph.markerCache.has(cacheKey)) return `url(#${graph.markerCache.get(cacheKey)})`;

  const source = elements.stage.querySelector(`#${CSS.escape(sourceID)}`);
  if (!source) return reference;
  const clone = source.cloneNode(true);
  const roleColor = role === "incoming" ? "#7655b5" : "#25866a";
  const cloneID = `${sourceID}-atlas-${role}`;
  clone.id = cloneID;
  clone.style.color = roleColor;
  clone.querySelectorAll("path, polygon, polyline").forEach((shape) => {
    shape.setAttribute("fill", roleColor);
    shape.setAttribute("stroke", roleColor);
    shape.style.setProperty("fill", roleColor, "important");
    shape.style.setProperty("stroke", roleColor, "important");
  });
  source.parentNode.append(clone);
  graph.markerCache.set(cacheKey, cloneID);
  return `url(#${cloneID})`;
}

function setEdgeRole(edge, role) {
  edge.path.classList.toggle("atlas-incoming", role === "incoming");
  edge.path.classList.toggle("atlas-outgoing", role === "outgoing");
  edge.path.classList.toggle("atlas-dimmed", !role);
  if (edge.originalMarkerStart) {
    edge.path.setAttribute("marker-start", role ? markerForRole(edge.originalMarkerStart, role) : edge.originalMarkerStart);
  }
  if (edge.originalMarkerEnd) {
    edge.path.setAttribute("marker-end", role ? markerForRole(edge.originalMarkerEnd, role) : edge.originalMarkerEnd);
  }
}

function relationshipRows(keys, relationship) {
  const records = [...keys]
    .map((nodeKeyValue) => graph.nodes.get(nodeKeyValue))
    .filter(Boolean)
    .sort((a, b) => a.label.localeCompare(b.label));
  if (!records.length) return '<p class="hint relationship-empty">None</p>';
  return records.map(({ key, label }) => `
    <div class="relationship-row ${relationship}">
      <button type="button" data-node-key="${escapeAttribute(key)}"><span>${escapeHTML(label)}</span><b>Select</b></button>
      <button type="button" data-zoom-key="${escapeAttribute(key)}" class="zoom-node-button" aria-label="Zoom to ${escapeAttribute(label)}">Zoom</button>
    </div>`).join("");
}

function selectNode(key) {
  const selected = graph.nodes.get(key);
  if (!selected) return;
  selectedKey = key;
  const parents = graph.incoming.get(key) || new Set();
  const children = graph.outgoing.get(key) || new Set();
  const visible = new Set([key, ...parents, ...children]);

  graph.nodes.forEach(({ element }, nodeKeyValue) => {
    element.classList.toggle("atlas-selected", nodeKeyValue === key);
    element.classList.toggle("atlas-parent", parents.has(nodeKeyValue) && !children.has(nodeKeyValue));
    element.classList.toggle("atlas-child", children.has(nodeKeyValue) && !parents.has(nodeKeyValue));
    element.classList.toggle("atlas-bidirectional", parents.has(nodeKeyValue) && children.has(nodeKeyValue));
    element.classList.toggle("atlas-dimmed", !visible.has(nodeKeyValue));
  });

  graph.edges.forEach((edge) => {
    const role = edge.to === key ? "incoming" : edge.from === key ? "outgoing" : undefined;
    setEdgeRole(edge, role);
  });

  const attachedCount = new Set([...parents, ...children]).size;

  elements.selection.className = "selection-content";
  elements.selection.innerHTML = `
    <div class="selected-node-heading">
      <div class="selected-node-name">${escapeHTML(selected.label)}</div>
      <button type="button" data-zoom-key="${escapeAttribute(key)}" class="zoom-here-button">Zoom here</button>
    </div>
    <div class="connection-count">${attachedCount} directly attached ${attachedCount === 1 ? "node" : "nodes"}</div>
    <section class="relationship-group incoming">
      <h3><i></i>Parents <span>${parents.size}</span></h3>
      <div class="neighbor-list">${relationshipRows(parents, "incoming")}</div>
    </section>
    <section class="relationship-group outgoing">
      <h3><i></i>Children <span>${children.size}</span></h3>
      <div class="neighbor-list">${relationshipRows(children, "outgoing")}</div>
    </section>`;
  elements.clearSelection.disabled = false;
  renderNodeList();
}

function clearSelection() {
  selectedKey = null;
  graph.edges.forEach((edge) => setEdgeRole(edge, undefined));
  elements.stage.querySelectorAll(".atlas-selected, .atlas-parent, .atlas-child, .atlas-bidirectional, .atlas-dimmed, .atlas-incoming, .atlas-outgoing").forEach((element) => {
    element.classList.remove("atlas-selected", "atlas-parent", "atlas-child", "atlas-bidirectional", "atlas-dimmed", "atlas-incoming", "atlas-outgoing");
  });
  elements.selection.className = "empty-state";
  elements.selection.textContent = "Select any node to isolate its immediate connections.";
  elements.clearSelection.disabled = true;
  renderNodeList();
}

function applyTransform() {
  elements.stage.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
  elements.zoomLevel.value = `${Math.round(transform.scale * 100)}%`;
  elements.zoomLevel.textContent = elements.zoomLevel.value;
}

function setZoom(nextScale, clientX, clientY) {
  const scale = Math.min(4, Math.max(0.03, nextScale));
  const rect = elements.viewport.getBoundingClientRect();
  const pointX = clientX == null ? rect.width / 2 : clientX - rect.left;
  const pointY = clientY == null ? rect.height / 2 : clientY - rect.top;
  const graphX = (pointX - transform.x) / transform.scale;
  const graphY = (pointY - transform.y) / transform.scale;
  transform.x = pointX - graphX * scale;
  transform.y = pointY - graphY * scale;
  transform.scale = scale;
  applyTransform();
}

function fitGraph() {
  const svg = elements.stage.querySelector("svg");
  if (!svg) return;
  const viewBox = svg.viewBox.baseVal;
  const width = viewBox.width || svg.getBBox().width;
  const height = viewBox.height || svg.getBBox().height;
  const rect = elements.viewport.getBoundingClientRect();
  const scale = Math.min((rect.width - 72) / width, (rect.height - 72) / height, 1.25);
  transform = {
    scale: Math.max(0.03, scale),
    x: (rect.width - width * scale) / 2,
    y: (rect.height - height * scale) / 2,
  };
  applyTransform();
}

function zoomToNode(key) {
  const node = graph.nodes.get(key)?.element;
  if (!node) return;
  const viewportRect = elements.viewport.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const nodeCenterX = nodeRect.left + nodeRect.width / 2 - viewportRect.left;
  const nodeCenterY = nodeRect.top + nodeRect.height / 2 - viewportRect.top;
  const graphCenterX = (nodeCenterX - transform.x) / transform.scale;
  const graphCenterY = (nodeCenterY - transform.y) / transform.scale;
  const unscaledWidth = nodeRect.width / transform.scale;
  const unscaledHeight = nodeRect.height / transform.scale;
  const targetScale = Math.max(0.75, Math.min(2, 320 / Math.max(unscaledWidth, unscaledHeight, 1)));
  transform.scale = targetScale;
  transform.x = viewportRect.width / 2 - graphCenterX * targetScale;
  transform.y = viewportRect.height / 2 - graphCenterY * targetScale;
  applyTransform();
}

async function renderDiagram() {
  const source = activeSource();
  if (!source) {
    setStatus("Add Mermaid source first", "error");
    elements.source.focus();
    return;
  }

  const sequence = ++renderSequence;
  elements.render.disabled = true;
  elements.render.textContent = "Rendering…";
  setStatus("Laying out diagram…", "working");
  clearSelection();

  try {
    await mermaid.parse(source);
    const { svg, bindFunctions } = await mermaid.render(`atlas-${sequence}`, source);
    if (sequence !== renderSequence) return;
    elements.stage.innerHTML = svg;
    bindFunctions?.(elements.stage);
    const renderedSVG = elements.stage.querySelector("svg");
    renderedSVG.removeAttribute("width");
    renderedSVG.removeAttribute("height");
    const viewBox = renderedSVG.viewBox.baseVal;
    renderedSVG.style.width = `${viewBox.width}px`;
    renderedSVG.style.height = `${viewBox.height}px`;
    elements.canvasEmpty.hidden = true;
    indexRenderedGraph();
    requestAnimationFrame(fitGraph);
    setStatus("Diagram ready", "ready");
  } catch (error) {
    elements.stage.innerHTML = "";
    elements.canvasEmpty.hidden = false;
    elements.canvasEmpty.querySelector("p").textContent = "Mermaid could not render this source.";
    elements.canvasEmpty.querySelector("small").textContent = error?.message?.split("\n")[0] || "Check the syntax and try again.";
    setStatus("Render failed", "error");
    elements.stats.textContent = "Invalid diagram";
    graph = { nodes: new Map(), edges: [], incoming: new Map(), outgoing: new Map(), markerCache: new Map() };
    renderNodeList();
  } finally {
    elements.render.disabled = false;
    elements.render.textContent = "Render diagram";
  }
}

let drag = null;
elements.viewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (event.target.closest("g.node")) return;
  drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: transform.x, originY: transform.y, moved: false };
  elements.viewport.setPointerCapture(event.pointerId);
  elements.viewport.classList.add("dragging");
});

elements.viewport.addEventListener("pointermove", (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  drag.moved ||= Math.abs(dx) + Math.abs(dy) > 4;
  transform.x = drag.originX + dx * sensitivity.pan;
  transform.y = drag.originY + dy * sensitivity.pan;
  applyTransform();
});

elements.viewport.addEventListener("pointerup", (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (drag.moved) event.preventDefault();
  elements.viewport.releasePointerCapture(event.pointerId);
  elements.viewport.classList.remove("dragging");
  drag = null;
});

elements.viewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (sensitivity.device === "trackpad" && !event.ctrlKey) {
    transform.x -= event.deltaX * sensitivity.pan;
    transform.y -= event.deltaY * sensitivity.pan;
    applyTransform();
    return;
  }
  setZoom(transform.scale * Math.exp(-event.deltaY * 0.0015 * sensitivity.zoom), event.clientX, event.clientY);
}, { passive: false });

let nativeGesture = null;
elements.viewport.addEventListener("gesturestart", (event) => {
  if (sensitivity.device !== "trackpad") return;
  event.preventDefault();
  nativeGesture = {
    initialScale: transform.scale,
    clientX: event.clientX,
    clientY: event.clientY,
  };
}, { passive: false });

elements.viewport.addEventListener("gesturechange", (event) => {
  if (!nativeGesture || sensitivity.device !== "trackpad") return;
  event.preventDefault();
  const rawScale = Math.max(0.01, Number(event.scale) || 1);
  const sensitivityAdjustedScale = Math.pow(rawScale, sensitivity.zoom);
  setZoom(
    nativeGesture.initialScale * sensitivityAdjustedScale,
    Number.isFinite(event.clientX) ? event.clientX : nativeGesture.clientX,
    Number.isFinite(event.clientY) ? event.clientY : nativeGesture.clientY,
  );
}, { passive: false });

const finishNativeGesture = () => { nativeGesture = null; };
elements.viewport.addEventListener("gestureend", finishNativeGesture);
elements.viewport.addEventListener("gesturecancel", finishNativeGesture);

elements.viewport.addEventListener("click", (event) => {
  if (event.target === elements.viewport || event.target.classList.contains("grid-plane")) clearSelection();
});

elements.source.addEventListener("input", () => {
  updateSourceMeta();
  updateBlockPicker();
});
elements.source.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") renderDiagram();
});
elements.blockPicker.addEventListener("change", renderDiagram);
elements.render.addEventListener("click", renderDiagram);
elements.file.addEventListener("change", async () => {
  const file = elements.file.files?.[0];
  if (!file) return;
  elements.source.value = await file.text();
  updateSourceMeta();
  updateBlockPicker();
  await renderDiagram();
});
elements.search.addEventListener("input", renderNodeList);
elements.nodeList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-node-key]");
  if (button) selectNode(button.dataset.nodeKey);
});
elements.selection.addEventListener("click", (event) => {
  const zoomButton = event.target.closest("[data-zoom-key]");
  if (zoomButton) {
    zoomToNode(zoomButton.dataset.zoomKey);
    return;
  }
  const button = event.target.closest("[data-node-key]");
  if (button) selectNode(button.dataset.nodeKey);
});
elements.clearSelection.addEventListener("click", clearSelection);
elements.zoomIn.addEventListener("click", () => setZoom(transform.scale * 1.25));
elements.zoomOut.addEventListener("click", () => setZoom(transform.scale / 1.25));
elements.fit.addEventListener("click", fitGraph);
elements.actualSize.addEventListener("click", () => setZoom(1));
elements.openSettings.addEventListener("click", () => elements.settingsDialog.showModal());
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
  sensitivity = { ...defaultSensitivity };
  updateSensitivityControls();
});
elements.settingsDialog.addEventListener("click", (event) => {
  if (event.target === elements.settingsDialog) elements.settingsDialog.close();
});
elements.panelResizers.forEach((resizer) => {
  resizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const section = resizer.dataset.resize;
    const startY = event.clientY;
    const startSize = panelSizes[section];
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add("active");
    document.body.classList.add("resizing-panels");

    const move = (moveEvent) => setPanelSize(section, startSize + moveEvent.clientY - startY);
    const finish = (upEvent) => {
      resizer.releasePointerCapture(upEvent.pointerId);
      resizer.classList.remove("active");
      document.body.classList.remove("resizing-panels");
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", finish);
      resizer.removeEventListener("pointercancel", finish);
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", finish);
    resizer.addEventListener("pointercancel", finish);
  });
  resizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    setPanelSize(resizer.dataset.resize, panelSizes[resizer.dataset.resize] + direction * (event.shiftKey ? 25 : 8));
  });
  resizer.addEventListener("dblclick", () => {
    panelSizes[resizer.dataset.resize] = defaultPanelSizes[resizer.dataset.resize];
    applyPanelSizes();
  });
});
elements.sidebarResizer.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const startX = event.clientX;
  const startWidth = panelSizes.sidebar;
  elements.sidebarResizer.setPointerCapture(event.pointerId);
  elements.sidebarResizer.classList.add("active");
  document.body.classList.add("resizing-sidebar");

  const move = (moveEvent) => setSidebarWidth(startWidth + moveEvent.clientX - startX);
  const finish = (upEvent) => {
    elements.sidebarResizer.releasePointerCapture(upEvent.pointerId);
    elements.sidebarResizer.classList.remove("active");
    document.body.classList.remove("resizing-sidebar");
    elements.sidebarResizer.removeEventListener("pointermove", move);
    elements.sidebarResizer.removeEventListener("pointerup", finish);
    elements.sidebarResizer.removeEventListener("pointercancel", finish);
  };
  elements.sidebarResizer.addEventListener("pointermove", move);
  elements.sidebarResizer.addEventListener("pointerup", finish);
  elements.sidebarResizer.addEventListener("pointercancel", finish);
});
elements.sidebarResizer.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const direction = event.key === "ArrowRight" ? 1 : -1;
  setSidebarWidth(panelSizes.sidebar + direction * (event.shiftKey ? 40 : 10));
});
elements.sidebarResizer.addEventListener("dblclick", () => setSidebarWidth(defaultPanelSizes.sidebar));
window.addEventListener("resize", () => elements.stage.querySelector("svg") && fitGraph());
window.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== elements.source) {
    event.preventDefault();
    elements.search.focus();
  }
  if (event.key === "Escape") clearSelection();
});

elements.source.value = sample;
updateSensitivityControls();
applyPanelSizes();
updateSourceMeta();
updateBlockPicker();
renderDiagram();
