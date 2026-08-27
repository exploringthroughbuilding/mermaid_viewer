const RELATIONAL = "relational";
const ORDERED = "ordered";
const CANVAS = "canvas";

const selectorSets = {
  graph: ["g.node"],
  sequence: ['g[data-et="participant"]', "g.actor"],
  zenuml: ["g.participant:not(.participant-starter)"],
  architecture: ['g[id*="-service-"]', 'g[id*="-group-"]'],
  gantt: ["rect.task"],
  timeline: ["g.timeline-node"],
  git: ["circle.commit"],
  requirement: ["g.requirement", "g.element"],
  kanban: ["g.kanban-item", "g.node"],
  packet: ["g.packetBlock", "g.packet-field"],
  tree: ["g.node"],
};

function normalize(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/["'`()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function sourceRows(source) {
  return source.split("\n").map((raw, line) => ({ raw, line, text: raw.trim(), indent: raw.match(/^\s*/)?.[0].length || 0 }));
}

function collection() {
  const items = new Map();
  const relations = [];
  const addItem = (key, label, line, aliases = []) => {
    const cleanKey = String(key || label || "").trim();
    const cleanLabel = String(label || key || "").trim().replace(/^['"]|['"]$/g, "");
    if (!cleanKey || !cleanLabel) return undefined;
    const existing = items.get(cleanKey);
    const nextAliases = [...new Set([cleanKey, cleanLabel, ...aliases].filter(Boolean))];
    if (existing) {
      existing.aliases = [...new Set([...existing.aliases, ...nextAliases])];
      if (existing.line == null && line != null) existing.line = line;
      return existing;
    }
    const item = { key: cleanKey, label: cleanLabel, line, aliases: nextAliases };
    items.set(cleanKey, item);
    return item;
  };
  const addRelation = (from, to, line, label = "") => {
    if (!from || !to || from === to) return;
    addItem(from, from, line);
    addItem(to, to, line);
    if (!relations.some((relation) => relation.from === from && relation.to === to && relation.line === line)) {
      relations.push({ from, to, line, label });
    }
  };
  return { items, relations, addItem, addRelation };
}

function identifier(fragment) {
  const match = fragment.trim().match(/^([A-Za-z_][\w.-]*)/);
  return match?.[1];
}

function displayLabel(fragment, fallback) {
  return fragment.match(/[\[(]{1,2}["']?([^\])"']+)["']?[\])]{1,2}/)?.[1]?.trim() || fallback;
}

function parseGraph(rows) {
  const result = collection();
  rows.forEach(({ text, line }) => {
    if (!text || text.startsWith("%%") || /^(flowchart|graph|block-beta|columns|direction)\b/i.test(text)) return;
    const declaration = text.match(/^(?:class\s+)?([A-Za-z_][\w.-]*)\s*(?:\[|\(|\{|>|@\{)/);
    if (declaration) result.addItem(declaration[1], displayLabel(text.slice(declaration.index), declaration[1]), line);
    const architecture = text.match(/^([A-Za-z_][\w.-]*):[LRBT]\s+[-=.]+>\s+[LRBT]:([A-Za-z_][\w.-]*)/);
    if (architecture) result.addRelation(architecture[1], architecture[2], line);
    const arrow = text.match(/^(.+?)\s*(<[-=.]+>|[-=.]+>|<[-=.]+|[-=.]+)\s*(.+?)(?:\s*:\s*(.*))?$/);
    if (!arrow) return;
    const left = identifier(arrow[1]);
    const inlineLabel = arrow[3].match(/^\|([^|]+)\|\s*(.+)$/);
    const rightFragment = inlineLabel?.[2] || arrow[3];
    const right = identifier(rightFragment);
    if (!left || !right) return;
    result.addItem(left, displayLabel(arrow[1], left), line);
    result.addItem(right, displayLabel(rightFragment, right), line);
    const pointsLeft = arrow[2].startsWith("<") && !arrow[2].endsWith(">");
    result.addRelation(pointsLeft ? right : left, pointsLeft ? left : right, line, inlineLabel?.[1] || arrow[4]);
  });
  return result;
}

function parseSequence(rows, zen = false) {
  const result = collection();
  rows.forEach(({ text, line }) => {
    if (!text || /^(sequenceDiagram|zenuml|title\b|autonumber\b|activate\b|deactivate\b|Note\b|loop\b|alt\b|else\b|opt\b|par\b|and\b|critical\b|break\b|end\b|if\b|while\b|for(?:Each)?\b|try\b|catch\b|finally\b|return\b|\/\/)/i.test(text)) return;
    const participant = text.match(/^(?:participant|actor)\s+([\w.-]+)(?:\s+as\s+(.+))?$/i)
      || (zen ? text.match(/^@(?:Actor|Database|Boundary|Control|Entity|Queue)\s+([\w.-]+)(?:\s+as\s+(.+))?$/i) : null)
      || (zen ? text.match(/^([\w.-]+)\s+as\s+(.+)$/i) : null);
    if (participant) {
      result.addItem(participant[1], participant[2] || participant[1], line);
      return;
    }
    const message = text.match(/^([\w.-]+)\s*(?:--?>>?|<<--?|-[)>]|<[-(])[+-]?\s*([\w.-]+)\s*:/);
    if (message) {
      result.addRelation(message[1], message[2], line);
      return;
    }
    if (zen) {
      const call = text.match(/^(?:[\w<>]+\s+)?(?:[\w.-]+\s*=\s*)?(?:new\s+)?([A-Za-z_][\w.-]*)\s*\.\s*[\w$]+\s*\(/);
      if (call) result.addItem(call[1], call[1], line);
      else if (/^[A-Za-z_][\w.-]*$/.test(text)) result.addItem(text, text, line);
    }
  });
  return result;
}

function parseER(rows) {
  const result = collection();
  rows.forEach(({ text, line }) => {
    const relation = text.match(/^([A-Za-z_][\w-]*)\s+[^\s]+\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (relation) result.addRelation(relation[1], relation[2], line, relation[3]);
    const entity = text.match(/^([A-Za-z_][\w-]*)\s*\{$/);
    if (entity) result.addItem(entity[1], entity[1], line);
  });
  return result;
}

function parseIndented(rows, declaration, labelFor = (text) => text) {
  const result = collection();
  const stack = [];
  rows.forEach(({ text, line, indent }) => {
    if (!text || declaration.test(text) || /^(title|direction)\b/i.test(text)) return;
    const label = labelFor(text);
    const key = text.match(/^([\w.-]+)(?=\(\(|\[|\{|\()/)?.[1] || label;
    result.addItem(key, label, line, [text]);
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    if (stack.length) result.addRelation(stack.at(-1).key, key, line);
    stack.push({ indent, key });
  });
  return result;
}

function parseGantt(rows) {
  const result = collection();
  rows.forEach(({ text, line }) => {
    if (!text || /^(gantt|title|dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|section)\b/i.test(text)) return;
    const task = text.match(/^(.+?)\s*:\s*(.+)$/);
    if (!task) return;
    const fields = task[2].split(",").map((value) => value.trim());
    const id = fields.find((value) => /^[A-Za-z_][\w-]*$/.test(value) && !/^(done|active|crit|milestone)$/i.test(value)) || task[1].trim();
    result.addItem(id, task[1].trim(), line);
    const dependency = fields.join(",").match(/\bafter\s+([\w-]+)/i);
    if (dependency) result.addRelation(dependency[1], id, line);
  });
  return result;
}

function parseArchitecture(rows) {
  const result = parseGraph(rows);
  rows.forEach(({ text, line }) => {
    const item = text.match(/^(?:service|group|junction)\s+([\w-]+)(?:\([^)]*\))?\s*(?:\[([^\]]+)\])?/i);
    if (item) result.addItem(item[1], item[2] || item[1], line);
  });
  return result;
}

function parseSankey(rows) {
  const result = collection();
  rows.forEach(({ text, line }) => {
    if (!text || /^sankey-beta$/i.test(text)) return;
    const columns = text.match(/^\s*(?:"([^"]+)"|([^,]+))\s*,\s*(?:"([^"]+)"|([^,]+))\s*,/);
    if (!columns) return;
    const from = (columns[1] || columns[2]).trim();
    const to = (columns[3] || columns[4]).trim();
    result.addRelation(from, to, line);
  });
  return result;
}

function parseRequirement(rows) {
  const result = collection();
  rows.forEach(({ text, line }) => {
    const item = text.match(/^(?:requirement|functionalRequirement|interfaceRequirement|performanceRequirement|physicalRequirement|designConstraint|element)\s+([\w-]+)/i);
    if (item) result.addItem(item[1], item[1], line);
    const relation = text.match(/^([\w-]+)\s+-\s+(?:contains|copies|derives|satisfies|verifies|refines|traces)\s+->\s+([\w-]+)/i);
    const reverse = text.match(/^([\w-]+)\s+<-\s+(?:contains|copies|derives|satisfies|verifies|refines|traces)\s+-\s+([\w-]+)/i);
    if (relation) result.addRelation(relation[1], relation[2], line);
    if (reverse) result.addRelation(reverse[2], reverse[1], line);
  });
  return result;
}

function parseC4(rows) {
  const result = collection();
  rows.forEach(({ text, line }) => {
    const item = text.match(/^(?:Person|Person_Ext|System|System_Ext|SystemDb|SystemQueue|Container|ContainerDb|ContainerQueue|Component|ComponentDb|ComponentQueue|Deployment_Node)\s*\(\s*([\w.-]+)\s*,\s*["']([^"']+)["']/i);
    if (item) result.addItem(item[1], item[2], line);
    const relation = text.match(/^(?:Rel|BiRel|Rel_U|Rel_D|Rel_L|Rel_R|Rel_Back|Rel_Neighbor)\s*\(\s*([\w.-]+)\s*,\s*([\w.-]+)/i);
    if (relation) {
      result.addRelation(relation[1], relation[2], line);
      if (/^BiRel/i.test(text)) result.addRelation(relation[2], relation[1], line);
    }
  });
  return result;
}

function parseOrdered(rows, declaration) {
  const result = collection();
  rows.forEach(({ text, line }, index) => {
    if (!text || declaration.test(text) || /^(title|section|dateFormat|axisFormat|x-axis|y-axis|quadrant-[1-4]|showData|accTitle|accDescr)\b/i.test(text)) return;
    const label = text.match(/^commit\s+id:\s*["']([^"']+)["']/i)?.[1]
      || text.match(/^\s*(?:"([^"]+)"|([^:]+?))\s*:/)?.[1]
      || text.match(/^\s*["']?([^"']+?)["']?(?:\s*:\s*|$)/)?.[1]
      || text;
    result.addItem(`item-${index}`, label.trim(), line, [text]);
  });
  return result;
}

function parseGit(rows) {
  const result = collection();
  rows.forEach(({ text, line }, index) => {
    const label = text.match(/^commit(?:\s+id:\s*["']([^"']+)["'])?/i)?.[1]
      || text.match(/^merge\s+\S+(?:\s+id:\s*["']([^"']+)["'])?/i)?.[1];
    if (label) result.addItem(`commit-${index}`, label, line, [text]);
  });
  return result;
}

const adapters = [
  { id: "flowchart", detect: /^(?:flowchart|graph)(?:-elk)?\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Parents", "Children"], parse: parseGraph },
  { id: "block", detect: /^block-beta\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Incoming", "Outgoing"], parse: parseGraph },
  { id: "sequence", detect: /^sequenceDiagram\b/i, mode: RELATIONAL, selectors: selectorSets.sequence, vocabulary: ["Receives from", "Sends to"], parse: (rows) => parseSequence(rows) },
  { id: "zenuml", detect: /^zenuml\b/i, mode: RELATIONAL, selectors: selectorSets.zenuml, vocabulary: ["Receives from", "Sends to"], parse: (rows) => parseSequence(rows, true) },
  { id: "class", detect: /^classDiagram\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Referenced by", "References"], parse: parseGraph },
  { id: "state", detect: /^stateDiagram(?:-v2)?\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Previous states", "Next states"], parse: parseGraph },
  { id: "er", detect: /^erDiagram\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Related from", "Related to"], parse: parseER },
  { id: "architecture", detect: /^architecture-beta\b/i, mode: RELATIONAL, selectors: selectorSets.architecture, vocabulary: ["Upstream", "Downstream"], parse: parseArchitecture },
  { id: "swimlane", detect: /^swimlane(?:-beta)?\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Previous steps", "Next steps"], parse: parseGraph },
  { id: "requirement", detect: /^requirementDiagram\b/i, mode: RELATIONAL, selectors: selectorSets.requirement, vocabulary: ["Related from", "Related to"], parse: parseRequirement },
  { id: "sankey", detect: /^sankey-beta\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Inputs", "Outputs"], parse: parseSankey },
  { id: "mindmap", detect: /^mindmap\b/i, mode: RELATIONAL, selectors: selectorSets.tree, vocabulary: ["Parent", "Children"], parse: (rows) => parseIndented(rows, /^mindmap$/i, (text) => text.replace(/^\w+\(\((.*)\)\)$/, "$1").replace(/^[-+]\s*/, "")) },
  { id: "treeView", detect: /^treeView-beta\b/i, mode: RELATIONAL, selectors: selectorSets.tree, vocabulary: ["Parent", "Children"], parse: (rows) => parseIndented(rows, /^treeView-beta$/i) },
  { id: "treemap", detect: /^treemap-beta\b/i, mode: RELATIONAL, selectors: selectorSets.tree, vocabulary: ["Parent", "Children"], parse: (rows) => parseIndented(rows, /^treemap-beta$/i, (text) => text.replace(/^"|"(?:\s*:\s*\d+)?$/g, "")) },
  { id: "ishikawa", detect: /^ishikawa-beta\b/i, mode: RELATIONAL, selectors: selectorSets.tree, vocabulary: ["Effect", "Causes"], parse: (rows) => parseIndented(rows, /^ishikawa-beta$/i) },
  { id: "wardley", detect: /^wardley-beta\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Depends on", "Supports"], parse: parseGraph },
  { id: "gantt", detect: /^gantt\b/i, mode: RELATIONAL, selectors: selectorSets.gantt, vocabulary: ["Depends on", "Unblocks"], parse: parseGantt },
  { id: "kanban", detect: /^kanban\b/i, mode: ORDERED, selectors: selectorSets.kanban, parse: (rows) => parseIndented(rows, /^kanban$/i) },
  { id: "eventmodeling", detect: /^eventModeling\b/i, mode: ORDERED, selectors: selectorSets.graph, parse: (rows) => parseOrdered(rows, /^eventModeling$/i) },
  { id: "timeline", detect: /^timeline\b/i, mode: ORDERED, selectors: selectorSets.timeline, parse: (rows) => parseOrdered(rows, /^timeline$/i) },
  { id: "gitGraph", detect: /^gitGraph\b/i, mode: ORDERED, selectors: selectorSets.git, parse: parseGit },
  { id: "journey", detect: /^journey\b/i, mode: ORDERED, selectors: selectorSets.gantt, parse: (rows) => parseOrdered(rows, /^journey$/i) },
  { id: "packet", detect: /^packet-beta\b/i, mode: ORDERED, selectors: selectorSets.packet, parse: (rows) => parseOrdered(rows, /^packet-beta$/i) },
  { id: "railroad", detect: /^(?:railroad|ebnf|abnf|peg)\b/i, mode: ORDERED, selectors: selectorSets.graph, parse: (rows) => parseOrdered(rows, /^(?:railroad|ebnf|abnf|peg)\b/i) },
  { id: "pie", detect: /^pie\b/i, mode: CANVAS, selectors: [], parse: (rows) => parseOrdered(rows, /^pie\b/i) },
  { id: "quadrantChart", detect: /^quadrantChart\b/i, mode: CANVAS, selectors: [], parse: (rows) => parseOrdered(rows, /^quadrantChart$/i) },
  { id: "xychart", detect: /^xychart-beta\b/i, mode: CANVAS, selectors: [], parse: (rows) => parseOrdered(rows, /^xychart-beta$/i) },
  { id: "radar", detect: /^radar-beta\b/i, mode: CANVAS, selectors: [], parse: (rows) => parseOrdered(rows, /^radar-beta$/i) },
  { id: "venn", detect: /^venn-beta\b/i, mode: CANVAS, selectors: [], parse: (rows) => parseOrdered(rows, /^venn-beta$/i) },
  { id: "cynefin", detect: /^cynefin-beta\b/i, mode: CANVAS, selectors: [], parse: (rows) => parseOrdered(rows, /^cynefin-beta$/i) },
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

export function analyzeDiagram(source) {
  const declaration = declarationFor(source);
  const adapter = adapters.find((candidate) => candidate.detect.test(declaration)) || {
    id: "diagram",
    mode: CANVAS,
    selectors: [],
    parse: () => collection(),
  };
  const parsed = adapter.parse(diagramRows(source));
  return {
    id: adapter.id,
    mode: adapter.mode,
    selectors: adapter.selectors,
    vocabulary: { incoming: adapter.vocabulary?.[0] || "Incoming", outgoing: adapter.vocabulary?.[1] || "Outgoing" },
    items: [...parsed.items.values()],
    relations: parsed.relations,
  };
}

export function matchSemanticItem(analysis, key, label, usedKeys = new Set()) {
  const candidates = [key, label].map(normalize).filter(Boolean);
  const scored = analysis.items
    .filter((item) => !usedKeys.has(item.key))
    .map((item) => {
      const aliases = item.aliases.map(normalize).filter(Boolean);
      let score = 0;
      candidates.forEach((candidate) => {
        if (aliases.includes(candidate)) score = Math.max(score, 100);
        else if (aliases.some((alias) => alias && (candidate.includes(alias) || alias.includes(candidate)))) score = Math.max(score, 50);
      });
      return { item, score };
    })
    .sort((a, b) => b.score - a.score || (a.item.line ?? Infinity) - (b.item.line ?? Infinity));
  return scored[0]?.score ? scored[0].item : undefined;
}

export const supportedDiagramAdapters = adapters.map(({ id, mode }) => ({ id, mode }));
