import {
  analyzeDiagram,
  extractDiagramInteraction,
  findUntraversableGroupEdges,
} from "../mermaid/diagram-adapters.js";
import { challengeDemoPrimary } from "../demo/challenge-demo.js";
import { viewerFixtureById, viewerFixtures } from "../fixtures/viewer-fixtures.js";
import { configureMermaid, parseMermaid, renderMermaid } from "../mermaid/runtime.js";

const featuredExampleKey = "challenge-demo-service-topology";
const requestedFixtureId = new URLSearchParams(window.location.search).get("fixture");
const requestedFixture = viewerFixtureById(requestedFixtureId)
  || (import.meta.env.DEV && requestedFixtureId
    ? (await import("../fixtures/diagram-fixtures.js")).fixtureById(requestedFixtureId)
    : undefined);
const sample = requestedFixture?.source || challengeDemoPrimary.source;
const examples = {
  [featuredExampleKey]: {
    label: "Checkout architecture · 31-service topology",
    source: challengeDemoPrimary.source,
  },
  ...Object.fromEntries(viewerFixtures.map((entry) => [entry.id, { label: `${entry.family} · ${entry.title}`, source: entry.source }])),
};

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
let graph = {
  nodes: new Map(), edges: [], incoming: new Map(), outgoing: new Map(), markerCache: new Map(), untraversableEdges: [],
};
let renderedSource = "";
let selectedKey = null;
let keyboardNavigation = null;
let diagramAnalysis = analyzeDiagram(sample);
let diagramKind = diagramAnalysis.id;
const collapsedGroupKeys = new Set();
let markdownBlocks = [];
let markdownLibraryIds = [];
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

const darkCanvasColor = { red: 21, green: 27, blue: 35 };
const darkDiagramTextColor = "#172033";
const lightDiagramTextColor = "#e7edf6";

function rgbColor(value) {
  if (typeof value !== "string") return null;
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const expanded = hex[1].length === 3 ? [...hex[1]].map((channel) => channel.repeat(2)).join("") : hex[1];
    return {
      red: Number.parseInt(expanded.slice(0, 2), 16),
      green: Number.parseInt(expanded.slice(2, 4), 16),
      blue: Number.parseInt(expanded.slice(4, 6), 16),
      alpha: 1,
    };
  }
  const match = value.match(/^rgba?\(([^)]+)\)$/);
  if (!match) return null;
  const [red, green, blue, alpha = "1"] = match[1].split(",").map((channel) => channel.trim());
  const color = {
    red: Number(red),
    green: Number(green),
    blue: Number(blue),
    alpha: Number(alpha),
  };
  return Object.values(color).every(Number.isFinite) ? color : null;
}

function opaqueColor(color) {
  if (!color || color.alpha <= 0) return null;
  if (color.alpha >= 1) return color;
  return {
    red: color.red * color.alpha + darkCanvasColor.red * (1 - color.alpha),
    green: color.green * color.alpha + darkCanvasColor.green * (1 - color.alpha),
    blue: color.blue * color.alpha + darkCanvasColor.blue * (1 - color.alpha),
    alpha: 1,
  };
}

function luminance({ red, green, blue }) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrastRatio(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function labelBackground(label, svg) {
  const labelBounds = label.getBoundingClientRect();
  const centerX = labelBounds.left + labelBounds.width / 2;
  const centerY = labelBounds.top + labelBounds.height / 2;
  for (let container = label.parentElement; container && container !== svg; container = container.parentElement) {
    if (container.classList.contains("label")) continue;
    const shape = [...container.children].find((child) => {
      if (!child.matches?.("rect, circle, ellipse, path, polygon")) return false;
      const bounds = child.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0
        && centerX >= bounds.left && centerX <= bounds.right
        && centerY >= bounds.top && centerY <= bounds.bottom;
    });
    const color = opaqueColor(shape && rgbColor(getComputedStyle(shape).fill));
    if (color) return color;
  }
  return null;
}

function labelColor(label) {
  return label instanceof SVGForeignObjectElement
    ? rgbColor(getComputedStyle(label).color)
    : rgbColor(getComputedStyle(label).fill);
}

function setLabelColor(label, color) {
  const elements = [label, ...label.querySelectorAll("*")];
  elements.forEach((element) => {
    element.style.setProperty("color", color, "important");
    if (element instanceof SVGElement) element.style.setProperty("fill", color, "important");
  });
}

function fixDarkDiagramTextContrast(svg) {
  if (document.querySelector(".app-root")?.dataset.theme !== "dark") return;
  const darkText = rgbColor(darkDiagramTextColor);
  const lightText = rgbColor(lightDiagramTextColor);
  svg.querySelectorAll("foreignObject, text").forEach((label) => {
    if (!label.textContent.trim()) return;
    const background = labelBackground(label, svg);
    const currentText = labelColor(label);
    if (!background || !currentText || contrastRatio(currentText, background) >= 4.5) return;
    const preferredText = contrastRatio(darkText, background) >= contrastRatio(lightText, background)
      ? darkDiagramTextColor
      : lightDiagramTextColor;
    setLabelColor(label, preferredText);
  });
}

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
  markdownLibraryIds = [];
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
  const featured = `<optgroup label="Featured challenge demo"><option value="${featuredExampleKey}">${examples[featuredExampleKey].label}</option></optgroup>`;
  elements.examplePicker.innerHTML = `<option value="">Load diagram</option>${featured}${Object.entries(groups).map(([mode, fixtures]) => (
    `<optgroup label="${labels[mode]}">${fixtures.map(({ id }) => `<option value="${id}">${examples[id].label}</option>`).join("")}</optgroup>`
  )).join("")}`;
}

function announceActiveSource(reason, diagramId = null) {
  window.dispatchEvent(new CustomEvent("atlas-active-source-change", {
    detail: { reason, source: elements.source.value, diagramId },
  }));
}

function loadExample(key) {
  const example = examples[key];
  if (!example) return;
  markdownBlocks = [];
  markdownLibraryIds = [];
  elements.blockPickerWrap.hidden = true;
  elements.examplePicker.value = key;
  elements.source.value = example.source;
  updateSourceMeta();
  clearSelection();
  announceActiveSource("example");
  renderDiagram();
}

function updateSourceFromEditor() {
  const pastedBlocks = extractMermaidBlocks(elements.source.value);
  if (pastedBlocks.length) {
    const markdown = elements.source.value;
    loadSource(markdown);
    window.dispatchEvent(new CustomEvent("atlas-file-imported", {
      detail: { text: markdown, name: "pasted-markdown.md" },
    }));
    return;
  }
  if (markdownBlocks.length) {
    const selectedIndex = Number(elements.blockPicker.value) || 0;
    markdownBlocks[selectedIndex] = elements.source.value;
    updateBlockPicker();
  }
  updateSourceMeta();
}

function interactionParts(parts) {
  return [...new Set(parts.filter((part) => part?.classList))];
}

function topLevelParts(parts) {
  const unique = interactionParts(parts);
  return unique.filter((part) => !unique.some((candidate) => candidate !== part && candidate.contains?.(part)));
}

function nodeParts(node) {
  return interactionParts([node.element, ...node.paintParts]);
}

function edgeParts(edge) {
  return interactionParts([...edge.pathParts, ...edge.arrowParts, ...edge.labelParts]);
}

function setNodeRole(node, role) {
  nodeParts(node).forEach((part) => {
    part.classList.toggle("atlas-selected", role === "selected");
    part.classList.toggle("atlas-parent", role === "parent");
    part.classList.toggle("atlas-child", role === "child");
    part.classList.toggle("atlas-bidirectional", role === "bidirectional");
    part.classList.remove("atlas-dimmed");
  });
  node.element?.classList.toggle("atlas-dimmed", role === "dimmed");
}

function setNodePreview(node, preview) {
  nodeParts(node).forEach((part) => part.classList.toggle("atlas-preview", preview));
}

function setEdgePreview(edge, preview) {
  edgeParts(edge).forEach((part) => part.classList.toggle("atlas-preview", preview));
  edge.preview = preview;
  applyEdgeMarkers(edge);
}

function indexDiagramInteraction() {
  const svg = elements.stage.querySelector("svg");
  const nodes = new Map();
  const interaction = extractDiagramInteraction(svg, diagramAnalysis);
  const groups = interaction.groups
    .map((group) => {
      const cluster = [...svg.querySelectorAll("g.cluster")].find((candidate) => (
        candidate.querySelector(".cluster-label, .nodeLabel")?.textContent || ""
      ).trim().replace(/\s+/g, " ") === group.label);
      if (!cluster) return group;
      const bounds = cluster.getBoundingClientRect();
      return { ...group, bounds, area: bounds.width * bounds.height };
    })
    .filter((group) => group.bounds)
    .sort((first, second) => first.area - second.area);

  interaction.targets.forEach((target) => {
    if (!target.element || nodes.has(target.key)) return;
    const paintParts = interactionParts(target.paintParts);
    const bounds = target.element.getBoundingClientRect();
    const group = target.groupKey ? target : groups.find(({ bounds: groupBounds }) => (
      bounds.left + bounds.width / 2 >= groupBounds.left
      && bounds.left + bounds.width / 2 <= groupBounds.right
      && bounds.top + bounds.height / 2 >= groupBounds.top
      && bounds.top + bounds.height / 2 <= groupBounds.bottom
    ));
    target.element.dataset.graphKey = target.key;
    if (target.sourceLine != null) target.element.dataset.sourceLine = target.sourceLine;
    target.element.classList.add("atlas-node");
    target.element.setAttribute("tabindex", "0");
    target.element.setAttribute("role", "button");
    target.element.setAttribute("aria-label", `${target.label}. Select to show attached nodes.`);
    paintParts.forEach((part) => part.classList.add("atlas-paint-part"));
    nodes.set(target.key, {
      key: target.key,
      rawKey: target.rendererKey,
      label: target.label,
      sourceLine: target.sourceLine,
      element: target.element,
      paintParts,
      groupKey: target.groupKey || group?.key,
      groupLabel: target.groupLabel || group?.label,
    });
  });

  const edges = interaction.edges
    .filter(({ from, to }) => nodes.has(from) && nodes.has(to))
    .map((edge) => {
      const pathParts = interactionParts(edge.pathParts);
      const arrowParts = interactionParts(edge.arrowParts);
      const labelParts = interactionParts(edge.labelParts.flatMap((part) => [part, part.closest?.("g.edgeLabel")]));
      pathParts.forEach((part) => {
        part.classList.add("atlas-edge-part");
        part.style.setProperty("--atlas-original-stroke-width", getComputedStyle(part).strokeWidth);
      });
      arrowParts.forEach((part) => part.classList.add("atlas-edge-part"));
      labelParts.forEach((part) => part.classList.add("atlas-edge-label"));
      return {
        ...edge,
        pathParts,
        arrowParts,
        labelParts,
        markerPaths: pathParts
          .filter((part) => part instanceof SVGPathElement)
          .map((path) => ({
            path,
            originalMarkerStart: path.getAttribute("marker-start"),
            originalMarkerEnd: path.getAttribute("marker-end"),
          }))
          .filter(({ originalMarkerStart, originalMarkerEnd }) => originalMarkerStart || originalMarkerEnd),
      };
    });

  const incoming = new Map([...nodes.keys()].map((key) => [key, new Set()]));
  const outgoing = new Map([...nodes.keys()].map((key) => [key, new Set()]));
  edges.forEach(({ from, to }) => {
    outgoing.get(from)?.add(to);
    incoming.get(to)?.add(from);
  });

  nodes.forEach((node, key) => {
    node.connections = new Set([...(incoming.get(key) || []), ...(outgoing.get(key) || [])]).size;
  });

  const untraversableEdges = findUntraversableGroupEdges(diagramAnalysis, edges);

  graph = { nodes, edges, incoming, outgoing, markerCache: new Map(), untraversableEdges };
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
  const roleColor = {
    incoming: "#7655b5",
    outgoing: "#25866a",
    preview: "#c6872d",
    walkthrough: getComputedStyle(elements.stage.closest(".app-root") || document.documentElement).getPropertyValue("--coral").trim() || "#e36f55",
  }[role];
  const cloneID = `${sourceID}-atlas-${role}`;
  clone.id = cloneID;
  clone.style.color = roleColor;
  const sourceShapes = source.querySelectorAll("circle, ellipse, line, path, polygon, polyline, rect");
  const hollowMarker = /(?:aggregation|extension|dependency|onlyOne|zeroOrOne|oneOrMore|zeroOrMore)/i.test(sourceID);
  clone.querySelectorAll("circle, ellipse, line, path, polygon, polyline, rect").forEach((shape, index) => {
    const style = getComputedStyle(sourceShapes[index]);
    if (style.stroke !== "none" && style.stroke !== "transparent") {
      shape.setAttribute("stroke", roleColor);
      shape.style.setProperty("stroke", roleColor, "important");
    }
    if (!hollowMarker && style.fill !== "none" && style.fill !== "transparent" && Number(style.fillOpacity || 1) !== 0) {
      shape.setAttribute("fill", roleColor);
      shape.style.setProperty("fill", roleColor, "important");
    } else {
      shape.setAttribute("fill", "none");
      shape.style.setProperty("fill", "none", "important");
    }
  });
  source.parentNode.append(clone);
  graph.markerCache.set(cacheKey, cloneID);
  return `url(#${cloneID})`;
}

function applyEdgeMarkers(edge) {
  const markerRole = edge.walkthrough ? "walkthrough" : edge.preview ? "preview" : edge.role;
  edge.markerPaths.forEach(({ path, originalMarkerStart, originalMarkerEnd }) => {
    if (originalMarkerStart) {
      path.setAttribute("marker-start", markerRole ? markerForRole(originalMarkerStart, markerRole) : originalMarkerStart);
    }
    if (originalMarkerEnd) {
      path.setAttribute("marker-end", markerRole ? markerForRole(originalMarkerEnd, markerRole) : originalMarkerEnd);
    }
  });
}

function setEdgeRole(edge, role, dimmed = Boolean(selectedKey)) {
  edgeParts(edge).forEach((part) => {
    part.classList.toggle("atlas-incoming", role === "incoming");
    part.classList.toggle("atlas-outgoing", role === "outgoing");
    part.classList.remove("atlas-dimmed");
  });
  topLevelParts(edgeParts(edge)).forEach((part) => part.classList.toggle("atlas-dimmed", !role && dimmed));
  edge.role = role;
  applyEdgeMarkers(edge);
}

function setEdgeOverlay(edge, role, active) {
  edge[role] = active;
  applyEdgeMarkers(edge);
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

  graph.nodes.forEach((node, nodeKeyValue) => {
    const role = nodeKeyValue === key
      ? "selected"
      : parents.has(nodeKeyValue) && children.has(nodeKeyValue)
        ? "bidirectional"
        : parents.has(nodeKeyValue)
          ? "parent"
          : children.has(nodeKeyValue)
            ? "child"
            : !visible.has(nodeKeyValue)
              ? "dimmed"
              : undefined;
    setNodeRole(node, role);
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
  graph.nodes.forEach((node) => setNodeRole(node));
  graph.edges.forEach((edge) => setEdgeRole(edge));
  elements.selection.className = "empty-state";
  elements.selection.textContent = "Select any node to isolate its immediate connections.";
  elements.clearSelection.disabled = true;
  updateSourceLineHighlight(-1);
  renderNodeList();
}

let settleMotionTimer = 0;

/**
 * Layer promotion is scoped to actual movement. Chrome pins a promoted layer's
 * raster scale to the scale it was first painted at, so leaving the stage
 * promoted makes every repaint of a large SVG re-rasterise at the stale zoom.
 */
function markCameraMoving() {
  elements.stage.classList.add("is-moving");
  clearTimeout(settleMotionTimer);
  settleMotionTimer = setTimeout(() => elements.stage.classList.remove("is-moving"), 300);
}

function applyTransform() {
  transformRevision += 1;
  markCameraMoving();
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

/** The camera position that centres one node, without committing to it. */
function cameraTargetForNode(key) {
  const node = graph.nodes.get(key)?.element;
  if (!node) return null;
  const viewportRect = elements.viewport.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const nodeCenterX = nodeRect.left + nodeRect.width / 2 - viewportRect.left;
  const nodeCenterY = nodeRect.top + nodeRect.height / 2 - viewportRect.top;
  const graphCenterX = (nodeCenterX - transform.x) / transform.scale;
  const graphCenterY = (nodeCenterY - transform.y) / transform.scale;
  const unscaledWidth = nodeRect.width / transform.scale;
  const unscaledHeight = nodeRect.height / transform.scale;
  const scale = Math.max(0.75, Math.min(2, 320 / Math.max(unscaledWidth, unscaledHeight, 1)));
  return {
    scale,
    x: viewportRect.width / 2 - graphCenterX * scale,
    y: viewportRect.height / 2 - graphCenterY * scale,
  };
}

function zoomToNode(key) {
  const target = cameraTargetForNode(key);
  if (!target) return;
  cancelCameraAnimation();
  transform = target;
  applyTransform();
}

let cameraAnimation = null;

function cancelCameraAnimation() {
  if (!cameraAnimation) return;
  cancelAnimationFrame(cameraAnimation.frame);
  cameraAnimation.settle();
  cameraAnimation = null;
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Tween the camera in rAF rather than via a CSS transition: the stylesheet's
 * reduced-motion rule zeroes transition durations globally, and transitioning
 * `transform` on the stage would fight the pan/zoom handlers mid-drag.
 */
function animateCameraTo(target, duration = 520) {
  cancelCameraAnimation();
  if (!target) return Promise.resolve(false);
  if (prefersReducedMotion() || duration <= 0) {
    transform = { ...target };
    applyTransform();
    return Promise.resolve(true);
  }

  const from = { ...transform };
  const start = performance.now();
  return new Promise((resolve) => {
    const settle = () => resolve(false);
    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = progress < 0.5
        ? 4 * progress ** 3
        : 1 - ((-2 * progress + 2) ** 3) / 2;
      transform = {
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
        scale: from.scale + (target.scale - from.scale) * eased,
      };
      applyTransform();
      if (progress < 1) {
        cameraAnimation.frame = requestAnimationFrame(step);
        return;
      }
      cameraAnimation = null;
      resolve(true);
    };
    cameraAnimation = { frame: requestAnimationFrame(step), settle };
  });
}

function clearKeyboardPreview() {
  keyboardNavigation = null;
  graph.nodes.forEach((node) => setNodePreview(node, false));
  graph.edges.forEach((edge) => setEdgePreview(edge, false));
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
  graph.nodes.forEach((node) => setNodePreview(node, false));
  graph.edges.forEach((edge) => setEdgePreview(edge, false));
  elements.selection.querySelectorAll(".keyboard-preview, .keyboard-browse-active").forEach((element) => {
    element.classList.remove("keyboard-preview", "keyboard-browse-active");
  });
  const key = keyboardNavigation?.candidates[keyboardNavigation.index];
  if (!key) return;
  const previewEdges = graph.edges.filter((edge) => keyboardNavigation.relationship === "parent"
    ? edge.from === key && edge.to === selectedKey
    : edge.from === selectedKey && edge.to === key);
  setNodePreview(graph.nodes.get(key), true);
  previewEdges.forEach((edge) => setEdgePreview(edge, true));
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
    fixDarkDiagramTextContrast(renderedSVG);
    elements.canvasEmpty.hidden = true;
    indexDiagramInteraction();
    if (selectionToRestore) selectNode(selectionToRestore);
    if (shouldPreserveView) applyTransform();
    else {
      const revisionBeforeFit = transformRevision;
      requestAnimationFrame(() => {
        if (sequence === renderSequence && selectedKey === null && transformRevision === revisionBeforeFit) fitGraph();
      });
    }
    setStatus("Diagram ready", "ready");
    renderedSource = source;
    notifyRendered();
  } catch (error) {
    elements.stage.innerHTML = "";
    elements.canvasEmpty.hidden = false;
    elements.canvasEmpty.querySelector("p").textContent = "Mermaid could not render this source.";
    elements.canvasEmpty.querySelector("small").textContent = error?.message?.split("\n")[0] || "Check the syntax and try again.";
    setStatus("Render failed", "error");
    elements.stats.textContent = "Invalid diagram";
    graph = {
      nodes: new Map(), edges: [], incoming: new Map(), outgoing: new Map(), markerCache: new Map(), untraversableEdges: [],
    };
    renderedSource = "";
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
  cancelCameraAnimation();
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
  cancelCameraAnimation();
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
  // Record the editor identity immediately. WebMCP separately reports whether
  // this source has reached the rendered canvas yet.
  announceActiveSource("editor");
  elements.examplePicker.value = "";
});
elements.source.addEventListener("scroll", () => updateSourceLineHighlight());
elements.source.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") renderDiagram();
});
elements.blockPicker.addEventListener("change", () => {
  const selectedIndex = Number(elements.blockPicker.value) || 0;
  elements.source.value = markdownBlocks[selectedIndex] || "";
  updateSourceMeta();
  announceActiveSource("markdown-block", markdownLibraryIds[selectedIndex] || null);
  renderDiagram();
});
elements.render.addEventListener("click", renderDiagram);
elements.file.addEventListener("change", async () => {
  const file = elements.file.files?.[0];
  if (!file) return;
  const text = await file.text();
  loadSource(text);
  // The WebMCP layer listens for this to catalogue every diagram in the file,
  // so an agent can list them by name instead of only seeing the active block.
  window.dispatchEvent(new CustomEvent("atlas-file-imported", { detail: { text, name: file.name } }));
  await renderDiagram();
});
window.addEventListener("atlas-library-imported", (event) => {
  markdownLibraryIds = Array.isArray(event.detail?.diagramIds) ? event.detail.diagramIds.slice() : [];
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

/* ---------------------------------------------------------------------------
 * Agent-facing surface
 *
 * WebMCP tools drive the workbench through this object only. Keeping it as the
 * single seam means tool handlers never reach into module state or the DOM, and
 * every agent-visible capability stays something a human can also do by hand.
 * ------------------------------------------------------------------------- */

const renderSubscribers = new Set();
const sourceHistory = [];
const maxHistoryDepth = 25;

function notifyRendered() {
  const detail = diagramSummary();
  renderSubscribers.forEach((subscriber) => {
    try {
      subscriber(detail);
    } catch {
      // A failing observer must never break rendering.
    }
  });
}

function diagramSummary() {
  return {
    id: diagramKind,
    mode: diagramAnalysis.mode,
    supportsRelationships: diagramSupportsRelationships(),
    nodeCount: graph.nodes.size,
    edgeCount: graph.edges.length,
    vocabulary: relationshipVocabulary(),
  };
}

function historyKey(value) {
  return value || "editor";
}

/** Snapshot both sides of an agent edit so undo cannot overwrite later human work. */
function pushSourceSnapshot(label, expectedSource, historyContext) {
  sourceHistory.push({
    source: elements.source.value,
    expectedSource,
    historyContext: historyKey(historyContext),
    label,
    at: Date.now(),
  });
  if (sourceHistory.length > maxHistoryDepth) sourceHistory.shift();
}

async function setSourceAndRender(source, { label = "edit", snapshot = true, historyContext = null } = {}) {
  if (snapshot) pushSourceSnapshot(label, source, historyContext);
  elements.source.value = source;
  updateSourceFromEditor();
  await renderDiagram();
  return diagramSummary();
}

async function undoSourceChange({ historyContext = null } = {}) {
  const key = historyKey(historyContext);
  let snapshotIndex = -1;
  for (let index = sourceHistory.length - 1; index >= 0; index -= 1) {
    if (sourceHistory[index].historyContext === key) {
      snapshotIndex = index;
      break;
    }
  }
  if (snapshotIndex < 0) return null;
  const previous = sourceHistory[snapshotIndex];
  if (elements.source.value !== previous.expectedSource) {
    return {
      ok: false,
      reason: "source_changed",
      label: previous.label,
      message: "The source changed after this agent patch. Undo was stopped to protect the newer human or diagram changes.",
    };
  }
  sourceHistory.splice(snapshotIndex, 1);
  if (!previous) return null;
  elements.source.value = previous.source;
  updateSourceFromEditor();
  await renderDiagram();
  return { ok: true, label: previous.label, restoredAt: previous.at, ...diagramSummary() };
}

export const atlasApi = {
  getGraph: () => graph,
  getSummary: diagramSummary,
  getSource: () => elements.source.value,
  getRenderedSource: () => renderedSource,
  getSelectedKey: () => selectedKey,
  historyDepth: (historyContext = null) => {
    const key = historyKey(historyContext);
    return sourceHistory.filter((entry) => entry.historyContext === key).length;
  },
  setSourceAndRender,
  undoSourceChange,
  pushSourceSnapshot,
  validateSource: (source) => parseMermaid(source),
  selectNode,
  clearSelection,
  fitGraph,
  zoomToNode,
  cameraTargetForNode,
  animateCameraTo,
  cancelCameraAnimation,
  setStatus,
  setEdgeOverlay,
  onRender(subscriber) {
    renderSubscribers.add(subscriber);
    return () => renderSubscribers.delete(subscriber);
  },
  elements: {
    stage: elements.stage,
    viewport: elements.viewport,
    source: elements.source,
  },
};

loadSource(sample);
populateExamples();
updateSensitivityControls();
updateIndexControls();
applyPanelSizes();
renderDiagram();
