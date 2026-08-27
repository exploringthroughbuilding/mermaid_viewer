// Tokenising parser for flowchart-style grammars (flowchart, graph, block-beta,
// swimlane). It understands every node shape delimiter, `@{ }` shape data,
// `&` node lists, chained links, inline and piped edge text, and subgraph
// nesting, so relations and grouping stay faithful to what Mermaid draws.
import { collection, readShape, shapeLabel, splitStatements } from "./common.js";

// Mirrors Mermaid's NODE_STRING lexer rule: a dash only continues an id when it
// is not the start of a link token.
const ID_PATTERN = /(?:[\w -￿!#$%*+.?\\/']|-(?![>\-.]))+/y;
const LINK_PATTERN = /([xo<]?)(-{2,}|={2,}|-?\.+-|~{3,}|-\.)([xo>]?)/y;
const PIPE_PATTERN = /\s*\|([^|]*)\|/y;
const CLASS_SUFFIX = /:::[\w-]+/y;
const SKIPPED_STATEMENT = /^(?:flowchart|graph|swimlane-beta|block-beta|classDef|class|style|linkStyle|click|direction|title|accTitle|accDescr|columns)\b/i;

function skipSpaces(text, position) {
  let cursor = position;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

function readNode(text, position) {
  const start = skipSpaces(text, position);
  ID_PATTERN.lastIndex = start;
  const match = ID_PATTERN.exec(text);
  if (!match) return null;
  const id = match[0];
  let end = start + id.length;
  const shapes = [];
  while (end < text.length && ("[({>".includes(text[end]) || text.startsWith("@{", end))) {
    const next = readShape(text, end);
    if (next <= end) break;
    shapes.push(text.slice(end, next));
    end = next;
  }
  CLASS_SUFFIX.lastIndex = end;
  if (CLASS_SUFFIX.exec(text)) end = CLASS_SUFFIX.lastIndex;
  return { id, shapes, end };
}

// Shape data with an explicit label wins; otherwise the first bracket shape names the node.
function labelFromShapes(shapes, id) {
  const shapeData = shapes.find((shape) => shape.startsWith("@{") && /\blabel\s*:/.test(shape));
  if (shapeData) return shapeLabel(shapeData, id);
  const bracket = shapes.find((shape) => !shape.startsWith("@{"));
  return bracket ? shapeLabel(bracket, id) : id;
}

function readLink(text, position) {
  const start = skipSpaces(text, position);
  LINK_PATTERN.lastIndex = start;
  const match = LINK_PATTERN.exec(text);
  if (!match) return null;
  const [token, startMarker, body] = match;
  let endMarker = match[3];
  let cursor = start + token.length;
  let label = "";
  const opensText = !endMarker && (body === "--" || body === "==" || body === "-.");
  if (opensText) {
    const closer = body === "--" ? /(-{2,})([xo>]?)/g : body === "==" ? /(={2,})([xo>]?)/g : /(\.+-)([xo>]?)/g;
    closer.lastIndex = cursor;
    const closing = closer.exec(text);
    if (!closing) return null;
    label = text.slice(cursor, closing.index).trim();
    endMarker = closing[2];
    cursor = closing.index + closing[0].length;
  }
  PIPE_PATTERN.lastIndex = cursor;
  const pipe = PIPE_PATTERN.exec(text);
  if (pipe) {
    label = pipe[1].trim();
    cursor = PIPE_PATTERN.lastIndex;
  }
  const pointsLeft = Boolean(startMarker);
  const pointsRight = Boolean(endMarker);
  return {
    end: cursor,
    label,
    invisible: body.startsWith("~"),
    direction: pointsLeft && pointsRight ? "both" : pointsLeft ? "left" : "right",
  };
}

function readNodeList(text, position, blockMode) {
  const nodes = [];
  let cursor = position;
  while (true) {
    const spaced = skipSpaces(text, cursor);
    if (blockMode && /^space(?::\d+)?(?=\s|$)/.test(text.slice(spaced))) {
      cursor = spaced + text.slice(spaced).match(/^space(?::\d+)?/)[0].length;
      continue;
    }
    const node = readNode(text, cursor);
    if (!node) break;
    nodes.push(node);
    cursor = node.end;
    const separator = skipSpaces(text, cursor);
    if (text[separator] === "&") {
      cursor = separator + 1;
      continue;
    }
    if (blockMode && separator < text.length && !readLink(text, separator)) {
      cursor = separator;
      continue;
    }
    break;
  }
  return nodes.length ? { nodes, end: cursor } : null;
}

function subgraphHeader(rest) {
  const text = rest.trim();
  const withShape = text.match(/^([^\s\[\]"]+)\s*(\[.*\])$/);
  if (withShape) return { key: withShape[1], label: shapeLabel(withShape[2], withShape[1]) };
  const quoted = text.match(/^"(.*)"$/);
  if (quoted) return { key: quoted[1], label: quoted[1] };
  return { key: text, label: text };
}

export function parseFlowchart(rows, options = {}) {
  const blockMode = options.block === true;
  const result = collection();
  const groupStack = [];
  const currentGroup = () => groupStack.at(-1)?.key;

  const declare = (node, line) => {
    const label = labelFromShapes(node.shapes, node.id);
    result.addItem(node.id, label, line, { group: currentGroup(), explicitLabel: label !== node.id });
  };

  const parseStatement = (text, line) => {
    let list = readNodeList(text, 0, blockMode);
    if (!list) return;
    list.nodes.forEach((node) => declare(node, line));
    let cursor = list.end;
    while (cursor < text.length) {
      const link = readLink(text, cursor);
      if (!link) break;
      const next = readNodeList(text, link.end, blockMode);
      if (!next) break;
      next.nodes.forEach((node) => declare(node, line));
      if (!link.invisible) {
        list.nodes.forEach((source) => next.nodes.forEach((target) => {
          if (link.direction !== "left") result.addRelation(source.id, target.id, line, link.label, { group: currentGroup() });
          if (link.direction !== "right") result.addRelation(target.id, source.id, line, link.label, { group: currentGroup() });
        }));
      }
      list = next;
      cursor = next.end;
    }
  };

  rows.forEach(({ text, line }) => {
    if (!text || text.startsWith("%%")) return;
    splitStatements(text).forEach((statement) => {
      const subgraph = statement.match(/^subgraph\s+(.+)$/i);
      if (subgraph) {
        const header = subgraphHeader(subgraph[1]);
        const group = result.addGroup(header.key, header.label, line, currentGroup());
        groupStack.push(group);
        return;
      }
      const block = blockMode && statement.match(/^block:([\w-]+)(?::\d+)?$/i);
      if (block) {
        groupStack.push(result.addGroup(block[1], block[1], line, currentGroup()));
        return;
      }
      if (/^end\b/i.test(statement)) {
        groupStack.pop();
        return;
      }
      if (SKIPPED_STATEMENT.test(statement)) return;
      parseStatement(statement, line);
    });
  });
  return result;
}
