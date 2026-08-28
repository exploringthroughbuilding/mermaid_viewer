import { atlasApi } from "../viewer/controller.js";

const stepDuration = 520;
let tour = null;
let bar = null;
let disposeRenderSubscription = null;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

/** The bar sits outside `.app-root`, so it cannot inherit the theme selector. */
function syncTheme() {
  if (!bar) return;
  bar.dataset.theme = document.querySelector(".app-root")?.dataset.theme || "light";
}

window.addEventListener("atlas-theme-change", syncTheme);

/**
 * The bar lives on <body> rather than inside the React tree: ViewerPage
 * re-renders wholesale on a theme change, which would reconcile away any DOM
 * appended into its subtree.
 */
function ensureBar() {
  if (bar) return bar;
  bar = document.createElement("div");
  bar.className = "walkthrough-bar";
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Guided walkthrough");
  bar.hidden = true;
  bar.innerHTML = `
    <div class="walkthrough-head">
      <span class="walkthrough-badge">Walkthrough</span>
      <p class="walkthrough-title"></p>
      <button type="button" class="walkthrough-close" aria-label="Exit walkthrough">×</button>
    </div>
    <div class="walkthrough-body">
      <p class="walkthrough-node"></p>
      <p class="walkthrough-caption"></p>
    </div>
    <div class="walkthrough-progress" aria-hidden="true"></div>
    <div class="walkthrough-controls">
      <button type="button" class="walkthrough-prev">Back</button>
      <output class="walkthrough-counter" aria-live="polite"></output>
      <button type="button" class="walkthrough-next primary">Next</button>
    </div>`;
  document.body.append(bar);
  syncTheme();

  bar.querySelector(".walkthrough-prev").addEventListener("click", () => step(-1));
  bar.querySelector(".walkthrough-next").addEventListener("click", () => step(1));
  bar.querySelector(".walkthrough-close").addEventListener("click", endWalkthrough);
  bar.querySelector(".walkthrough-progress").addEventListener("click", (event) => {
    const index = Number(event.target.dataset?.stepIndex);
    if (Number.isInteger(index)) goToStep(index);
  });
  return bar;
}

function clearHighlights() {
  const graph = atlasApi.getGraph();
  graph.nodes.forEach((node) => {
    node.element?.classList.remove("atlas-walk-path", "atlas-walk-current");
  });
  graph.edges.forEach((edge) => {
    [...edge.pathParts, ...edge.arrowParts, ...edge.labelParts].forEach((part) => part.classList.remove("atlas-walk-edge"));
    atlasApi.setEdgeOverlay(edge, "walkthrough", false);
  });
}

function edgeBetween(fromId, toId) {
  return atlasApi.getGraph().edges.find((edge) => (
    (edge.from === fromId && edge.to === toId) || (edge.from === toId && edge.to === fromId)
  ));
}

/**
 * Selection already paints the current node and its direct neighbours; the
 * walkthrough classes sit on top so the whole route stays legible instead of
 * being dimmed away with the rest of the graph.
 */
function paintStep(index) {
  const graph = atlasApi.getGraph();
  clearHighlights();
  tour.steps.forEach(({ nodeId }) => {
    graph.nodes.get(nodeId)?.element?.classList.add("atlas-walk-path");
  });
  const current = tour.steps[index];
  graph.nodes.get(current.nodeId)?.element?.classList.add("atlas-walk-current");

  const previous = tour.steps[index - 1];
  if (!previous) return;
  const edge = edgeBetween(previous.nodeId, current.nodeId);
  if (!edge) return;
  [...edge.pathParts, ...edge.arrowParts, ...edge.labelParts].forEach((part) => part.classList.add("atlas-walk-edge"));
  atlasApi.setEdgeOverlay(edge, "walkthrough", true);
}

function renderBar(index) {
  const view = ensureBar();
  const current = tour.steps[index];
  view.hidden = false;
  view.querySelector(".walkthrough-title").textContent = tour.title;
  view.querySelector(".walkthrough-node").textContent = current.label;
  view.querySelector(".walkthrough-caption").textContent = current.caption || "";
  view.querySelector(".walkthrough-counter").textContent = `${index + 1} / ${tour.steps.length}`;
  view.querySelector(".walkthrough-prev").disabled = index === 0;
  view.querySelector(".walkthrough-next").disabled = index === tour.steps.length - 1;
  view.querySelector(".walkthrough-progress").innerHTML = tour.steps
    .map((stepEntry, stepIndex) => (
      `<button type="button" data-step-index="${stepIndex}" class="${stepIndex === index ? "active" : ""}${stepIndex < index ? " visited" : ""}" aria-label="Step ${stepIndex + 1}: ${escapeHTML(stepEntry.label)}"></button>`
    ))
    .join("");
}

export async function goToStep(index) {
  if (!tour) return null;
  const bounded = Math.max(0, Math.min(index, tour.steps.length - 1));
  tour.index = bounded;
  const current = tour.steps[bounded];

  atlasApi.selectNode(current.nodeId);
  paintStep(bounded);
  renderBar(bounded);
  await atlasApi.animateCameraTo(atlasApi.cameraTargetForNode(current.nodeId), stepDuration);
  return { index: bounded, ...current, total: tour.steps.length };
}

export function step(delta) {
  if (!tour) return null;
  return goToStep(tour.index + delta);
}

export function endWalkthrough() {
  if (!tour) return;
  clearHighlights();
  tour = null;
  if (bar) bar.hidden = true;
  disposeRenderSubscription?.();
  disposeRenderSubscription = null;
  atlasApi.clearSelection();
}

export function activeWalkthrough() {
  if (!tour) return null;
  return {
    title: tour.title,
    index: tour.index,
    total: tour.steps.length,
    steps: tour.steps.map(({ nodeId, label, caption }) => ({ nodeId, label, caption })),
  };
}

/**
 * Build a tour from an agent-supplied path. Unknown node ids are rejected up
 * front rather than failing silently mid-walk, and the caller gets told exactly
 * which ones were wrong.
 */
export async function startWalkthrough({ title = "Guided walkthrough", steps = [] } = {}) {
  const graph = atlasApi.getGraph();
  if (!steps.length) return { ok: false, reason: "no_steps" };

  const unknown = steps.filter(({ nodeId }) => !graph.nodes.has(nodeId)).map(({ nodeId }) => nodeId);
  if (unknown.length) return { ok: false, reason: "unknown_nodes", unknown };

  const missingEdges = steps.slice(1)
    .filter((entry, index) => !edgeBetween(steps[index].nodeId, entry.nodeId))
    .map((entry, index) => `${steps[index].nodeId} -> ${entry.nodeId}`);

  tour = {
    title,
    index: 0,
    steps: steps.map(({ nodeId, caption }) => ({
      nodeId,
      caption: caption || "",
      label: graph.nodes.get(nodeId).label,
    })),
  };

  // A re-render replaces every SVG element the tour points at.
  disposeRenderSubscription?.();
  disposeRenderSubscription = atlasApi.onRender(() => endWalkthrough());

  await goToStep(0);
  return { ok: true, title, total: tour.steps.length, disconnectedSteps: missingEdges };
}

/** Arrow keys drive the tour while one is running, ahead of relationship browsing. */
window.addEventListener("keydown", (event) => {
  if (!tour) return;
  if (event.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
  if (event.key === "ArrowRight") { event.stopPropagation(); event.preventDefault(); step(1); }
  else if (event.key === "ArrowLeft") { event.stopPropagation(); event.preventDefault(); step(-1); }
  else if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); endWalkthrough(); }
}, true);
