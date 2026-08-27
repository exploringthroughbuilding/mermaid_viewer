// Parsers for indentation-driven and list-driven grammars: mindmap, tree views,
// kanban, gantt, timeline, journey, git graphs and the ordered chart families.
import { cleanLabel, collection } from "./common.js";

const MINDMAP_SHAPE = /^([\w.-]+)?\s*(?:\(\((.*)\)\)|\)\)(.*)\(\(|\)(.*)\(|\{\{(.*)\}\}|\[(.*)\]|\((.*)\))$/;

export function mindmapNode(text) {
  const clean = text.replace(/:::\S+$/, "").trim();
  const shaped = clean.match(MINDMAP_SHAPE);
  if (!shaped) return { key: clean, label: clean };
  const label = cleanLabel(shaped.slice(2).find((part) => part != null) ?? "") || shaped[1] || clean;
  return { key: shaped[1] || label, label };
}

export function kanbanNode(text) {
  const shaped = text.match(/^([\w.-]+)\s*\[(.*?)\](?:@\{.*\})?$/);
  if (shaped) return { key: shaped[1], label: cleanLabel(shaped[2]) || shaped[1] };
  return { key: text, label: text };
}

export function treeNode(text) {
  const label = text.replace(/\s*##.*$/, "").replace(/:::\S+$/, "").replace(/^"|"(?:\s*:\s*\d+)?$/g, "").trim();
  return { key: label, label };
}

// Builds a hierarchy from indentation. `columnsAsGroups` treats top-level
// entries as groups instead of nodes (kanban columns); otherwise the depth-one
// branches become groups so the index can be browsed by branch.
export function parseIndented(rows, { declaration, nodeFor = treeNode, columnsAsGroups = false, relational = true }) {
  const result = collection();
  const stack = [];
  rows.forEach(({ text, line, indent }) => {
    if (!text || declaration.test(text) || /^(title|direction|%%)/i.test(text) || /^::icon\(/.test(text)) return;
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    const node = nodeFor(text);
    const depth = stack.length;
    if (columnsAsGroups && depth === 0) {
      result.addGroup(node.key, node.label, line);
      stack.push({ indent, key: node.key, group: node.key, isGroup: true });
      return;
    }
    const parent = stack.at(-1);
    const group = parent?.isGroup ? parent.group : depth === 1 && !columnsAsGroups ? node.key : parent?.group;
    if (!columnsAsGroups && depth === 1) result.addGroup(node.key, node.label, line);
    result.addItem(node.key, node.label, line, { aliases: [text], group, explicitLabel: true });
    if (relational && parent && !parent.isGroup) result.addRelation(parent.key, node.key, line);
    stack.push({ indent, key: node.key, group, isGroup: false });
  });
  if (!columnsAsGroups) {
    // A branch that has no descendants is not worth a group of its own.
    const members = new Map();
    result.items.forEach((item) => {
      if (item.group) members.set(item.group, (members.get(item.group) || 0) + 1);
    });
    result.groups.filter((group) => (members.get(group.key) || 0) < 2).forEach((group) => {
      result.removeGroup(group.key);
      const head = result.items.get(group.key);
      if (head) head.group = undefined;
    });
  }
  return result;
}

export function parseGantt(rows) {
  const result = collection();
  let section;
  let autoIndex = 0;
  rows.forEach(({ text, line }) => {
    if (!text || /^(gantt|title|dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|weekday|inclusiveEndDates|topAxis|%%)\b/i.test(text)) return;
    const sectionMatch = text.match(/^section\s+(.+)$/i);
    if (sectionMatch) {
      section = result.addGroup(sectionMatch[1].trim(), sectionMatch[1].trim(), line)?.key;
      return;
    }
    const task = text.match(/^(.+?)\s*:\s*(.+)$/);
    if (!task) return;
    const fields = task[2].split(",").map((value) => value.trim());
    const explicitId = fields.find((value) => /^[A-Za-z_][\w-]*$/.test(value) && !/^(done|active|crit|milestone|vert)$/i.test(value));
    const id = explicitId || `task-auto-${autoIndex += 1}`;
    result.addItem(id, task[1].trim(), line, { group: section, explicitLabel: true });
    const dependency = task[2].match(/\bafter\s+([\w\s-]+?)(?:,|$)/i);
    dependency?.[1].trim().split(/\s+/).forEach((parent) => result.addRelation(parent, id, line));
  });
  return result;
}

export function parseTimeline(rows) {
  const result = collection();
  let section;
  let periodIndex = 0;
  rows.forEach(({ text, line }) => {
    if (!text || /^(timeline|title|%%)\b/i.test(text)) return;
    const sectionMatch = text.match(/^section\s+(.+)$/i);
    if (sectionMatch) {
      section = result.addGroup(sectionMatch[1].trim(), sectionMatch[1].trim(), line)?.key;
      // Section headers are drawn as timeline nodes too, so keep them addressable.
      result.addItem(section, section, line, { group: section, kind: "section" });
      return;
    }
    const parts = text.split(/\s*:\s*/).map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;
    periodIndex += 1;
    const periodKey = `period-${periodIndex}`;
    result.addItem(periodKey, parts[0], line, { group: section, explicitLabel: true });
    parts.slice(1).forEach((event, index) => {
      result.addItem(`${periodKey}-event-${index + 1}`, event, line, { group: section, explicitLabel: true });
    });
  });
  return result;
}

export function parseJourney(rows) {
  const result = collection();
  let section;
  let taskIndex = 0;
  rows.forEach(({ text, line }) => {
    if (!text || /^(journey|title|%%)\b/i.test(text)) return;
    const sectionMatch = text.match(/^section\s+(.+)$/i);
    if (sectionMatch) {
      section = result.addGroup(sectionMatch[1].trim(), sectionMatch[1].trim(), line)?.key;
      return;
    }
    const task = text.match(/^(.+?)\s*:\s*(\d+)\s*(?::\s*(.*))?$/);
    if (!task) return;
    taskIndex += 1;
    result.addItem(`task-${taskIndex}`, task[1], line, { group: section, explicitLabel: true, aliases: [task[3] || ""] });
  });
  return result;
}

export function parseGit(rows) {
  const result = collection();
  let branch = "main";
  let commitIndex = 0;
  rows.forEach(({ text, line }) => {
    if (!text || /^(gitGraph|title|%%)/i.test(text)) return;
    const branchMatch = text.match(/^(?:branch|checkout|switch)\s+([^\s]+)/i);
    if (branchMatch) {
      branch = branchMatch[1];
      result.addGroup(branch, branch, line);
      return;
    }
    const commit = text.match(/^(commit|merge|cherry-pick)\b(?:\s+([^\s]+))?/i);
    if (!commit) return;
    commitIndex += 1;
    const explicitId = text.match(/\bid:\s*"([^"]*)"/i)?.[1];
    const fallback = commit[1].toLowerCase() === "merge" ? `Merge ${commit[2]}` : commit[1].toLowerCase() === "cherry-pick" ? "Cherry-pick" : `Commit ${commitIndex}`;
    result.addItem(explicitId || `commit-auto-${commitIndex}`, explicitId || fallback, line, { group: branch, explicitLabel: true, aliases: [String(commitIndex)] });
  });
  return result;
}

export function parseOrdered(rows, declaration) {
  const result = collection();
  rows.forEach(({ text, line }, index) => {
    if (!text || declaration.test(text) || /^(title|section|dateFormat|axisFormat|x-axis|y-axis|quadrant-[1-4]|showData|accTitle|accDescr|%%)\b/i.test(text)) return;
    const label = text.match(/^\s*(?:"([^"]+)"|([^:]+?))\s*:/)?.[1]
      || text.match(/^\s*["']?([^"']+?)["']?(?:\s*:\s*|$)/)?.[1]
      || text;
    result.addItem(`item-${index}`, label.trim(), line, { aliases: [text], explicitLabel: true });
  });
  return result;
}
