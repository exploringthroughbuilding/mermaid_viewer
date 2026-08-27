import { analyzeDiagram, matchSemanticItem } from "../mermaid/diagram-adapters.js";
import { fixtureById, viewerFixtures } from "../fixtures/diagram-fixtures.js";
import { configureMermaid, parseMermaid, renderMermaid } from "../mermaid/runtime.js";

const sample = fixtureById("flowchart-core").source;
const examples = Object.fromEntries(viewerFixtures.map((entry) => [entry.id, { label: `${entry.family} · ${entry.title}`, source: entry.source }]));

const elements = {
  rail: document.querySelector(".rail"),
  workbench: document.querySelector(".workbench"),
  sidebarResizer: document.querySelector("#sidebar-resizer"),
  source: document.querySelector("#source"),
  sourceLineHighlight: document.querySelector("#source-line-highlight"),
  sourceSize: document.querySelector("#source-size"),
  render: document.querySelector("#render"),
  file: document.querySelector("#file-input"),
  examplePicker: document.querySelector("#example-picker"),
  blockPickerWrap: document.querySelector("#block-picker-wrap"),
  blockPicker: document.querySelector("#block-picker"),
  viewport: document.querySelector("#viewport"),
  stage: document.querySelector("#stage"),
  canvasEmpty: document.querySelector("#canvas-empty"),
  status: document.querySelector("#status"),
  statusDot: document.querySelector("#status-dot"),
  stats: document.querySelector("#graph-stats"),
  search: document.querySelector("#node-search"),
  groupIndex: document.querySelector("#group-index"),
  indexSort: document.querySelector("#index-sort"),
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
let transformRevision = 0;
let graph = { nodes: new Map(), edges: [], incoming: new Map(), outgoing: new Map(), markerCache: new Map() };
let selectedKey = null;
let keyboardNavigation = null;
let diagramAnalysis = analyzeDiagram(sample);
let diagramKind = diagramAnalysis.id;
const collapsedGroupKeys = new Set();
let markdownBlocks = [];
let renderSequence = 0;
const sensitivityStorageKey = "mermaid-atlas-interaction-settings";
const defaultSensitivity = { zoom: 1, pan: 1, device: "trackpad" };
let sensitivity = loadSensitivity();
const panelSizeStorageKey = "mermaid-atlas-panel-sizes";
const defaultPanelSizes = { source: 228, index: 136, sidebar: 360 };
let panelSizes = loadPanelSizes();
const indexSettingsStorageKey = "mermaid-atlas-index-settings:v1";
const defaultIndexSettings = { grouped: false, sort: "label-asc" };
let indexSettings = loadIndexSettings();

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

function loadIndexSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(indexSettingsStorageKey));
    const allowedSorts = new Set(["label-asc", "label-desc", "connections-desc", "connections-asc"]);
    return {
      grouped: stored?.grouped === true,
      sort: allowedSorts.has(stored?.sort) ? stored.sort : defaultIndexSettings.sort,
    };
  } catch {
    return { ...defaultIndexSettings };
  }
}

function updateIndexControls() {
  elements.groupIndex.setAttribute("aria-pressed", String(indexSettings.grouped));
  elements.groupIndex.classList.toggle("active", indexSettings.grouped);
  elements.indexSort.value = indexSettings.sort;
  try {
    localStorage.setItem(indexSettingsStorageKey, JSON.stringify(indexSettings));
  } catch {
    // Index controls remain usable when browser storage is unavailable.
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

function initializeMermaid(theme) {
  configureMermaid(theme);
}

initializeMermaid(document.querySelector(".app-root")?.dataset.theme);

function setStatus(message, state = "idle") {
  elements.status.textContent = message;
  elements.statusDot.className = `status-dot ${state}`;
}

function extractMermaidBlocks(value) {
  return [...value.matchAll(/```mermaid\s*\n([\s\S]*?)```/gi)].map((match) => match[1].trim());
}

function activeSource() {
  return elements.source.value.trim();
}

function relationshipVocabulary() {
  return diagramAnalysis.vocabulary;
}

function diagramSupportsRelationships() {
  return diagramAnalysis.mode === "relational";
}

function updateSourceMeta() {
  elements.sourceSize.textContent = `${elements.source.value.length.toLocaleString()} chars`;
  updateSourceLineHighlight();
}

function sourceLineForNode(node) {
  return node?.sourceLine ?? -1;
}

function updateSourceLineHighlight(line = selectedKey ? sourceLineForNode(graph.nodes.get(selectedKey)) : -1) {
  if (!elements.sourceLineHighlight) return;
  if (line < 0) {
    elements.sourceLineHighlight.classList.remove("visible");
    return;
  }
  const lineHeight = Number.parseFloat(getComputedStyle(elements.source).lineHeight) || 17.05;
  const lineTop = line * lineHeight;
  if (lineTop < elements.source.scrollTop || lineTop + lineHeight > elements.source.scrollTop + elements.source.clientHeight) {
    elements.source.scrollTop = Math.max(0, lineTop - elements.source.clientHeight / 2 + lineHeight / 2);
  }
  elements.sourceLineHighlight.style.top = `${lineTop - elements.source.scrollTop}px`;
  elements.sourceLineHighlight.classList.add("visible");
}

function updateBlockPicker() {
  const selectedIndex = Math.min(Number(elements.blockPicker.value) || 0, Math.max(0, markdownBlocks.length - 1));
  elements.blockPickerWrap.hidden = markdownBlocks.length === 0;
  elements.blockPicker.innerHTML = markdownBlocks
    .map((block, index) => `<option value="${index}">Diagram ${index + 1} · ${block.split("\n")[0]}</option>`)
    .join("");
  elements.blockPicker.value = String(selectedIndex);
}

function loadSource(value) {
  const blocks = extractMermaidBlocks(value);
  markdownBlocks = blocks;
  elements.source.value = blocks[0] || value;
  updateSourceMeta();
  updateBlockPicker();
  updateSourceLineHighlight(-1);
}

function populateExamples() {
  const labels = { relational: "Relationship diagrams", ordered: "Ordered items", canvas: "Canvas charts" };
  const groups = viewerFixtures.reduce((result, entry) => {
    const mode = analyzeDiagram(entry.source).mode;
    (result[mode] ||= []).push(entry);
    return result;
  }, {});
  elements.examplePicker.innerHTML = `<option value="">Examples</option>${Object.entries(groups).map(([mode, fixtures]) => (
    `<optgroup label="${labels[mode]}">${fixtures.map(({ id }) => `<option value="${id}">${examples[id].label}</option>`).join("")}</optgroup>`
  )).join("")}`;
}

function loadExample(key) {
  const example = examples[key];
  if (!example) return;
  markdownBlocks = [];
  elements.blockPickerWrap.hidden = true;
  elements.examplePicker.value = key;
  elements.source.value = example.source;
  updateSourceMeta();
  clearSelection();
  renderDiagram();
}

function updateSourceFromEditor() {
  const pastedBlocks = extractMermaidBlocks(elements.source.value);
  if (pastedBlocks.length) {
    loadSource(elements.source.value);
    return;
  }
  if (markdownBlocks.length) {
    const selectedIndex = Number(elements.blockPicker.value) || 0;
    markdownBlocks[selectedIndex] = elements.source.value;
    updateBlockPicker();
  }
  updateSourceMeta();
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
  if (node.dataset.id) return node.dataset.id;
  if (node.getAttribute("name")) return node.getAttribute("name");
  const typedID = node.id.match(/-(?:flowchart|classId|state|entity)-(.+?)-\d+$/)?.[1];
  if (typedID) return typedID;
  const serviceID = node.id.match(/-service-(.+)$/)?.[1];
  if (serviceID) return serviceID;
  return canonical(node.id.replace(/^atlas-\d+-/, ""));
}

function renderedNodes(svg) {
  const selectors = diagramAnalysis.selectors.filter((selector) => svg.querySelector(selector));
  if (selectors.length) return [...svg.querySelectorAll(selectors.join(", "))];
  if (diagramAnalysis.mode === "canvas") return [];
  const textGroups = [...svg.querySelectorAll("text, foreignObject")]
    .map((element) => element.closest("g"))
    .filter((element) => element && element.textContent.trim());
  return [...new Set(textGroups)].map((element) => {
    element.dataset.atlasSemanticCandidate = "true";
    return element;
  });
}

function indexRenderedGraph() {
  const svg = elements.stage.querySelector("svg");
  const nodes = new Map();
  const clusters = [...svg.querySelectorAll("g.cluster")]
    .map((cluster, index) => {
      const bounds = cluster.getBoundingClientRect();
      const label = (cluster.querySelector(".cluster-label")?.textContent || cluster.dataset.id || `Subgraph ${index + 1}`)
        .trim()
        .replace(/\s+/g, " ");
      return {
        key: cluster.dataset.id || cluster.id || `subgraph-${index}`,
        label,
        bounds,
        area: bounds.width * bounds.height,
      };
    })
    .sort((a, b) => a.area - b.area);
  const gitLabels = elements.source.value.split("\n")
    .map((line) => line.match(/^\s*commit(?:\s+id:\s*["']([^"']+)["'])?/i)?.[1])
    .filter(Boolean);

  const usedSemanticKeys = new Set();
  renderedNodes(svg).forEach((node, index) => {
    const rawKey = nodeKey(node);
    const fallbackLabel = diagramKind === "gitGraph" && node.matches("circle.commit") ? gitLabels[index] : "";
    const renderedLabel = (node.querySelector(".nodeLabel")?.textContent || node.textContent || "").trim().replace(/\s+/g, " ");
    const label = renderedLabel || fallbackLabel || rawKey;
    const semanticItem = matchSemanticItem(diagramAnalysis, rawKey, label, usedSemanticKeys);
    if (node.dataset.atlasSemanticCandidate && !semanticItem) return;
    if (semanticItem) usedSemanticKeys.add(semanticItem.key);
    const resolvedKey = semanticItem?.key || rawKey || label || `item-${index + 1}`;
    const bounds = node.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const cluster = clusters.find(({ bounds: clusterBounds }) => centerX >= clusterBounds.left && centerX <= clusterBounds.right
      && centerY >= clusterBounds.top && centerY <= clusterBounds.bottom);
    node.dataset.graphKey = resolvedKey;
    if (semanticItem?.line != null) node.dataset.sourceLine = semanticItem.line;
    node.classList.add("atlas-node");
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `${label}. Select to show attached nodes.`);
    nodes.set(resolvedKey, {
      key: resolvedKey,
      rawKey,
      label: semanticItem?.label || label || resolvedKey,
      sourceLine: semanticItem?.line,
      semanticAliases: semanticItem?.aliases || [],
      element: node,
      groupKey: cluster?.key,
      groupLabel: cluster?.label,
    });
  });

  const resolveKey = (candidate) => {
    if (nodes.has(candidate)) return candidate;
    const normalized = canonical(candidate);
    return [...nodes.values()].find((node) => canonical(node.rawKey || "") === normalized
      || node.semanticAliases.some((alias) => alias.toLocaleLowerCase() === String(candidate).toLocaleLowerCase()))?.key || candidate;
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

  let edges = [];
  svg.querySelectorAll("path.flowchart-link, g.edgePath path").forEach((path) => {
    const classes = [...path.classList];
    const startClass = classes.find((name) => name.startsWith("LS-"));
    const endClass = classes.find((name) => name.startsWith("LE-"));
    const dataEndpoints = endpointsFromDataID(path);
    const from = dataEndpoints?.from || (startClass ? resolveKey(startClass.slice(3)) : undefined);
    const to = dataEndpoints?.to || (endClass ? resolveKey(endClass.slice(3)) : undefined);
    if (!nodes.has(from) || !nodes.has(to)) return;
    const visual = path.closest("g.edgePath") || path;
    const label = path.dataset.id
      ? svg.querySelector(`g.edgeLabel .label[data-id="${CSS.escape(path.dataset.id)}"]`)?.closest("g.edgeLabel")
      : undefined;
    edges.push({
      from,
      to,
      path,
      visual,
      label,
      originalMarkerStart: path.getAttribute("marker-start"),
      originalMarkerEnd: path.getAttribute("marker-end"),
    });
  });

  const semanticRelations = diagramAnalysis.relations
    .map(({ from, to }) => ({ from: resolveKey(from), to: resolveKey(to) }))
    .filter(({ from, to }) => nodes.has(from) && nodes.has(to));
  if (semanticRelations.length) {
    const usedVisualEdges = new Set();
    const semanticEdges = semanticRelations.map(({ from, to }) => {
      const visualEdge = edges.find((edge) => !usedVisualEdges.has(edge)
        && ((edge.from === from && edge.to === to) || (edge.from === to && edge.to === from)));
      if (visualEdge) usedVisualEdges.add(visualEdge);
      return { ...visualEdge, from, to };
    });
    const structuralEdges = edges.filter((edge) => !usedVisualEdges.has(edge)
      && (nodes.get(edge.from)?.sourceLine == null || nodes.get(edge.to)?.sourceLine == null));
    edges = [...semanticEdges, ...structuralEdges];
  }
  edges = edges.filter((edge, index) => edges.findIndex((candidate) => candidate.from === edge.from && candidate.to === edge.to) === index);

  const incoming = new Map([...nodes.keys()].map((key) => [key, new Set()]));
  const outgoing = new Map([...nodes.keys()].map((key) => [key, new Set()]));
  edges.forEach(({ from, to }) => {
    outgoing.get(from)?.add(to);
    incoming.get(to)?.add(from);
  });

  nodes.forEach((node, key) => {
    node.connections = new Set([...(incoming.get(key) || []), ...(outgoing.get(key) || [])]).size;
  });

  graph = { nodes, edges, incoming, outgoing, markerCache: new Map() };
  elements.stats.textContent = nodes.size
    ? `${nodes.size.toLocaleString()} items · ${edges.length.toLocaleString()} relations`
    : `${diagramKind} · canvas view`;
  renderNodeList();

  nodes.forEach(({ element }, key) => {
    element.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      event.stopPropagation();
      selectNode(key);
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        if (event.key === "Enter" && keyboardNavigation) return;
        event.preventDefault();
        selectNode(key);
      }
    });
  });
}

function renderNodeList() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const matches = [...graph.nodes.values()]
    .filter(({ label, key, groupLabel }) => !query || `${label} ${key} ${groupLabel || ""}`.toLocaleLowerCase().includes(query))
    .sort(compareIndexNodes);

  if (!matches.length) {
    elements.nodeList.className = "node-list empty-state";
    elements.nodeList.textContent = graph.nodes.size
      ? "No items match that search."
      : diagramAnalysis.mode === "canvas"
        ? "This chart has no parent/child relationships. Use the canvas controls to explore it."
        : "Render a diagram to build its index.";
    return;
  }

  if (!indexSettings.grouped) {
    elements.nodeList.className = "node-list";
    elements.nodeList.innerHTML = matches.map(nodeIndexItem).join("");
    return;
  }

  const groupedMatches = new Map();
  matches.forEach((node) => {
    const groupKey = node.groupKey || "__ungrouped__";
    if (!groupedMatches.has(groupKey)) {
      groupedMatches.set(groupKey, { label: node.groupLabel || "Ungrouped", nodes: [] });
    }
    groupedMatches.get(groupKey).nodes.push(node);
  });

  const groups = [...groupedMatches.entries()].sort(([keyA, groupA], [keyB, groupB]) => {
    if (keyA === "__ungrouped__") return 1;
    if (keyB === "__ungrouped__") return -1;
    return groupA.label.localeCompare(groupB.label);
  });
  elements.nodeList.className = "node-list grouped";
  elements.nodeList.innerHTML = groups.map(([key, group]) => {
    const expanded = !collapsedGroupKeys.has(key);
    return `
      <section class="node-index-group" data-group-key="${escapeAttribute(key)}">
        <header>
          <button type="button" class="group-heading-button" data-group-toggle="${escapeAttribute(key)}" aria-expanded="${expanded}">
            <span><i aria-hidden="true"></i>${escapeHTML(group.label)}</span><small>${group.nodes.length}</small>
          </button>
        </header>
        <div class="group-items"${expanded ? "" : " hidden"}>${group.nodes.map(nodeIndexItem).join("")}</div>
      </section>`;
  }).join("");
}

function compareIndexNodes(a, b) {
  if (indexSettings.sort === "label-desc") return b.label.localeCompare(a.label);
  if (indexSettings.sort === "connections-desc") return b.connections - a.connections || a.label.localeCompare(b.label);
  if (indexSettings.sort === "connections-asc") return a.connections - b.connections || a.label.localeCompare(b.label);
  return a.label.localeCompare(b.label);
}

function nodeIndexItem({ key, label, connections }) {
  return `<button type="button" data-node-key="${escapeAttribute(key)}" class="node-index-item${key === selectedKey ? " active" : ""}"><span>${escapeHTML(label)}</span><small>${connections}</small></button>`;
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
  edge.path?.classList.toggle("atlas-incoming", role === "incoming");
  edge.path?.classList.toggle("atlas-outgoing", role === "outgoing");
  edge.path?.classList.toggle("atlas-dimmed", !role);
  edge.label?.classList.toggle("atlas-incoming", role === "incoming");
  edge.label?.classList.toggle("atlas-outgoing", role === "outgoing");
  edge.label?.classList.toggle("atlas-dimmed", !role);
  if (edge.path && edge.originalMarkerStart) {
    edge.path.setAttribute("marker-start", role ? markerForRole(edge.originalMarkerStart, role) : edge.originalMarkerStart);
  }
  if (edge.path && edge.originalMarkerEnd) {
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
  clearKeyboardPreview();
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
  const vocabulary = relationshipVocabulary();
  const relationships = diagramSupportsRelationships() ? `
    <section class="relationship-group incoming">
      <h3><i></i>${vocabulary.incoming} <span>${parents.size}</span></h3>
      <div class="neighbor-list">${relationshipRows(parents, "incoming")}</div>
    </section>
    <section class="relationship-group outgoing">
      <h3><i></i>${vocabulary.outgoing} <span>${children.size}</span></h3>
      <div class="neighbor-list">${relationshipRows(children, "outgoing")}</div>
    </section>` : `<p class="hint relationship-note">This diagram is ordered visually, but does not define parent/child relationships. Select items to inspect their source and use Z to center them.</p>`;

  elements.selection.className = "selection-content";
  elements.selection.innerHTML = `
    <div class="selected-node-heading">
      <div class="selected-node-name">${escapeHTML(selected.label)}</div>
      <button type="button" data-zoom-key="${escapeAttribute(key)}" class="zoom-here-button">Zoom here</button>
    </div>
    <div class="connection-count">${diagramSupportsRelationships() ? `${attachedCount} directly attached ${attachedCount === 1 ? "item" : "items"}` : "Source-linked item"}</div>
    ${relationships}`;
  elements.clearSelection.disabled = false;
  updateSourceLineHighlight();
  renderNodeList();
}

function clearSelection() {
  clearKeyboardPreview();
  selectedKey = null;
  graph.edges.forEach((edge) => setEdgeRole(edge, undefined));
  elements.stage.querySelectorAll(".atlas-selected, .atlas-parent, .atlas-child, .atlas-bidirectional, .atlas-dimmed, .atlas-incoming, .atlas-outgoing").forEach((element) => {
    element.classList.remove("atlas-selected", "atlas-parent", "atlas-child", "atlas-bidirectional", "atlas-dimmed", "atlas-incoming", "atlas-outgoing");
  });
  elements.selection.className = "empty-state";
  elements.selection.textContent = "Select any node to isolate its immediate connections.";
  elements.clearSelection.disabled = true;
  updateSourceLineHighlight(-1);
  renderNodeList();
}

function applyTransform() {
  transformRevision += 1;
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

function clearKeyboardPreview() {
  keyboardNavigation = null;
  elements.stage.querySelectorAll(".atlas-preview").forEach((element) => element.classList.remove("atlas-preview"));
  elements.selection.querySelectorAll(".keyboard-preview, .keyboard-browse-active").forEach((element) => {
    element.classList.remove("keyboard-preview", "keyboard-browse-active");
  });
}

function showNodesTogether(firstKey, secondKey) {
  const first = graph.nodes.get(firstKey)?.element;
  const second = graph.nodes.get(secondKey)?.element;
  if (!first || !second) return;
  const viewportRect = elements.viewport.getBoundingClientRect();
  const bounds = [first, second].map((node) => {
    const rect = node.getBoundingClientRect();
    return {
      left: (rect.left - viewportRect.left - transform.x) / transform.scale,
      right: (rect.right - viewportRect.left - transform.x) / transform.scale,
      top: (rect.top - viewportRect.top - transform.y) / transform.scale,
      bottom: (rect.bottom - viewportRect.top - transform.y) / transform.scale,
    };
  });
  const left = Math.min(...bounds.map((bound) => bound.left));
  const right = Math.max(...bounds.map((bound) => bound.right));
  const top = Math.min(...bounds.map((bound) => bound.top));
  const bottom = Math.max(...bounds.map((bound) => bound.bottom));
  const scale = Math.max(0.03, Math.min(2, (viewportRect.width - 120) / (right - left), (viewportRect.height - 120) / (bottom - top)));
  transform.scale = scale;
  transform.x = viewportRect.width / 2 - ((left + right) / 2) * scale;
  transform.y = viewportRect.height / 2 - ((top + bottom) / 2) * scale;
  applyTransform();
}

function showKeyboardPreview() {
  elements.stage.querySelectorAll(".atlas-preview").forEach((element) => element.classList.remove("atlas-preview"));
  elements.selection.querySelectorAll(".keyboard-preview, .keyboard-browse-active").forEach((element) => {
    element.classList.remove("keyboard-preview", "keyboard-browse-active");
  });
  const key = keyboardNavigation?.candidates[keyboardNavigation.index];
  if (!key) return;
  graph.nodes.get(key)?.element.classList.add("atlas-preview");
  const previewEdge = graph.edges.find((edge) => keyboardNavigation.relationship === "parent"
    ? edge.from === key && edge.to === selectedKey
    : edge.from === selectedKey && edge.to === key);
  previewEdge?.path?.classList.add("atlas-preview");
  previewEdge?.label?.classList.add("atlas-preview");
  const row = elements.selection.querySelector(`.relationship-row [data-node-key="${CSS.escape(key)}"]`)?.closest(".relationship-row");
  row?.classList.add("keyboard-preview");
  row?.closest(".relationship-group")?.classList.add("keyboard-browse-active");
  row?.scrollIntoView({ block: "nearest" });
  showNodesTogether(selectedKey, key);
}

function browseRelationship(relationship) {
  const connections = relationship === "parent" ? graph.incoming.get(selectedKey) : graph.outgoing.get(selectedKey);
  const candidates = [...(connections || [])].sort((a, b) => (
    graph.nodes.get(a)?.label || a
  ).localeCompare(graph.nodes.get(b)?.label || b));
  if (!candidates.length) {
    clearKeyboardPreview();
    return true;
  }
  keyboardNavigation = { relationship, candidates, index: 0 };
  showKeyboardPreview();
  return true;
}

function cycleRelationship(direction) {
  if (!keyboardNavigation) return false;
  keyboardNavigation.index = (
    keyboardNavigation.index + direction + keyboardNavigation.candidates.length
  ) % keyboardNavigation.candidates.length;
  showKeyboardPreview();
  return true;
}

function commitKeyboardPreview() {
  const key = keyboardNavigation?.candidates[keyboardNavigation.index];
  if (!key) return false;
  selectNode(key);
  zoomToNode(key);
  graph.nodes.get(key)?.element.focus({ preventScroll: true });
  return true;
}

function zoomSelectedNode() {
  if (!selectedKey) return false;
  const key = selectedKey;
  clearKeyboardPreview();
  zoomToNode(key);
  graph.nodes.get(key)?.element.focus({ preventScroll: true });
  return true;
}

async function renderDiagram(preserveView = false) {
  const shouldPreserveView = preserveView === true;
  const selectionToRestore = shouldPreserveView ? selectedKey : null;
  const source = activeSource();
  if (!source) {
    setStatus("Add Mermaid source first", "error");
    elements.source.focus();
    return;
  }

  const sequence = ++renderSequence;
  diagramAnalysis = analyzeDiagram(source);
  diagramKind = diagramAnalysis.id;
  elements.render.disabled = true;
  elements.render.textContent = "Rendering…";
  setStatus("Laying out diagram…", "working");
  clearSelection();

  try {
    await parseMermaid(source);
    const { svg, bindFunctions } = await renderMermaid(`atlas-${sequence}`, source);
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
    if (selectionToRestore) selectNode(selectionToRestore);
    if (shouldPreserveView) applyTransform();
    else {
      const revisionBeforeFit = transformRevision;
      requestAnimationFrame(() => {
        if (sequence === renderSequence && selectedKey === null && transformRevision === revisionBeforeFit) fitGraph();
      });
    }
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
let suppressCanvasClick = false;
elements.viewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (event.target.closest("[data-graph-key]")) return;
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
  if (drag.moved) {
    event.preventDefault();
    suppressCanvasClick = true;
    setTimeout(() => { suppressCanvasClick = false; }, 0);
  }
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
  if (suppressCanvasClick) {
    suppressCanvasClick = false;
    return;
  }
  if (event.target === elements.viewport || event.target.classList.contains("grid-plane")) clearSelection();
});

elements.source.addEventListener("input", () => {
  updateSourceFromEditor();
  elements.examplePicker.value = "";
});
elements.source.addEventListener("scroll", () => updateSourceLineHighlight());
elements.source.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") renderDiagram();
});
elements.blockPicker.addEventListener("change", () => {
  elements.source.value = markdownBlocks[Number(elements.blockPicker.value) || 0] || "";
  updateSourceMeta();
  renderDiagram();
});
elements.render.addEventListener("click", renderDiagram);
elements.file.addEventListener("change", async () => {
  const file = elements.file.files?.[0];
  if (!file) return;
  loadSource(await file.text());
  await renderDiagram();
});
elements.examplePicker.addEventListener("change", () => loadExample(elements.examplePicker.value));
elements.search.addEventListener("input", renderNodeList);
elements.groupIndex.addEventListener("click", () => {
  indexSettings = { ...indexSettings, grouped: !indexSettings.grouped };
  updateIndexControls();
  renderNodeList();
});
elements.indexSort.addEventListener("change", () => {
  indexSettings = { ...indexSettings, sort: elements.indexSort.value };
  updateIndexControls();
  renderNodeList();
});
elements.nodeList.addEventListener("click", (event) => {
  const groupButton = event.target.closest("[data-group-toggle]");
  if (groupButton) {
    const groupKey = groupButton.dataset.groupToggle;
    if (collapsedGroupKeys.has(groupKey)) collapsedGroupKeys.delete(groupKey);
    else collapsedGroupKeys.add(groupKey);
    renderNodeList();
    return;
  }
  const button = event.target.closest("[data-node-key]");
  if (button) {
    selectNode(button.dataset.nodeKey);
    zoomToNode(button.dataset.nodeKey);
  }
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
window.addEventListener("atlas-theme-change", (event) => {
  initializeMermaid(event.detail?.theme);
  if (elements.stage.querySelector("svg")) renderDiagram(true);
});
window.addEventListener("keydown", (event) => {
  const isEditing = event.target.closest?.("input, textarea, select, button, [contenteditable='true'], dialog");
  if (!isEditing && selectedKey) {
    const unmodifiedKey = !event.metaKey && !event.ctrlKey && !event.altKey;
    const shortcutKey = event.key.toLocaleLowerCase();
    let handled = false;
    if (event.key === "ArrowLeft") handled = browseRelationship("parent");
    else if (event.key === "ArrowRight") handled = browseRelationship("child");
    else if (event.key === "ArrowUp") handled = cycleRelationship(-1);
    else if (event.key === "ArrowDown") handled = cycleRelationship(1);
    else if (event.key === "Enter" || (unmodifiedKey && shortcutKey === "s")) handled = commitKeyboardPreview();
    else if (unmodifiedKey && shortcutKey === "z") handled = zoomSelectedNode();
    if (handled) {
      event.preventDefault();
      return;
    }
  }
  if (event.key === "/" && document.activeElement !== elements.source) {
    event.preventDefault();
    elements.search.focus();
  }
  if (event.key === "Escape") {
    if (keyboardNavigation) clearKeyboardPreview();
    else clearSelection();
  }
});

loadSource(sample);
populateExamples();
updateSensitivityControls();
updateIndexControls();
applyPanelSizes();
renderDiagram();
