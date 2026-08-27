// Imperative workbench controller: wires the editor, renderer, graph model,
// highlighter, viewport, index panel and URL state together.
import { analyzeDiagram } from "../mermaid/diagram-adapters.js";
import { fixtureById, viewerFixtures } from "../fixtures/diagram-fixtures.js";
import { configureMermaid, parseMermaid, renderMermaid } from "../mermaid/runtime.js";
import { buildGraph, emptyGraph } from "./graph-model.js";
import { createHighlighter } from "./highlight.js";
import { createIndexPanel, escapeHTML } from "./index-panel.js";
import { createPanels } from "./panels.js";
import { buildShareUrl, decodeSharedSource, fetchSource, readLaunchOptions } from "./url-state.js";
import { createViewport } from "./viewport.js";

const sample = fixtureById("flowchart-core").source;
const examples = Object.fromEntries(viewerFixtures.map((entry) => [entry.id, { label: `${entry.family} · ${entry.title}`, source: entry.source }]));
const query = (selector) => document.querySelector(selector);

const elements = {
  rail: query(".rail"),
  workbench: query(".workbench"),
  appRoot: query(".app-root"),
  sidebarResizer: query("#sidebar-resizer"),
  source: query("#source"),
  sourceLineHighlight: query("#source-line-highlight"),
  sourceSize: query("#source-size"),
  render: query("#render"),
  file: query("#file-input"),
  examplePicker: query("#example-picker"),
  blockPickerWrap: query("#block-picker-wrap"),
  blockPicker: query("#block-picker"),
  viewport: query("#viewport"),
  stage: query("#stage"),
  canvasEmpty: query("#canvas-empty"),
  status: query("#status"),
  statusDot: query("#status-dot"),
  stats: query("#graph-stats"),
  search: query("#node-search"),
  groupIndex: query("#group-index"),
  indexSort: query("#index-sort"),
  nodeList: query("#node-list"),
  selection: query("#selection-content"),
  clearSelection: query("#clear-selection"),
  zoomLevel: query("#zoom-level"),
  zoomIn: query("#zoom-in"),
  zoomOut: query("#zoom-out"),
  fit: query("#fit"),
  actualSize: query("#actual-size"),
  shareLink: query("#share-link"),
  openSettings: query("#open-settings"),
  settingsDialog: query("#settings-dialog"),
  zoomSensitivity: query("#zoom-sensitivity"),
  zoomSensitivityValue: query("#zoom-sensitivity-value"),
  panSensitivity: query("#pan-sensitivity"),
  panSensitivityValue: query("#pan-sensitivity-value"),
  pointerDevice: query("#pointer-device"),
  resetSettings: query("#reset-settings"),
  panelResizers: [...document.querySelectorAll(".panel-resizer")],
};

let graph = emptyGraph();
let selectedKey = null;
let keyboardNavigation = null;
let diagramAnalysis = analyzeDiagram(sample);
let markdownBlocks = [];
let renderSequence = 0;
let appliedHash = "";
const collapsedGroupKeys = new Set();

const panels = createPanels(elements, { onSidebarResize: () => viewport.apply(), onIndexSettingsChange: () => renderNodeList() });
const viewport = createViewport({ viewport: elements.viewport, stage: elements.stage, zoomOutput: elements.zoomLevel, getSensitivity: () => panels.sensitivity });
const highlighter = createHighlighter({ stage: elements.stage, colorRoot: elements.appRoot });
const indexPanel = createIndexPanel({ container: elements.nodeList });

const currentTheme = () => elements.appRoot?.dataset.theme || "light";
configureMermaid(currentTheme());

function setStatus(message, state = "idle") {
  elements.status.textContent = message;
  elements.statusDot.className = `status-dot ${state}`;
}

const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

function extractMermaidBlocks(value) {
  return [...value.matchAll(/```mermaid\s*\n([\s\S]*?)```/gi)].map((match) => match[1].trim());
}

const activeSource = () => elements.source.value.trim();
const diagramSupportsRelationships = () => diagramAnalysis.mode === "relational";

function updateSourceMeta() {
  elements.sourceSize.textContent = `${elements.source.value.length.toLocaleString()} chars`;
  updateSourceLineHighlight();
}

function updateSourceLineHighlight(line = selectedKey ? graph.nodes.get(selectedKey)?.sourceLine ?? -1 : -1) {
  if (line == null || line < 0) {
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

function updateBlockPicker(selectedIndex = Number(elements.blockPicker.value) || 0) {
  const index = Math.min(Math.max(0, selectedIndex), Math.max(0, markdownBlocks.length - 1));
  elements.blockPickerWrap.hidden = markdownBlocks.length === 0;
  elements.blockPicker.innerHTML = markdownBlocks
    .map((block, position) => `<option value="${position}">Diagram ${position + 1} · ${escapeHTML(block.split("\n")[0])}</option>`)
    .join("");
  elements.blockPicker.value = String(index);
}

function loadSource(value, blockIndex = 0) {
  markdownBlocks = extractMermaidBlocks(value);
  const index = Math.min(Math.max(0, blockIndex), Math.max(0, markdownBlocks.length - 1));
  elements.source.value = markdownBlocks[index] || value;
  elements.examplePicker.value = "";
  updateBlockPicker(index);
  updateSourceMeta();
  updateSourceLineHighlight(-1);
}

function populateExamples() {
  const labels = { relational: "Relationship diagrams", ordered: "Ordered items", canvas: "Canvas charts" };
  const groups = viewerFixtures.reduce((result, entry) => {
    (result[analyzeDiagram(entry.source).mode] ||= []).push(entry);
    return result;
  }, {});
  elements.examplePicker.innerHTML = `<option value="">Examples</option>${Object.entries(groups).map(([mode, fixtures]) => (
    `<optgroup label="${labels[mode]}">${fixtures.map(({ id }) => `<option value="${id}">${escapeHTML(examples[id].label)}</option>`).join("")}</optgroup>`
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
    markdownBlocks[Number(elements.blockPicker.value) || 0] = elements.source.value;
    updateBlockPicker();
  }
  updateSourceMeta();
}

function renderNodeList() {
  indexPanel.render(graph, {
    query: elements.search.value,
    grouped: panels.indexSettings.grouped,
    sort: panels.indexSettings.sort,
    collapsed: collapsedGroupKeys,
    selected: selectedKey,
    emptyMessage: diagramAnalysis.mode === "canvas"
      ? "This chart has no parent/child relationships. Use the canvas controls to explore it."
      : "Render a diagram to build its index.",
  });
}

function relationshipRows(keys, relationship) {
  const records = [...keys].map((key) => graph.nodes.get(key)).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label));
  if (!records.length) return '<p class="hint relationship-empty">None</p>';
  return records.map(({ key, label }) => `
    <div class="relationship-row ${relationship}">
      <button type="button" data-node-key="${escapeHTML(key)}"><span>${escapeHTML(label)}</span><b>Select</b></button>
      <button type="button" data-zoom-key="${escapeHTML(key)}" class="zoom-node-button" aria-label="Zoom to ${escapeHTML(label)}">Zoom</button>
    </div>`).join("");
}

function renderSelectionPanel(selected) {
  const parents = graph.incoming.get(selected.key) || new Set();
  const children = graph.outgoing.get(selected.key) || new Set();
  const attachedCount = new Set([...parents, ...children]).size;
  const vocabulary = diagramAnalysis.vocabulary;
  const relationships = diagramSupportsRelationships() ? `
    <section class="relationship-group incoming">
      <h3><i></i>${vocabulary.incoming} <span>${parents.size}</span></h3>
      <div class="neighbor-list">${relationshipRows(parents, "incoming")}</div>
    </section>
    <section class="relationship-group outgoing">
      <h3><i></i>${vocabulary.outgoing} <span>${children.size}</span></h3>
      <div class="neighbor-list">${relationshipRows(children, "outgoing")}</div>
    </section>` : '<p class="hint relationship-note">This diagram is ordered visually, but does not define parent/child relationships. Select items to inspect their source and use Z to center them.</p>';
  const location = selected.groupLabel ? `<div class="selected-node-group">in ${escapeHTML(selected.groupLabel)}</div>` : "";
  elements.selection.className = "selection-content";
  elements.selection.innerHTML = `
    <div class="selected-node-heading">
      <div class="selected-node-name">${escapeHTML(selected.label)}</div>
      <button type="button" data-zoom-key="${escapeHTML(selected.key)}" class="zoom-here-button">Zoom here</button>
    </div>
    ${location}
    <div class="connection-count">${diagramSupportsRelationships() ? `${attachedCount} directly attached ${attachedCount === 1 ? "item" : "items"}` : "Source-linked item"}${selected.sourceLine != null ? ` · line ${selected.sourceLine + 1}` : ""}</div>
    ${relationships}`;
}

function selectNode(key) {
  const selected = graph.nodes.get(key);
  if (!selected) return;
  clearKeyboardPreview();
  selectedKey = key;
  highlighter.select(graph, key);
  renderSelectionPanel(selected);
  elements.clearSelection.disabled = false;
  updateSourceLineHighlight();
  indexPanel.setActive(key);
}

function clearSelection() {
  clearKeyboardPreview();
  selectedKey = null;
  highlighter.clear(graph);
  elements.selection.className = "empty-state";
  elements.selection.textContent = "Select any node to isolate its immediate connections.";
  elements.clearSelection.disabled = true;
  updateSourceLineHighlight(-1);
  indexPanel.setActive(null);
}

function resolveNodeKey(candidate) {
  if (!candidate) return undefined;
  if (graph.nodes.has(candidate)) return candidate;
  const needle = candidate.toLocaleLowerCase();
  return [...graph.nodes.values()].find((node) => node.key.toLocaleLowerCase() === needle || node.label.toLocaleLowerCase() === needle)?.key;
}

function clearKeyboardPreview() {
  keyboardNavigation = null;
  highlighter.clearPreview();
  elements.selection.querySelectorAll(".keyboard-preview, .keyboard-browse-active").forEach((element) => {
    element.classList.remove("keyboard-preview", "keyboard-browse-active");
  });
}

function showKeyboardPreview() {
  elements.selection.querySelectorAll(".keyboard-preview, .keyboard-browse-active").forEach((element) => {
    element.classList.remove("keyboard-preview", "keyboard-browse-active");
  });
  const key = keyboardNavigation?.candidates[keyboardNavigation.index];
  if (!key) return;
  const edge = graph.edges.find((candidate) => keyboardNavigation.relationship === "parent"
    ? candidate.from === key && candidate.to === selectedKey
    : candidate.from === selectedKey && candidate.to === key);
  highlighter.preview(graph, key, edge);
  const row = elements.selection.querySelector(`.relationship-row [data-node-key="${CSS.escape(key)}"]`)?.closest(".relationship-row");
  row?.classList.add("keyboard-preview");
  row?.closest(".relationship-group")?.classList.add("keyboard-browse-active");
  row?.scrollIntoView({ block: "nearest" });
  viewport.reveal([graph.nodes.get(selectedKey)?.element, graph.nodes.get(key)?.element]);
}

function browseRelationship(relationship) {
  const connections = relationship === "parent" ? graph.incoming.get(selectedKey) : graph.outgoing.get(selectedKey);
  const candidates = [...(connections || [])].sort((a, b) => (graph.nodes.get(a)?.label || a).localeCompare(graph.nodes.get(b)?.label || b));
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
  keyboardNavigation.index = (keyboardNavigation.index + direction + keyboardNavigation.candidates.length) % keyboardNavigation.candidates.length;
  showKeyboardPreview();
  return true;
}

function commitKeyboardPreview() {
  const key = keyboardNavigation?.candidates[keyboardNavigation.index];
  if (!key) return false;
  selectNode(key);
  viewport.reveal([graph.nodes.get(key)?.element]);
  graph.nodes.get(key)?.element.focus({ preventScroll: true });
  return true;
}

function zoomSelectedNode() {
  if (!selectedKey) return false;
  const key = selectedKey;
  clearKeyboardPreview();
  viewport.zoomToElement(graph.nodes.get(key)?.element);
  graph.nodes.get(key)?.element.focus({ preventScroll: true });
  return true;
}

function indexRenderedGraph(svg) {
  graph = buildGraph({ svg, analysis: diagramAnalysis, scale: viewport.state.scale });
  elements.stage.classList.toggle("atlas-large", graph.nodes.size > 1500);
  elements.stats.textContent = graph.nodes.size
    ? `${graph.nodes.size.toLocaleString()} items · ${graph.edges.length.toLocaleString()} relations`
    : `${diagramAnalysis.id} · canvas view`;
  renderNodeList();
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
  elements.render.disabled = true;
  elements.render.textContent = "Rendering…";
  setStatus("Laying out diagram…", "working");
  clearSelection();

  try {
    // Let the status paint before Mermaid's synchronous layout work starts.
    await nextPaint();
    if (sequence !== renderSequence) return;
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
    setStatus("Indexing graph…", "working");
    await nextPaint();
    if (sequence !== renderSequence) return;
    indexRenderedGraph(renderedSVG);
    if (selectionToRestore) selectNode(selectionToRestore);
    if (shouldPreserveView) viewport.apply();
    else {
      const revisionBeforeFit = viewport.revision;
      requestAnimationFrame(() => {
        if (sequence === renderSequence && selectedKey === null && viewport.revision === revisionBeforeFit) viewport.fit();
      });
    }
    setStatus("Diagram ready", "ready");
  } catch (error) {
    if (sequence !== renderSequence) return;
    elements.stage.innerHTML = "";
    elements.canvasEmpty.hidden = false;
    elements.canvasEmpty.querySelector("p").textContent = "Mermaid could not render this source.";
    elements.canvasEmpty.querySelector("small").textContent = error?.message?.split("\n")[0] || "Check the syntax and try again.";
    setStatus("Render failed", "error");
    elements.stats.textContent = "Invalid diagram";
    graph = emptyGraph();
    renderNodeList();
  } finally {
    if (sequence === renderSequence) {
      elements.render.disabled = false;
      elements.render.textContent = "Render diagram";
    }
  }
}

async function copyShareLink() {
  const source = activeSource();
  if (!source) {
    setStatus("Add Mermaid source first", "error");
    return;
  }
  try {
    const url = await buildShareUrl(window.location, source, { theme: currentTheme() });
    const shareHash = new URL(url).hash;
    if (shareHash.length < 100_000) {
      appliedHash = shareHash;
      history.replaceState(null, "", url);
    }
    await navigator.clipboard?.writeText(url);
    setStatus(navigator.clipboard ? "Share link copied" : "Share link is in the address bar", "ready");
  } catch (error) {
    setStatus(`Could not copy link: ${error.message}`, "error");
  }
}

async function loadFromHash(hash) {
  if (!hash || hash === appliedHash) return false;
  const shared = await decodeSharedSource(hash);
  if (shared == null) return false;
  appliedHash = hash;
  loadSource(shared);
  return true;
}

async function applyLaunchOptions() {
  const options = readLaunchOptions();
  let loaded = false;
  try {
    if (options.src) {
      setStatus("Loading source from URL…", "working");
      loadSource(await fetchSource(options.src), (options.block || 1) - 1);
      loaded = true;
    } else if (options.example && examples[options.example]) {
      elements.source.value = examples[options.example].source;
      elements.examplePicker.value = options.example;
      updateSourceMeta();
      loaded = true;
    } else loaded = await loadFromHash(options.hash);
  } catch (error) {
    setStatus(`Could not load source: ${error.message}`, "error");
  }
  if (!loaded) loadSource(sample);
  await renderDiagram();
  const key = resolveNodeKey(options.select);
  if (key) {
    selectNode(key);
    viewport.zoomToElement(graph.nodes.get(key)?.element, false);
  }
}

elements.stage.addEventListener("click", (event) => {
  if (event.defaultPrevented) return;
  const node = event.target.closest("[data-graph-key]");
  if (!node) return;
  event.stopPropagation();
  selectNode(node.dataset.graphKey);
});
elements.stage.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const node = event.target.closest("[data-graph-key]");
  if (!node || (event.key === "Enter" && keyboardNavigation)) return;
  event.preventDefault();
  selectNode(node.dataset.graphKey);
});
elements.viewport.addEventListener("click", (event) => {
  if (viewport.consumeSuppressedClick()) return;
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
elements.render.addEventListener("click", () => renderDiagram());
elements.file.addEventListener("change", async () => {
  const file = elements.file.files?.[0];
  if (!file) return;
  loadSource(await file.text());
  await renderDiagram();
});
elements.examplePicker.addEventListener("change", () => loadExample(elements.examplePicker.value));
elements.search.addEventListener("input", renderNodeList);
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
    viewport.zoomToElement(graph.nodes.get(button.dataset.nodeKey)?.element);
  }
});
elements.selection.addEventListener("click", (event) => {
  const zoomButton = event.target.closest("[data-zoom-key]");
  if (zoomButton) {
    viewport.zoomToElement(graph.nodes.get(zoomButton.dataset.zoomKey)?.element);
    return;
  }
  const button = event.target.closest("[data-node-key]");
  if (button) {
    selectNode(button.dataset.nodeKey);
    viewport.reveal([graph.nodes.get(button.dataset.nodeKey)?.element]);
  }
});
elements.clearSelection.addEventListener("click", clearSelection);
elements.zoomIn.addEventListener("click", () => viewport.setZoom(viewport.state.scale * 1.25, undefined, undefined, true));
elements.zoomOut.addEventListener("click", () => viewport.setZoom(viewport.state.scale / 1.25, undefined, undefined, true));
elements.fit.addEventListener("click", () => viewport.fit(true));
elements.actualSize.addEventListener("click", () => viewport.setZoom(1, undefined, undefined, true));
elements.shareLink?.addEventListener("click", copyShareLink);
window.addEventListener("resize", () => elements.stage.querySelector("svg") && viewport.fit());
window.addEventListener("hashchange", async () => {
  if (await loadFromHash(window.location.hash)) renderDiagram();
});
window.addEventListener("atlas-theme-change", (event) => {
  configureMermaid(event.detail?.theme);
  highlighter.invalidateColors();
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

// Development hook so the graph model can be inspected from the console or tests.
if (import.meta.env.DEV) window.atlasDebug = () => ({ graph, analysis: diagramAnalysis, selectedKey });

populateExamples();
applyLaunchOptions();
