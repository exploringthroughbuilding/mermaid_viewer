// Registry of diagram families. Each adapter detects its grammar, parses the
// source into items / relations / groups, and tells the viewer which SVG
// elements are selectable. Rendering concerns live in src/viewer.
import { parseClass } from "./parsers/class.js";
import { collection, sourceRows } from "./parsers/common.js";
import { parseFlowchart } from "./parsers/flowchart.js";
import {
  kanbanNode, mindmapNode, parseGantt, parseGit, parseIndented, parseJourney, parseOrdered, parseTimeline, treeNode,
} from "./parsers/hierarchy.js";
import { parseArchitecture, parseC4, parseER, parseRequirement, parseSankey, parseWardley } from "./parsers/misc.js";
import { parseSequence, parseZenuml } from "./parsers/sequence.js";
import { parseState } from "./parsers/state.js";

const RELATIONAL = "relational";
const ORDERED = "ordered";
const CANVAS = "canvas";

const selectorSets = {
  graph: ["g.node", "g.icon-shape", "g.image-shape"],
  sequence: ['g[data-et="participant"]', "g.actor"],
  zenuml: ["g.participant:not(.participant-starter)"],
  architecture: ["g.architecture-service", "g.architecture-junction"],
  gantt: ["rect.task"],
  timeline: ["g.timeline-node"],
  git: ["circle.commit"],
  sankey: ["g.nodes > g.node"],
  packet: ["g.packetBlock", "g.packet-field", "g.node"],
};

function normalize(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/["'`()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function loose(value) {
  return normalize(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

const indented = (declaration, options = {}) => (rows) => parseIndented(rows, { declaration, ...options });
const ordered = (declaration) => (rows) => parseOrdered(rows, declaration);

const adapters = [
  { id: "flowchart", detect: /^(?:flowchart|graph)(?:-elk)?\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Parents", "Children"], parse: (rows) => parseFlowchart(rows) },
  { id: "block", detect: /^block-beta\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Incoming", "Outgoing"], parse: (rows) => parseFlowchart(rows, { block: true }) },
  { id: "sequence", detect: /^sequenceDiagram\b/i, mode: RELATIONAL, selectors: selectorSets.sequence, vocabulary: ["Receives from", "Sends to"], parse: parseSequence },
  { id: "zenuml", detect: /^zenuml\b/i, mode: RELATIONAL, selectors: selectorSets.zenuml, vocabulary: ["Receives from", "Sends to"], parse: parseZenuml },
  { id: "class", detect: /^classDiagram\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Referenced by", "References"], parse: parseClass },
  { id: "state", detect: /^stateDiagram(?:-v2)?\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Previous states", "Next states"], parse: parseState },
  { id: "er", detect: /^erDiagram\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Related from", "Related to"], parse: parseER },
  { id: "architecture", detect: /^architecture-beta\b/i, mode: RELATIONAL, selectors: selectorSets.architecture, vocabulary: ["Upstream", "Downstream"], parse: parseArchitecture },
  { id: "swimlane", detect: /^swimlane(?:-beta)?\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Previous steps", "Next steps"], parse: (rows) => parseFlowchart(rows) },
  { id: "requirement", detect: /^requirementDiagram\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Related from", "Related to"], parse: parseRequirement },
  { id: "sankey", detect: /^sankey-beta\b/i, mode: RELATIONAL, selectors: selectorSets.sankey, vocabulary: ["Inputs", "Outputs"], parse: parseSankey },
  { id: "mindmap", detect: /^mindmap\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Parent", "Children"], parse: indented(/^mindmap$/i, { nodeFor: mindmapNode }) },
  { id: "treeView", detect: /^treeView-beta\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Parent", "Children"], parse: indented(/^treeView-beta$/i) },
  { id: "treemap", detect: /^treemap-beta\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Parent", "Children"], parse: indented(/^treemap-beta$/i, { nodeFor: treeNode }) },
  { id: "ishikawa", detect: /^ishikawa-beta\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Effect", "Causes"], parse: indented(/^ishikawa-beta$/i) },
  { id: "wardley", detect: /^wardley-beta\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Depends on", "Supports"], parse: parseWardley },
  { id: "gantt", detect: /^gantt\b/i, mode: RELATIONAL, selectors: selectorSets.gantt, vocabulary: ["Depends on", "Unblocks"], parse: parseGantt },
  { id: "kanban", detect: /^kanban\b/i, mode: ORDERED, selectors: selectorSets.graph, parse: indented(/^kanban$/i, { nodeFor: kanbanNode, columnsAsGroups: true, relational: false }) },
  { id: "eventmodeling", detect: /^eventModeling\b/i, mode: ORDERED, selectors: selectorSets.graph, parse: ordered(/^eventModeling$/i) },
  { id: "timeline", detect: /^timeline\b/i, mode: ORDERED, selectors: selectorSets.timeline, parse: parseTimeline },
  { id: "gitGraph", detect: /^gitGraph\b/i, mode: ORDERED, selectors: selectorSets.git, parse: parseGit },
  { id: "journey", detect: /^journey\b/i, mode: ORDERED, selectors: selectorSets.gantt, parse: parseJourney },
  { id: "packet", detect: /^packet-beta\b/i, mode: ORDERED, selectors: selectorSets.packet, parse: ordered(/^packet-beta$/i) },
  { id: "railroad", detect: /^(?:railroad|ebnf|abnf|peg)\b/i, mode: ORDERED, selectors: selectorSets.graph, parse: ordered(/^(?:railroad|ebnf|abnf|peg)\b/i) },
  { id: "pie", detect: /^pie\b/i, mode: CANVAS, selectors: [], parse: ordered(/^pie\b/i) },
  { id: "quadrantChart", detect: /^quadrantChart\b/i, mode: CANVAS, selectors: [], parse: ordered(/^quadrantChart$/i) },
  { id: "xychart", detect: /^xychart-beta\b/i, mode: CANVAS, selectors: [], parse: ordered(/^xychart-beta$/i) },
  { id: "radar", detect: /^radar-beta\b/i, mode: CANVAS, selectors: [], parse: ordered(/^radar-beta$/i) },
  { id: "venn", detect: /^venn-beta\b/i, mode: CANVAS, selectors: [], parse: ordered(/^venn-beta$/i) },
  { id: "cynefin", detect: /^cynefin-beta\b/i, mode: CANVAS, selectors: [], parse: ordered(/^cynefin-beta$/i) },
  { id: "c4", detect: /^C4(?:Context|Container|Component|Dynamic|Deployment)\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Referenced by", "References"], parse: parseC4 },
  { id: "info", detect: /^info\b/i, mode: CANVAS, selectors: [], parse: () => collection() },
];

function declarationFor(source) {
  const rows = sourceRows(source);
  let inFrontmatter = rows[0]?.text === "---";
  for (const row of rows) {
    if (inFrontmatter) {
      if (row.line > 0 && row.text === "---") inFrontmatter = false;
      continue;
    }
    if (row.text && !row.text.startsWith("%%")) return row.text;
  }
  return "";
}

function diagramRows(source) {
  const rows = sourceRows(source);
  if (rows[0]?.text !== "---") return rows;
  const closingIndex = rows.findIndex((row) => row.line > 0 && row.text === "---");
  return closingIndex < 0 ? rows : rows.slice(closingIndex + 1);
}

function addTo(map, key, item) {
  if (!key) return;
  const list = map.get(key);
  if (list) {
    if (!list.includes(item)) list.push(item);
  } else map.set(key, [item]);
}

function createSemanticIndex(items) {
  const byKey = new Map();
  const byAlias = new Map();
  const byLoose = new Map();
  items.forEach((item) => {
    byKey.set(item.key, item);
    item.aliases.forEach((alias) => {
      addTo(byAlias, normalize(alias), item);
      addTo(byLoose, loose(alias), item);
    });
  });
  return { byKey, byAlias, byLoose };
}

export function analyzeDiagram(source) {
  const declaration = declarationFor(source);
  const adapter = adapters.find((candidate) => candidate.detect.test(declaration)) || {
    id: "diagram",
    mode: CANVAS,
    selectors: [],
    parse: () => collection(),
  };
  const parsed = adapter.parse(diagramRows(source));
  const items = [...parsed.items.values()];
  const groupsByKey = new Map(parsed.groups.map((group) => [group.key, group]));
  return {
    id: adapter.id,
    mode: adapter.mode,
    selectors: adapter.selectors,
    vocabulary: { incoming: adapter.vocabulary?.[0] || "Incoming", outgoing: adapter.vocabulary?.[1] || "Outgoing" },
    items,
    relations: parsed.relations,
    groups: parsed.groups,
    groupsByKey,
    index: createSemanticIndex(items),
  };
}

// Labels from the outermost group to the named one, e.g. ["Backend", "Store"].
export function groupPath(analysis, groupKey) {
  const path = [];
  let current = analysis.groupsByKey.get(groupKey);
  const seen = new Set();
  while (current && !seen.has(current.key)) {
    seen.add(current.key);
    path.unshift(current.label);
    current = current.parent ? analysis.groupsByKey.get(current.parent) : undefined;
  }
  return path;
}

// Exact matching only: a rendered node is tied to a source item when its key
// or label equals one of the item's aliases. Substring matching used to bind
// "B" to any item whose alias merely contained a "b".
export function matchSemanticItem(analysis, key, label, usedKeys = new Set()) {
  const { byKey, byAlias, byLoose } = analysis.index;
  const candidates = [];
  if (key && byKey.has(key)) candidates.push(byKey.get(key));
  [key, label].forEach((value) => candidates.push(...(byAlias.get(normalize(value)) || [])));
  [key, label].forEach((value) => {
    const relaxed = loose(value);
    if (relaxed) candidates.push(...(byLoose.get(relaxed) || []));
  });
  return candidates.find((item) => !usedKeys.has(item.key));
}

export const supportedDiagramAdapters = adapters.map(({ id, mode }) => ({ id, mode }));
