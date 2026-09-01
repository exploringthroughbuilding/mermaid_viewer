const RELATIONAL = "relational";
const ORDERED = "ordered";
const CANVAS = "canvas";

const selectorSets = {
  graph: ["g.node"],
  sequence: ['g[data-et="participant"]', "g.actor"],
  architecture: ["g.architecture-service"],
  block: ["g.node.flowchart-label"],
  state: ["g.node:not(.statediagram-note)", "g.statediagram-state.statediagram-cluster"],
  sankey: ["g.nodes > g.node"],
  mindmap: ["g.node.mindmap-node"],
  treeView: ["g.tree-view > g"],
  treemap: ["g.treemapSection", "g.treemapNode.treemapLeafGroup"],
  ishikawa: ["g.ishikawa-head-group", "g.ishikawa-label-group", "g.ishikawa-sub-group"],
  wardley: ["g.wardley-node"],
  gantt: ["rect.task"],
  kanban: ["g.items > g.node", "g.cluster"],
  eventmodeling: ["g.em-box"],
  timeline: ["g.timeline-node"],
  git: ["circle.commit:not(.commit-merge)"],
  journey: ["rect.task"],
  packet: ["rect.packetBlock"],
  railroad: ["g.railroad-rule"],
  requirement: ["g.node"],
  er: ["g.node"],
  class: ["g.node"],
  c4: ["g.node.c4-shape"],
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
  const groups = [];
  const addGroup = (key, label, line, parentKey) => {
    const existing = groups.find((group) => group.key === key);
    if (existing) return existing;
    const group = { key, label, line, parentKey };
    groups.push(group);
    return group;
  };
  const addItem = (key, label, line, aliases = [], metadata = {}) => {
    const cleanKey = String(key || label || "").trim();
    const cleanLabel = String(label || key || "").trim().replace(/^['"]|['"]$/g, "");
    if (!cleanKey || !cleanLabel) return undefined;
    const existing = items.get(cleanKey);
    const nextAliases = [...new Set([cleanKey, cleanLabel, ...aliases].filter(Boolean))];
    if (existing) {
      existing.aliases = [...new Set([...existing.aliases, ...nextAliases])];
      if (existing.line == null && line != null) existing.line = line;
      Object.assign(existing, metadata);
      return existing;
    }
    const item = { key: cleanKey, label: cleanLabel, line, aliases: nextAliases, ...metadata };
    items.set(cleanKey, item);
    return item;
  };
  const addRelation = (from, to, line, label = "", metadata = {}) => {
    if (!from || !to || from === to) return;
    addItem(from, from, line);
    addItem(to, to, line);
    const existing = relations.find((relation) => relation.from === from && relation.to === to && relation.line === line);
    if (existing) {
      Object.assign(existing, metadata);
      return existing;
    }
    const relation = { from, to, line, label, ...metadata };
    relations.push(relation);
    return relation;
  };
  return { items, relations, groups, addGroup, addItem, addRelation };
}

function identifier(fragment) {
  const match = fragment.trim().match(/^([A-Za-z_][\w.-]*)/);
  return match?.[1];
}

function displayLabel(fragment, fallback) {
  const quoted = fragment.match(/^[A-Za-z_][\w.-]*\s*[\[({>]{1,2}["']([\s\S]*?)["'][\])}]{1,2}/)?.[1];
  return quoted?.trim()
    || fragment.match(/[\[({]{1,2}["']?([^\])}"']+)["']?[\])}]{1,2}/)?.[1]?.trim()
    || fallback;
}

function graphLinkParts(text) {
  const fragments = [];
  const operators = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if ("[({".includes(character)) {
      depth += 1;
      continue;
    }
    if ("])}".includes(character)) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth) continue;
    const remainder = text.slice(index);
    const dotted = remainder.match(/^-\.\s*(.*?)\s*\.->/);
    const arrow = dotted || remainder.match(/^(?:<[-=.]+>|[-=.]+>|<[-=.]+|[-=.]+)/);
    if (!arrow) continue;
    fragments.push(text.slice(start, index).trim());
    operators.push({ token: arrow[0], label: dotted?.[1]?.trim() || "" });
    index += arrow[0].length - 1;
    start = index + 1;
  }
  if (!operators.length) return null;
  fragments.push(text.slice(start).trim());
  return { fragments, operators };
}

function graphEndpoints(fragment) {
  const inlineLabel = fragment.match(/^\|([^|]+)\|\s*(.*)$/);
  const source = inlineLabel?.[2] || fragment;
  const endpoints = source.split(/\s+&\s+/).map((entry) => {
    const key = identifier(entry);
    return key ? { key, label: displayLabel(entry, key) } : null;
  }).filter(Boolean);
  return { endpoints, label: inlineLabel?.[1]?.trim() || "" };
}

function graphDeclarations(text) {
  const declarations = [];
  let depth = 0;
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if ("[({".includes(character)) {
      depth += 1;
      continue;
    }
    if ("])}".includes(character)) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth || !/[A-Za-z_]/.test(character) || (index > 0 && !/[\s&]/.test(text[index - 1]))) continue;
    const match = text.slice(index).match(/^([A-Za-z_][\w.-]*)\s*(?=\[|\(|\{|>|@\{)/);
    if (!match) continue;
    declarations.push({ key: match[1], label: displayLabel(text.slice(index), match[1]) });
    index += match[0].length - 1;
  }
  return declarations;
}

function parseGraph(rows) {
  const result = collection();
  const groupStack = [];
  rows.forEach(({ text, line }) => {
    const declaration = text.match(/^subgraph\s+([A-Za-z_][\w.-]*)(?:\s*\[([\s\S]+)\])?$/i);
    if (declaration) {
      const parent = groupStack.at(-1);
      const label = String(declaration[2] || declaration[1]).replace(/^['"]|['"]$/g, "").trim();
      result.addGroup(declaration[1], label, line, parent?.key);
      groupStack.push({ key: declaration[1], label });
    } else if (/^end$/i.test(text)) {
      groupStack.pop();
    }
  });
  rows.forEach(({ text, line }) => {
    if (!text || text.startsWith("%%") || /^(flowchart|graph|block-beta|columns|direction)\b/i.test(text)) return;
    graphDeclarations(text).forEach(({ key, label }) => result.addItem(key, label, line));
    const architecture = text.match(/^([A-Za-z_][\w.-]*):[LRBT]\s+[-=.]+>\s+[LRBT]:([A-Za-z_][\w.-]*)/);
    if (architecture) {
      result.addRelation(architecture[1], architecture[2], line);
      return;
    }
    const links = graphLinkParts(text);
    if (!links) return;
    const endpointGroups = links.fragments.map(graphEndpoints);
    links.operators.forEach((operator, index) => {
      const left = endpointGroups[index];
      const right = endpointGroups[index + 1];
      left.endpoints.forEach((endpoint) => result.addItem(endpoint.key, endpoint.label, line));
      right.endpoints.forEach((endpoint) => result.addItem(endpoint.key, endpoint.label, line));
      const pointsLeft = operator.token.startsWith("<") && !operator.token.endsWith(">");
      left.endpoints.forEach((leftEndpoint) => right.endpoints.forEach((rightEndpoint) => {
        result.addRelation(
          pointsLeft ? rightEndpoint.key : leftEndpoint.key,
          pointsLeft ? leftEndpoint.key : rightEndpoint.key,
          line,
          operator.label || right.label,
        );
      }));
    });
  });
  rows.forEach(({ text, line }) => {
    const standalone = text.match(/^([A-Za-z_][\w.-]*)(?:\s*(?:\[.*\]|\(.*\)|\{.*\}|>.*]))?$/);
    if (standalone && !/^(end|class|style|linkStyle)$/i.test(standalone[1])) {
      result.addItem(standalone[1], displayLabel(text, standalone[1]), line);
    }
  });
  return result;
}

function parseSequence(rows) {
  const result = collection();
  rows.forEach(({ text, line }) => {
    if (!text || /^(sequenceDiagram|title\b|autonumber\b|activate\b|deactivate\b|Note\b|loop\b|alt\b|else\b|opt\b|par\b|and\b|critical\b|break\b|end\b)/i.test(text)) return;
    const participant = text.match(/^(?:(?:create\s+)?(?:participant|actor)|participant)\s+([\w.-]+)(?:\s+as\s+(.+))?(?:\s+@\{.*})?$/i);
    if (participant) {
      result.addItem(participant[1], participant[2] || participant[1], line);
      return;
    }
    const message = text.match(/^([\w.-]+)\s*(?:--?>>?|<<--?|-[)>]|<[-(])[+-]?\s*([\w.-]+)\s*:/);
    if (message) {
      result.addRelation(message[1], message[2], line);
      return;
    }
  });
  return result;
}

function parseState(rows) {
  const result = collection();
  const stack = [];
  rows.forEach(({ text, line }) => {
    if (!text || /^(stateDiagram(?:-v2)?|direction|note\b|end note\b)/i.test(text)) return;
    if (text === "}") {
      stack.pop();
      return;
    }
    const composite = text.match(/^state\s+(?:"([^"]+)"\s+as\s+)?([\w.-]+)\s*\{$/i)
      || text.match(/^state\s+([\w.-]+)\s*\{$/i);
    if (composite) {
      const key = composite[2] || composite[1];
      const label = composite[1] && composite[2] ? composite[1] : key;
      const parent = stack.at(-1);
      result.addItem(key, label, line, [], parent ? { groupKey: parent.key, groupLabel: parent.label } : {});
      result.addGroup(`state:${key}`, label, line, parent?.key);
      stack.push({ key: `state:${key}`, stateKey: key, label });
      return;
    }
    const declaration = text.match(/^state\s+"([^"]+)"\s+as\s+([\w.-]+)/i)
      || text.match(/^state\s+([\w.-]+)(?:\s*:\s*(.+))?$/i);
    if (declaration) {
      const key = declaration[2] && text.includes(" as ") ? declaration[2] : declaration[1];
      const label = declaration[2] && text.includes(" as ") ? declaration[1] : declaration[2] || key;
      const group = stack.at(-1);
      result.addItem(key, label, line, [], group ? { groupKey: group.key, groupLabel: group.label } : {});
    }
    const transition = text.match(/^([^\s]+)\s*[-=.]+>\s*([^\s:]+)(?:\s*:\s*(.*))?$/);
    if (!transition) return;
    const group = stack.at(-1);
    [transition[1], transition[2]].forEach((key) => {
      if (key !== "[*]") result.addItem(key, key, line, [], group ? { groupKey: group.key, groupLabel: group.label } : {});
    });
    if (transition[1] !== "[*]" && transition[2] !== "[*]") {
      result.addRelation(transition[1], transition[2], line, transition[3]);
    }
  });
  return result;
}

function parseBlock(rows) {
  const result = parseGraph(rows);
  const stack = [];
  rows.forEach(({ text, line, indent }) => {
    const group = text.match(/^block:([\w.-]+)(?::\d+)?$/i);
    if (group) {
      const parent = stack.at(-1);
      const entry = result.addGroup(`block:${group[1]}`, group[1], line, parent?.key);
      stack.push({ ...entry, indent });
      return;
    }
    if (/^end$/i.test(text)) {
      stack.pop();
      return;
    }
    const parent = stack.at(-1);
    if (!parent || !text || /^(columns|space)\b/i.test(text)) return;
    for (const match of text.matchAll(/(?:^|\s)([A-Za-z_][\w.-]*)\s*(?:\[|\(|\{|>)/g)) {
      const item = result.items.get(match[1]);
      if (item) Object.assign(item, { groupKey: parent.key, groupLabel: parent.label });
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

function parseMindmap(rows) {
  const result = parseIndented(rows, /^mindmap$/i, (text) => text
    .replace(/^\w+\(\((.*)\)\)$/, "$1")
    .replace(/^[-+]\s*/, ""));
  const ordinals = new Map();
  [...result.items.values()].forEach((item, index) => {
    item.rendererOrdinal = index;
    ordinals.set(item.key, index);
  });
  result.relations.forEach((relation) => {
    relation.rendererEdgeId = `edge_${ordinals.get(relation.from)}_${ordinals.get(relation.to)}`;
  });
  return result;
}

function parseGantt(rows) {
  const result = collection();
  let currentGroup;
  rows.forEach(({ text, line }) => {
    const section = text.match(/^section\s+(.+)$/i);
    if (section) {
      currentGroup = result.addGroup(`gantt:${result.groups.length}`, section[1].trim(), line);
      return;
    }
    if (!text || /^(gantt|title|dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker)\b/i.test(text)) return;
    const task = text.match(/^(.+?)\s*:\s*(.+)$/);
    if (!task) return;
    const fields = task[2].split(",").map((value) => value.trim());
    const id = fields.find((value) => /^[A-Za-z_][\w-]*$/.test(value) && !/^(done|active|crit|milestone|vert)$/i.test(value)) || task[1].trim();
    result.addItem(id, task[1].trim(), line, [], currentGroup ? { groupKey: currentGroup.key, groupLabel: currentGroup.label } : {});
    const dependency = fields.join(",").match(/\bafter\s+([\w -]+)/i);
    dependency?.[1].trim().split(/\s+/).forEach((parent) => result.addRelation(parent, id, line));
  });
  return result;
}

function parseArchitecture(rows) {
  const result = parseGraph(rows);
  rows.forEach(({ text, line }) => {
    const item = text.match(/^(service|group|junction)\s+([\w-]+)(?:\([^)]*\))?\s*(?:\[([^\]]+)\])?(?:\s+in\s+([\w-]+))?/i);
    if (item) {
      const label = item[3] || item[2];
      if (item[1].toLowerCase() === "group") result.addGroup(`architecture:${item[2]}`, label, line);
      const parent = item[4] && result.groups.find((group) => group.key === `architecture:${item[4]}`);
      const semanticItem = result.addItem(item[2], label, line, [], parent ? { groupKey: parent.key, groupLabel: parent.label } : {});
      // The graph parser sees the icon name first; architecture renders [Label].
      if (semanticItem) {
        semanticItem.label = label;
        semanticItem.aliases = [...new Set([...semanticItem.aliases, label])];
      }
    }
  });
  return result;
}

function parseTimeline(rows) {
  const result = collection();
  let currentGroup;
  rows.forEach(({ text, line }, index) => {
    if (!text || /^(timeline|title\b)/i.test(text)) return;
    const section = text.match(/^section\s+(.+)$/i);
    if (section) {
      currentGroup = result.addGroup(`timeline:${result.groups.length}`, section[1].trim(), line);
      return;
    }
    const parts = text.split(" : ").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;
    const metadata = currentGroup ? { groupKey: currentGroup.key, groupLabel: currentGroup.label } : {};
    const taskKey = `timeline-task-${index}`;
    result.addItem(taskKey, parts[0], line, [text], { ...metadata, kind: "task" });
    parts.slice(1).forEach((label, eventIndex) => {
      const eventKey = `timeline-event-${index}-${eventIndex}`;
      result.addItem(eventKey, label, line, [], { ...metadata, kind: "event" });
      result.addRelation(taskKey, eventKey, line);
    });
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
    const relation = text.match(/^(?:Rel|BiRel|Rel_U|Rel_D|Rel_L|Rel_R|Rel_Back|Rel_Neighbor)\s*\(\s*([\w.-]+)\s*,\s*([\w.-]+)/i)
      || text.match(/^RelIndex\s*\(\s*\d+\s*,\s*([\w.-]+)\s*,\s*([\w.-]+)/i);
    if (relation) {
      result.addRelation(relation[1], relation[2], line);
      if (/^BiRel/i.test(text)) result.addRelation(relation[2], relation[1], line);
    }
  });
  return result;
}

function parseClass(rows) {
  const result = parseGraph(rows);
  rows.forEach(({ text, line }) => {
    const relation = text.replace(/"[^"]*"/g, "").match(
      /^([A-Za-z_][\w.-]*)\s+(?:<\|--|<\|\.\.|o--|\*--|--o|--\*|-->|<--|--\|>|<\.\.|--\.)\s+([A-Za-z_][\w.-]*)(?:\s*:\s*(.*))?$/,
    );
    if (relation) {
      const cardinalities = [...text.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      result.addRelation(relation[1], relation[2], line, relation[3], { cardinalities });
    }
  });
  return result;
}

function parseKanban(rows) {
  const result = parseGraph(rows);
  const stack = [];
  rows.forEach(({ text, line, indent }) => {
    if (!text || /^kanban$/i.test(text)) return;
    const item = text.match(/^([A-Za-z_][\w.-]*)\s*\[/);
    if (!item) return;
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    if (stack.length) result.addRelation(stack.at(-1).key, item[1], line);
    stack.push({ key: item[1], indent });
  });
  return result;
}

function parseTreeView(rows) {
  return parseIndented(rows, /^treeView-beta$/i, (text) => text
    .replace(/\s+##.*$/, "")
    .replace(/\/$/, ""));
}

function parsePacket(rows) {
  const result = collection();
  rows.forEach(({ text, line }, index) => {
    if (!text || /^packet-beta$/i.test(text)) return;
    const label = text.match(/:\s*["']([^"']+)["']/)?.[1];
    if (label) result.addItem(`packet-${index}`, label, line);
  });
  return result;
}

function parseEventModeling(rows) {
  const result = collection();
  rows.forEach(({ text, line }, index) => {
    const item = text.match(/^tf\s+\d+\s+(?:ui|cmd|evt|rmo)\s+([\w.-]+)/i);
    if (!item) return;
    result.addItem(`item-${index}`, item[1].split(".").at(-1), line, [item[1]]);
  });
  return result;
}

function parseRailroad(rows) {
  const result = collection();
  rows.forEach(({ text, line }, index) => {
    const rule = text.match(/^([A-Za-z_][\w.-]*)\s*(?:=|<-)/);
    if (rule) result.addItem(`rule-${index}`, rule[1], line, [rule[1]]);
  });
  return result;
}

function parseWardley(rows) {
  const result = collection();
  rows.forEach(({ text, line }) => {
    const item = text.match(/^(?:anchor|component)\s+([^\s[(:]+)/i);
    if (item) result.addItem(item[1], item[1], line);
    const relation = text.match(/^([\w.-]+)\s*->\s*([\w.-]+)/);
    if (relation) result.addRelation(relation[1], relation[2], line);
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
  const branches = new Map([["main", null]]);
  let currentBranch = "main";
  result.addGroup("git:main", "main", 0);
  rows.forEach(({ text, line }, index) => {
    const branch = text.match(/^branch\s+([^\s]+)/i);
    if (branch) {
      const branchPoint = branches.get(currentBranch) || null;
      currentBranch = branch[1];
      branches.set(currentBranch, branchPoint);
      result.addGroup(`git:${currentBranch}`, currentBranch, line);
      return;
    }
    const checkout = text.match(/^(?:checkout|switch)\s+([^\s]+)/i);
    if (checkout) {
      currentBranch = checkout[1];
      if (!branches.has(currentBranch)) branches.set(currentBranch, null);
      result.addGroup(`git:${currentBranch}`, currentBranch, line);
      return;
    }
    const commit = text.match(/^commit(?:\s+id:\s*["']([^"']+)["'])?/i);
    const merge = text.match(/^merge\s+(\S+)(?:\s+id:\s*["']([^"']+)["'])?/i);
    if (!commit && !merge) return;
    const key = `commit-${index}`;
    const label = commit?.[1] || merge?.[2] || `Commit ${index}`;
    result.addItem(key, label, line, [text], { groupKey: `git:${currentBranch}`, groupLabel: currentBranch });
    const head = branches.get(currentBranch);
    if (head) result.addRelation(head, key, line);
    if (merge) {
      const mergedHead = branches.get(merge[1]);
      if (mergedHead) result.addRelation(mergedHead, key, line);
    }
    branches.set(currentBranch, key);
  });
  return result;
}

const adapters = [
  { id: "flowchart", detect: /^(?:flowchart|graph)(?:-elk)?\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Parents", "Children"], parse: parseGraph },
  { id: "block", detect: /^block-beta\b/i, mode: RELATIONAL, selectors: selectorSets.block, vocabulary: ["Incoming", "Outgoing"], parse: parseBlock },
  { id: "sequence", detect: /^sequenceDiagram\b/i, mode: RELATIONAL, selectors: selectorSets.sequence, vocabulary: ["Receives from", "Sends to"], parse: (rows) => parseSequence(rows) },
  { id: "class", detect: /^classDiagram\b/i, mode: RELATIONAL, selectors: selectorSets.class, vocabulary: ["Referenced by", "References"], parse: parseClass },
  { id: "state", detect: /^stateDiagram(?:-v2)?\b/i, mode: RELATIONAL, selectors: selectorSets.state, vocabulary: ["Previous states", "Next states"], parse: parseState },
  { id: "er", detect: /^erDiagram\b/i, mode: RELATIONAL, selectors: selectorSets.er, vocabulary: ["Related from", "Related to"], parse: parseER },
  { id: "architecture", detect: /^architecture-beta\b/i, mode: RELATIONAL, selectors: selectorSets.architecture, vocabulary: ["Upstream", "Downstream"], parse: parseArchitecture },
  { id: "swimlane", detect: /^swimlane(?:-beta)?\b/i, mode: RELATIONAL, selectors: selectorSets.graph, vocabulary: ["Previous steps", "Next steps"], parse: parseGraph },
  { id: "requirement", detect: /^requirementDiagram\b/i, mode: RELATIONAL, selectors: selectorSets.requirement, vocabulary: ["Related from", "Related to"], parse: parseRequirement },
  { id: "sankey", detect: /^sankey-beta\b/i, mode: RELATIONAL, selectors: selectorSets.sankey, vocabulary: ["Inputs", "Outputs"], parse: parseSankey },
  { id: "mindmap", detect: /^mindmap\b/i, mode: RELATIONAL, selectors: selectorSets.mindmap, vocabulary: ["Parent", "Children"], parse: parseMindmap },
  { id: "treeView", detect: /^treeView-beta\b/i, mode: RELATIONAL, selectors: selectorSets.treeView, vocabulary: ["Parent", "Children"], parse: parseTreeView },
  { id: "treemap", detect: /^treemap-beta\b/i, mode: RELATIONAL, selectors: selectorSets.treemap, vocabulary: ["Parent", "Children"], parse: (rows) => parseIndented(rows, /^treemap-beta$/i, (text) => text.replace(/^"|"(?:\s*:\s*\d+)?$/g, "")) },
  { id: "ishikawa", detect: /^ishikawa-beta\b/i, mode: RELATIONAL, selectors: selectorSets.ishikawa, vocabulary: ["Effect", "Causes"], parse: (rows) => parseIndented(rows, /^ishikawa-beta$/i) },
  { id: "wardley", detect: /^wardley-beta\b/i, mode: RELATIONAL, selectors: selectorSets.wardley, vocabulary: ["Depends on", "Supports"], parse: parseWardley },
  { id: "gantt", detect: /^gantt\b/i, mode: RELATIONAL, selectors: selectorSets.gantt, vocabulary: ["Depends on", "Unblocks"], parse: parseGantt },
  { id: "kanban", detect: /^kanban\b/i, mode: ORDERED, selectors: selectorSets.kanban, parse: parseKanban },
  { id: "eventmodeling", detect: /^eventModeling\b/i, mode: ORDERED, selectors: selectorSets.eventmodeling, parse: parseEventModeling },
  { id: "timeline", detect: /^timeline\b/i, mode: RELATIONAL, selectors: selectorSets.timeline, vocabulary: ["Period", "Events"], parse: parseTimeline },
  { id: "gitGraph", detect: /^gitGraph\b/i, mode: RELATIONAL, selectors: selectorSets.git, vocabulary: ["Parents", "Children"], parse: parseGit },
  { id: "journey", detect: /^journey\b/i, mode: ORDERED, selectors: selectorSets.journey, parse: (rows) => parseOrdered(rows, /^journey$/i) },
  { id: "packet", detect: /^packet-beta\b/i, mode: ORDERED, selectors: selectorSets.packet, parse: parsePacket },
  { id: "railroad", detect: /^(?:railroad|ebnf|abnf|peg)\b/i, mode: ORDERED, selectors: selectorSets.railroad, parse: parseRailroad },
  { id: "pie", detect: /^pie\b/i, mode: CANVAS, selectors: [], parse: (rows) => parseOrdered(rows, /^pie\b/i) },
  { id: "quadrantChart", detect: /^quadrantChart\b/i, mode: CANVAS, selectors: [], parse: (rows) => parseOrdered(rows, /^quadrantChart$/i) },
  { id: "xychart", detect: /^xychart-beta\b/i, mode: CANVAS, selectors: [], parse: (rows) => parseOrdered(rows, /^xychart-beta$/i) },
  { id: "radar", detect: /^radar-beta\b/i, mode: CANVAS, selectors: [], parse: (rows) => parseOrdered(rows, /^radar-beta$/i) },
  { id: "venn", detect: /^venn-beta\b/i, mode: CANVAS, selectors: [], parse: (rows) => parseOrdered(rows, /^venn-beta$/i) },
  { id: "cynefin", detect: /^cynefin-beta\b/i, mode: CANVAS, selectors: [], parse: (rows) => parseOrdered(rows, /^cynefin-beta$/i) },
  { id: "c4", detect: /^C4(?:Context|Container|Component|Dynamic|Deployment)\b/i, mode: RELATIONAL, selectors: selectorSets.c4, vocabulary: ["Referenced by", "References"], parse: parseC4 },
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
    groups: parsed.groups || [],
  };
}

export function findUntraversableGroupEdges(analysis, indexedEdges = []) {
  const indexedEdgeKeys = new Set(indexedEdges.map(({ from, to }) => `${from}\u0000${to}`));
  const groups = new Map((analysis?.groups || []).map(({ key, label, line }) => [key, { key, label, line }]));
  return (analysis?.relations || [])
    .filter(({ from, to }) => (
      (groups.has(from) || groups.has(to))
      && !indexedEdgeKeys.has(`${from}\u0000${to}`)
    ))
    .map(({ from, to, line }) => ({
      from,
      to,
      sourceLine: line ?? null,
      groupEndpoint: groups.has(from) ? groups.get(from) : groups.get(to),
      reason: "A Mermaid subgraph is a visual container, not an indexable graph node.",
      suggestedRewrite: groups.has(from)
        ? `Replace ${from} with an explicit node inside that subgraph.`
        : `Replace ${to} with an explicit node inside that subgraph.`,
    }));
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

const PAINT_TAGS = new Set(["circle", "ellipse", "line", "path", "polygon", "polyline", "rect", "use"]);

function elementsFor(root, selector) {
  return root ? [...root.querySelectorAll(selector)] : [];
}

function textValue(element) {
  return String(element?.textContent || "").replace(/\s+/g, " ").trim();
}

function textValues(element, selector) {
  return [...new Set(elementsFor(element, selector).map(textValue).filter(Boolean))];
}

function rawRendererKey(element, fallback) {
  if (element?.dataset?.id) return element.dataset.id;
  if (element?.getAttribute?.("name")) return element.getAttribute("name");
  const typedID = element?.id?.match(/-(?:flowchart|classId|state|entity)-(.+?)-\d+$/)?.[1];
  if (typedID) return typedID;
  const serviceID = element?.id?.match(/-service-(.+)$/)?.[1];
  return serviceID || element?.id || fallback;
}

function directPaintParts(element, containers = "") {
  if (!element) return [];
  const parts = [...element.children].filter((child) => PAINT_TAGS.has(child.localName));
  if (containers) {
    [...element.children].filter((child) => child.matches(containers)).forEach((container) => {
      [...container.children].filter((child) => PAINT_TAGS.has(child.localName)).forEach((child) => parts.push(child));
    });
  }
  return [...new Set(parts)];
}

function markerParts(svg, element) {
  // URL markers live in <defs> and are commonly shared by many edges. Their
  // paint is handled per referencing path by the controller's marker clones.
  return [];
}

function exactSemanticItem(analysis, candidates, usedKeys = new Set()) {
  const normalizedCandidates = candidates.map(normalize).filter(Boolean);
  if (!normalizedCandidates.length) return undefined;
  return analysis.items.find((item) => {
    if (usedKeys.has(item.key)) return false;
    return item.aliases.map(normalize).some((alias) => normalizedCandidates.includes(alias));
  });
}

function groupData(svg, selector, labelSelector, prefix) {
  const containers = elementsFor(svg, selector);
  const byElement = new Map();
  const counts = new Map();
  const groups = containers.map((element, index) => {
    const label = textValues(element, labelSelector)[0] || textValue(element) || `${prefix} ${index + 1}`;
    const normalizedLabel = normalize(label) || `${index + 1}`;
    const duplicate = counts.get(normalizedLabel) || 0;
    counts.set(normalizedLabel, duplicate + 1);
    const group = { key: `${prefix}:${normalizedLabel}${duplicate ? `:${duplicate + 1}` : ""}`, label };
    byElement.set(element, group);
    return group;
  });
  containers.forEach((element) => {
    let parent = element.parentElement;
    while (parent && !byElement.has(parent)) parent = parent.parentElement;
    if (parent) byElement.get(element).parentKey = byElement.get(parent).key;
  });
  return { groups, byElement };
}

function containingGroup(element, byElement) {
  let parent = element?.parentElement;
  while (parent) {
    if (byElement.has(parent)) return byElement.get(parent);
    parent = parent.parentElement;
  }
  return undefined;
}

function addTargets(targets, analysis, candidates, usedKeys, groups, { allowUnmatched = false } = {}) {
  candidates.forEach(({ element, rendererKey, labels, paintParts }) => {
    const item = exactSemanticItem(analysis, [rendererKey, ...labels], usedKeys);
    if (!item && !allowUnmatched) return;
    const fallbackLabel = labels.find(Boolean) || rendererKey;
    const key = item?.key || fallbackLabel;
    if (!key || usedKeys.has(key)) return;
    usedKeys.add(key);
    const target = {
      rendererKey: rendererKey || key,
      key,
      label: item?.label || fallbackLabel,
      sourceLine: item?.line,
      element,
      paintParts: [...new Set(paintParts)].filter(Boolean),
    };
    if (item?.groupKey) {
      target.groupKey = item.groupKey;
      target.groupLabel = item.groupLabel;
    }
    const group = containingGroup(element, groups.byElement);
    if (group) {
      target.groupKey = group.key;
      target.groupLabel = group.label;
    }
    targets.push(target);
  });
}

function nodeCandidates(svg, selector, labelSelector, prefix, containers = ".label-container, .outer-path") {
  return elementsFor(svg, selector).map((element, index) => ({
    element,
    rendererKey: rawRendererKey(element, `${prefix}:${index + 1}`),
    labels: textValues(element, labelSelector),
    paintParts: directPaintParts(element, containers),
  }));
}

function textSibling(svg, element, suffix, selector) {
  return elementsFor(svg, selector).find((candidate) => candidate.id === `${element.id}${suffix}`);
}

function semanticEdges(analysis, targets) {
  const targetKeys = new Set(targets.map(({ key }) => key));
  return analysis.relations
    .filter(({ from, to }) => targetKeys.has(from) && targetKeys.has(to))
    .map((relation, index) => ({
      ...relation,
      id: `semantic:${relation.line}:${relation.from}:${relation.to}:${index}`,
      from: relation.from,
      to: relation.to,
      pathParts: [],
      arrowParts: [],
      labelParts: [],
    }));
}

function replaceSemanticEdge(edges, from, to, visual) {
  const index = edges.findIndex((edge) => edge.from === from && edge.to === to && !edge.pathParts.length);
  if (index < 0) return;
  edges[index] = visual;
}

function relationForFlowID(analysis, dataID) {
  return analysis.relations.find(({ from, to }) => dataID.startsWith(`L_${from}_${to}_`));
}

function relationForBlockID(analysis, dataID) {
  return analysis.relations.find(({ from, to }) => dataID.endsWith(`-${from}-${to}`));
}

function relationForClassID(analysis, dataID) {
  return analysis.relations.find(({ from, to }) => new RegExp(`^id_${escapeRegExp(from)}_${escapeRegExp(to)}_\\d+$`).test(dataID));
}

function relationForERID(analysis, dataID) {
  return analysis.relations.find(({ from, to }) => new RegExp(
    `^id_entity-${escapeRegExp(from)}-\\d+_entity-${escapeRegExp(to)}-\\d+_\\d+$`,
  ).test(dataID));
}

function relationForRequirementID(analysis, dataID) {
  return analysis.relations.find(({ from, to }) => dataID.startsWith(`${from}-${to}-`));
}

function relationForArchitectureID(analysis, id) {
  return analysis.relations.find(({ from, to }) => new RegExp(
    `(?:^|-)L_${escapeRegExp(from)}_${escapeRegExp(to)}_\\d+$`,
  ).test(id));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function edgeLabels(svg, edge) {
  const id = edge.dataset?.id;
  if (!id) return [];
  return elementsFor(svg, "g.edgeLabel .label, g.edgeLabel, g.label[data-id]")
    .filter((label) => label.dataset?.id === id);
}

function visualEdge(svg, path, relation, labelParts = edgeLabels(svg, path)) {
  return {
    id: path.dataset?.id || path.id,
    from: relation.from,
    to: relation.to,
    pathParts: PAINT_TAGS.has(path.localName) ? [path] : directPaintParts(path),
    arrowParts: markerParts(svg, path),
    labelParts,
  };
}

function targetByRendererKey(targets, rendererKey) {
  const candidate = normalize(rendererKey);
  return targets.find((target) => normalize(target.rendererKey) === candidate || normalize(target.key) === candidate);
}

function applySemanticGroups(targets, analysis, groupTargets, groups) {
  const groupByKey = new Map(groupTargets.map((target) => {
    const group = groups.groups.find(({ label }) => normalize(label) === normalize(target.label));
    return [target.key, group];
  }));
  targets.forEach((target) => {
    if (target.groupKey) return;
    const relation = analysis.relations.find(({ from, to }) => to === target.key && groupByKey.has(from));
    const group = relation && groupByKey.get(relation.from);
    if (group) {
      target.groupKey = group.key;
      target.groupLabel = group.label;
    }
  });
}

function extractFlowchart(svg, analysis, id) {
  const groups = groupData(svg, "g.cluster", ".cluster-label, .nodeLabel", `${id}-group`);
  const targets = [];
  addTargets(targets, analysis, nodeCandidates(svg, "g.node", ".nodeLabel, .label", id), new Set(), groups, { allowUnmatched: id !== "block" });
  const edges = semanticEdges(analysis, targets);
  elementsFor(svg, "path.flowchart-link[data-id]").forEach((path) => {
    const relation = relationForFlowID(analysis, path.dataset.id)
      || (id === "block" ? relationForBlockID(analysis, path.dataset.id) : undefined);
    if (relation) replaceSemanticEdge(edges, relation.from, relation.to, visualEdge(svg, path, relation));
  });
  return { targets, edges, groups: [...groups.groups, ...(analysis.groups || [])] };
}

function extractSequence(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const targets = [];
  addTargets(targets, analysis, nodeCandidates(
    svg,
    'g[data-et="participant"][data-id], g.actor[data-id]',
    ".actor, text",
    "sequence",
    "",
  ), new Set(), groups);
  const edges = semanticEdges(analysis, targets);
  const messages = elementsFor(svg, '[data-et="message"][data-from][data-to]');
  const labels = elementsFor(svg, "text.messageText");
  const numbers = elementsFor(svg, "text.sequenceNumber");
  messages.forEach((message, index) => {
    const from = targetByRendererKey(targets, message.dataset.from);
    const to = targetByRendererKey(targets, message.dataset.to);
    if (!from || !to) return;
    replaceSemanticEdge(edges, from.key, to.key, visualEdge(
      svg,
      message,
      { from: from.key, to: to.key },
      [labels[index], numbers[index]].filter(Boolean),
    ));
  });
  return { targets, edges, groups: [] };
}

function extractClass(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const targets = [];
  addTargets(targets, analysis, nodeCandidates(svg, "g.node", ".label-group, .nodeLabel", "class"), new Set(), groups);
  const edges = semanticEdges(analysis, targets);
  const terminals = elementsFor(svg, "g.edgeTerminals");
  elementsFor(svg, "path.relation[data-id]").forEach((path) => {
    const relation = relationForClassID(analysis, path.dataset.id);
    if (relation) replaceSemanticEdge(
      edges,
      relation.from,
      relation.to,
      visualEdge(svg, path, relation, [
        ...edgeLabels(svg, path),
        ...terminals.filter((terminal) => relation.cardinalities?.includes(textValue(terminal))),
      ]),
    );
  });
  return { targets, edges, groups: [] };
}

function extractState(svg, analysis) {
  const groups = groupData(svg, "g.statediagram-state.statediagram-cluster", ".cluster-label", "state-group");
  const targets = [];
  addTargets(targets, analysis, nodeCandidates(
    svg,
    "g.node:not(.statediagram-note), g.statediagram-state.statediagram-cluster",
    ".nodeLabel, .cluster-label",
    "state",
    ".label-container, .outer-path, .outer, .inner",
  ), new Set(), groups, { allowUnmatched: false });
  return { targets, edges: semanticEdges(analysis, targets), groups: [...groups.groups, ...(analysis.groups || [])] };
}

function extractER(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const targets = [];
  addTargets(targets, analysis, nodeCandidates(svg, "g.node", ".label.name", "er", ".outer-path, .row-rect-odd, .row-rect-even"), new Set(), groups);
  const edges = semanticEdges(analysis, targets);
  elementsFor(svg, "path.relationshipLine[data-id]").forEach((path) => {
    const relation = relationForERID(analysis, path.dataset.id);
    if (relation) replaceSemanticEdge(edges, relation.from, relation.to, visualEdge(svg, path, relation));
  });
  return { targets, edges, groups: [] };
}

function extractRequirement(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const targets = [];
  addTargets(targets, analysis, nodeCandidates(svg, "g.node", "g.label", "requirement"), new Set(), groups);
  const edges = semanticEdges(analysis, targets);
  elementsFor(svg, "path.relationshipLine[data-id]").forEach((path) => {
    const relation = relationForRequirementID(analysis, path.dataset.id);
    if (relation) replaceSemanticEdge(edges, relation.from, relation.to, visualEdge(svg, path, relation));
  });
  return { targets, edges, groups: [] };
}

function extractArchitecture(svg, analysis) {
  const groups = groupData(svg, "g.architecture-group", ".architecture-group-label, text", "architecture-group");
  const targets = [];
  addTargets(targets, analysis, elementsFor(svg, "g.architecture-service").map((element, index) => {
    const iconRoot = element.querySelector("svg > g");
    const boundary = [...(iconRoot?.children || [])].find((child) => child.localName === "rect");
    return {
      element,
      rendererKey: rawRendererKey(element, `architecture:${index + 1}`),
      labels: textValues(element, ".text-inner-tspan"),
      paintParts: boundary ? [boundary] : directPaintParts(element),
    };
  }), new Set(), groups);
  const edges = semanticEdges(analysis, targets);
  elementsFor(svg, "g.architecture-edges path.edge").forEach((path) => {
    const relation = relationForArchitectureID(analysis, path.id);
    if (!relation) return;
    const edge = visualEdge(svg, path, relation);
    edge.arrowParts = elementsFor(path.parentElement, "polygon.arrow");
    replaceSemanticEdge(edges, relation.from, relation.to, edge);
  });
  return { targets, edges, groups: [...groups.groups, ...(analysis.groups || [])] };
}

function extractSankey(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const labels = elementsFor(svg, "g.node-labels text");
  const targets = [];
  addTargets(targets, analysis, elementsFor(svg, "g.nodes > g.node").map((element, index) => ({
    element,
    rendererKey: rawRendererKey(element, `sankey:${index + 1}`),
    labels: [String(labels[index]?.textContent || "").split(/\r?\n/)[0].trim()],
    paintParts: directPaintParts(element),
  })), new Set(), groups);
  // Sankey links expose no endpoint metadata. Keep source relations available
  // without guessing link order from layout output.
  return { targets, edges: semanticEdges(analysis, targets), groups: [] };
}

function extractMindmap(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const targets = [];
  addTargets(targets, analysis, nodeCandidates(
    svg,
    "g.node.mindmap-node",
    ".nodeLabel, .label",
    "mindmap",
    ".label-container, .node-bkg, .node-line-",
  ), new Set(), groups);
  const edges = semanticEdges(analysis, targets);
  elementsFor(svg, 'path[data-et="edge"][data-id]').forEach((path) => {
    const relation = analysis.relations.find(({ rendererEdgeId }) => rendererEdgeId === path.dataset.id);
    if (relation) replaceSemanticEdge(edges, relation.from, relation.to, visualEdge(svg, path, relation));
  });
  return { targets, edges, groups: [] };
}

function extractTreeView(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const targets = [];
  addTargets(targets, analysis, elementsFor(svg, "text.treeView-node-label").map((label, index) => ({
    element: label.parentElement?.localName === "g" ? label.parentElement : label,
    rendererKey: `treeView:${index + 1}`,
    labels: [textValue(label)],
    paintParts: [label],
  })), new Set(), groups);
  return { targets, edges: semanticEdges(analysis, targets), groups: [] };
}

function extractTreemap(svg, analysis) {
  const groups = groupData(svg, "g.treemapSection", "text.treemapSectionLabel", "treemap-group");
  const targets = [];
  const used = new Set();
  const sectionTargets = [];
  addTargets(sectionTargets, analysis, elementsFor(svg, "g.treemapSection").map((element, index) => ({
    element,
    rendererKey: `treemap-section:${index + 1}`,
    labels: textValues(element, "text.treemapSectionLabel"),
    paintParts: directPaintParts(element),
  })), used, groups);
  targets.push(...sectionTargets);
  addTargets(targets, analysis, elementsFor(svg, "g.treemapNode.treemapLeafGroup").map((element, index) => ({
    element,
    rendererKey: `treemap-leaf:${index + 1}`,
    labels: textValues(element, "text.treemapLabel"),
    paintParts: directPaintParts(element),
  })), used, groups);
  applySemanticGroups(targets, analysis, sectionTargets, groups);
  return { targets, edges: semanticEdges(analysis, targets), groups: groups.groups };
}

function extractIshikawa(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const targets = [];
  const used = new Set();
  addTargets(targets, analysis, nodeCandidates(svg, "g.ishikawa-head-group", ".ishikawa-head-label", "ishikawa-head", ".ishikawa-head"), used, groups);
  addTargets(targets, analysis, nodeCandidates(svg, "g.ishikawa-label-group", ".ishikawa-label.cause", "ishikawa-label", ".ishikawa-label-box"), used, groups);
  addTargets(targets, analysis, nodeCandidates(svg, "g.ishikawa-sub-group", ".ishikawa-label.align", "ishikawa-sub", ".ishikawa-sub-branch"), used, groups);
  return { targets, edges: semanticEdges(analysis, targets), groups: [] };
}

function extractWardley(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const targets = [];
  addTargets(targets, analysis, elementsFor(svg, "g.wardley-node").map((element, index) => {
    const paintParts = directPaintParts(element);
    return {
      element,
      rendererKey: rawRendererKey(element, `wardley:${index + 1}`),
      labels: textValues(element, ".wardley-node-label"),
      paintParts: paintParts.length ? paintParts : elementsFor(element, ".wardley-node-label"),
    };
  }), new Set(), groups);
  return { targets, edges: semanticEdges(analysis, targets), groups: [] };
}

function extractGantt(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const targets = [];
  addTargets(targets, analysis, elementsFor(svg, "rect.task").map((element, index) => {
    const label = textSibling(svg, element, "-text", "text.taskText, text.taskTextOutsideLeft, text.taskTextOutsideRight");
    return {
      element,
      rendererKey: rawRendererKey(element, `gantt:${index + 1}`),
      labels: [textValue(label)],
      paintParts: [element],
    };
  }), new Set(), groups);
  return { targets, edges: semanticEdges(analysis, targets), groups: analysis.groups || [] };
}

function extractKanban(svg, analysis) {
  const groups = groupData(svg, "g.cluster", ".cluster-label", "kanban-group");
  const targets = [];
  const used = new Set();
  const groupTargets = [];
  addTargets(groupTargets, analysis, nodeCandidates(svg, "g.cluster", ".cluster-label", "kanban-cluster"), used, groups);
  targets.push(...groupTargets);
  addTargets(targets, analysis, nodeCandidates(svg, "g.items > g.node", ".nodeLabel, .label", "kanban"), used, groups);
  applySemanticGroups(targets, analysis, groupTargets, groups);
  return { targets, edges: semanticEdges(analysis, targets), groups: groups.groups };
}

function extractEventModeling(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const targets = [];
  addTargets(targets, analysis, elementsFor(svg, "g.em-box").map((element, index) => ({
    element,
    rendererKey: `eventModeling:${index + 1}`,
    labels: textValues(element, "foreignObject b"),
    paintParts: directPaintParts(element),
  })), new Set(), groups);
  return { targets, edges: [], groups: [] };
}

function extractTimeline(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const targets = [];
  // Timeline periods and their colon-delimited events are separate targets.
  addTargets(targets, analysis, elementsFor(svg, "g.taskWrapper > g.timeline-node, g.eventWrapper > g.timeline-node").map((element, index) => ({
    element,
    rendererKey: `timeline:${index + 1}`,
    labels: [textValue(element)],
    paintParts: elementsFor(element, ":scope > g > circle, :scope > g > line, :scope > g > path, :scope > g > rect"),
  })), new Set(), groups);
  return { targets, edges: semanticEdges(analysis, targets), groups: analysis.groups || [] };
}

function extractGit(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const targets = [];
  addTargets(targets, analysis, elementsFor(svg, "circle.commit:not(.commit-merge)").map((element, index) => ({
    element,
    rendererKey: rawRendererKey(element, `git:${index + 1}`),
    labels: [...element.classList].filter((name) => !/^(commit|commit-merge|commit\d+)$/.test(name)),
    paintParts: [element],
  })), new Set(), groups);
  return { targets, edges: semanticEdges(analysis, targets), groups: analysis.groups || [] };
}

function extractJourney(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const labels = elementsFor(svg, "text.task");
  const targets = [];
  addTargets(targets, analysis, elementsFor(svg, "rect.task").map((element, index) => ({
    element,
    rendererKey: `journey:${index + 1}`,
    labels: [textValue(labels[index])],
    paintParts: [element],
  })), new Set(), groups);
  return { targets, edges: [], groups: [] };
}

function extractPacket(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const labels = elementsFor(svg, "text.packetLabel");
  const targets = [];
  addTargets(targets, analysis, elementsFor(svg, "rect.packetBlock").map((element, index) => ({
    element,
    rendererKey: `packet:${index + 1}`,
    labels: [textValue(labels[index])],
    paintParts: [element],
  })), new Set(), groups);
  return { targets, edges: [], groups: [] };
}

function extractRailroad(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const targets = [];
  addTargets(targets, analysis, elementsFor(svg, "g.railroad-rule").map((element, index) => ({
    element,
    rendererKey: `railroad:${index + 1}`,
    labels: textValues(element, "g.railroad-rule-name-group text").map((label) => label.replace(/\s*(?:=|<-)\s*$/, "")),
    paintParts: directPaintParts(element),
  })), new Set(), groups);
  return { targets, edges: [], groups: [] };
}

function extractC4(svg, analysis) {
  const groups = { groups: [], byElement: new Map() };
  const targets = [];
  addTargets(targets, analysis, nodeCandidates(svg, "g.node.c4-shape", ".c4-name", "c4"), new Set(), groups);
  return { targets, edges: semanticEdges(analysis, targets), groups: [] };
}

const svgExtractors = {
  flowchart: (svg, analysis) => extractFlowchart(svg, analysis, "flowchart"),
  swimlane: (svg, analysis) => extractFlowchart(svg, analysis, "swimlane"),
  block: (svg, analysis) => extractFlowchart(svg, analysis, "block"),
  sequence: extractSequence,
  class: extractClass,
  state: extractState,
  er: extractER,
  requirement: extractRequirement,
  architecture: extractArchitecture,
  sankey: extractSankey,
  mindmap: extractMindmap,
  treeView: extractTreeView,
  treemap: extractTreemap,
  ishikawa: extractIshikawa,
  wardley: extractWardley,
  gantt: extractGantt,
  kanban: extractKanban,
  eventmodeling: extractEventModeling,
  timeline: extractTimeline,
  gitGraph: extractGit,
  journey: extractJourney,
  packet: extractPacket,
  railroad: extractRailroad,
  c4: extractC4,
};

export function extractDiagramInteraction(svg, analysis) {
  if (!svg || analysis?.mode === CANVAS) return { targets: [], edges: [], groups: [] };
  return svgExtractors[analysis?.id]?.(svg, analysis) || { targets: [], edges: [], groups: [] };
}

export const supportedDiagramAdapters = adapters.map(({ id, mode }) => ({ id, mode }));
