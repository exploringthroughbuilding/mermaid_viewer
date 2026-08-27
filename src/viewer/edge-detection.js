// Finds rendered edges and resolves their endpoints to node keys. Endpoints
// come from data attributes when present, then from id / class tokens, and
// finally from geometry (where the line starts and ends on screen).
import { createBoxIndex, pathEndpoints } from "./svg-geometry.js";

const FLOW_EDGES = ["path.flowchart-link", "g.edgePaths > path", "g.edges > path", "g.edgePath > path"];
const edgeRules = {
  flowchart: FLOW_EDGES,
  swimlane: FLOW_EDGES,
  block: ["path.flowchart-link"],
  class: ["g.edgePaths > path"],
  state: ["g.edgePaths > path:not(.note-edge)"],
  er: ["g.edgePaths > path"],
  requirement: ["g.edgePaths > path"],
  mindmap: ["g.edgePaths > path"],
  treeView: ["g.edgePaths > path"],
  treemap: ["g.edgePaths > path"],
  ishikawa: ["g.edgePaths > path"],
  architecture: ["g.architecture-edges path.edge"],
  sequence: ["line.messageLine0", "line.messageLine1", "path.messageLine0", "path.messageLine1"],
  zenuml: ["g.message > line.message-line", "g.return > line.return-line"],
  c4: ["line[marker-end]", "path[marker-end]"],
  sankey: ["g.links path"],
};
const DEFAULT_EDGE_RULES = ["path[marker-end]", "line[marker-end]", "path[marker-start]", "line[marker-start]"];
const labelStrategies = { sequence: "sibling", c4: "geometry", zenuml: "geometry", architecture: "geometry" };
const columnMetric = new Set(["sequence", "zenuml"]);

function stripPrefix(id, svgId) {
  if (!id) return "";
  return id.startsWith(`${svgId}-`) ? id.slice(svgId.length + 1) : id;
}

// Every string that may stand for a node inside an edge id.
export function createTokenMap(nodes, kind) {
  const tokens = new Map();
  const register = (token, key) => {
    if (!token) return;
    if (!tokens.has(token)) tokens.set(token, key);
    const lower = String(token).toLocaleLowerCase();
    if (!tokens.has(lower)) tokens.set(lower, key);
  };
  nodes.forEach((node, key) => {
    register(key, key);
    register(node.rawKey, key);
    register(node.domId, key);
    node.aliases.forEach((alias) => register(alias, key));
    const indexed = node.domId?.match(/^node[_-](\d+)$/);
    if (indexed && (kind === "mindmap" || kind === "sankey")) register(indexed[1], key);
  });
  return (token) => (token == null ? undefined : tokens.get(String(token)) ?? tokens.get(String(token).toLocaleLowerCase()));
}

function splitPair(value, resolve) {
  for (const separator of ["_", "-"]) {
    const found = [];
    let index = value.indexOf(separator);
    while (index > 0) {
      const from = resolve(value.slice(0, index));
      const to = resolve(value.slice(index + 1));
      if (from && to) found.push({ from, to, size: index });
      index = value.indexOf(separator, index + 1);
    }
    if (found.length) return found.sort((a, b) => b.size - a.size)[0];
  }
  return undefined;
}

function endpointsFromTokens(element, svgId, resolve) {
  const classes = [...element.classList];
  const start = classes.find((name) => name.startsWith("LS-"));
  const end = classes.find((name) => name.startsWith("LE-"));
  if (start && end) {
    const from = resolve(start.slice(3));
    const to = resolve(end.slice(3));
    if (from && to) return { from, to };
  }
  const candidates = [element.dataset.id, stripPrefix(element.id, svgId)].filter(Boolean);
  for (const candidate of candidates) {
    const core = stripPrefix(candidate, svgId).replace(/^(?:L|id|edge)_/, "").replace(/^\d+-/, "");
    const pair = splitPair(core, resolve) || splitPair(core.replace(/[_-]\d+$/, ""), resolve);
    if (pair) return { from: pair.from, to: pair.to };
  }
  return undefined;
}

function endpointsFromGeometry(element, index, scale, metric) {
  const { start, end } = pathEndpoints(element);
  const tolerance = 6 * scale;
  const reach = (metric === "column" ? 48 : 36) * scale;
  const from = index.locate(start, tolerance) || index.nearest(start, reach, metric);
  const to = index.locate(end, tolerance) || index.nearest(end, reach, metric);
  if (!from || !to) return undefined;
  return { from: from.key, to: to.key };
}

function labelLookup(svg, strategy) {
  if (strategy === "geometry") {
    return { texts: [...svg.querySelectorAll("text")].filter((text) => !text.closest(".atlas-node, defs, marker") && text.textContent.trim()), used: new Set() };
  }
  const byId = new Map();
  svg.querySelectorAll("g.edgeLabel .label[data-id], g.edgeLabel[data-id]").forEach((label) => {
    byId.set(label.dataset.id, label.closest("g.edgeLabel"));
  });
  return { byId };
}

function labelFor(element, strategy, lookup, scale) {
  if (strategy === "sibling") {
    const previous = element.previousElementSibling;
    return previous && (previous.matches("text.messageText") || previous.tagName.toLowerCase() === "foreignobject") ? previous : undefined;
  }
  if (strategy === "geometry") {
    const { middle } = pathEndpoints(element);
    let best;
    let bestDistance = 40 * scale;
    lookup.texts.forEach((text) => {
      if (lookup.used.has(text)) return;
      const rect = text.getBoundingClientRect();
      const distance = Math.hypot(rect.left + rect.width / 2 - middle.x, rect.top + rect.height / 2 - middle.y);
      if (distance < bestDistance) {
        best = text;
        bestDistance = distance;
      }
    });
    if (best) lookup.used.add(best);
    return best;
  }
  return element.dataset.id ? lookup.byId.get(element.dataset.id) : undefined;
}

// Returns visual edges: { from, to, element, label, markerStart, markerEnd }.
export function detectEdges(svg, analysis, nodes, scale = 1) {
  const kind = analysis.id;
  const rules = edgeRules[kind] || DEFAULT_EDGE_RULES;
  const elements = [...svg.querySelectorAll(rules.join(", "))].filter((element) => !element.closest(".atlas-node, defs, marker"));
  if (!elements.length) return [];
  const resolve = createTokenMap(nodes, kind);
  const index = createBoxIndex([...nodes.values()].map((node) => ({ key: node.key, box: node.box })));
  const metric = columnMetric.has(kind) ? "column" : "box";
  const strategy = labelStrategies[kind] || "dataId";
  const lookup = labelLookup(svg, strategy);

  const edges = [];
  elements.forEach((element) => {
    const attributes = element.dataset.from && element.dataset.to
      ? { from: resolve(element.dataset.from), to: resolve(element.dataset.to) }
      : undefined;
    const endpoints = (attributes?.from && attributes?.to ? attributes : undefined)
      || endpointsFromTokens(element, svg.id, resolve)
      || endpointsFromGeometry(element, index, scale, metric);
    if (!endpoints || endpoints.from === endpoints.to) return;
    edges.push({
      from: endpoints.from,
      to: endpoints.to,
      element,
      label: labelFor(element, strategy, lookup, scale),
      markerStart: element.getAttribute("marker-start"),
      markerEnd: element.getAttribute("marker-end"),
    });
  });
  return edges;
}
