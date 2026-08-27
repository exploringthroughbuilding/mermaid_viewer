// Sequence and ZenUML parsers. Messages become relations, `box` blocks become
// groups, and every arrow flavour (async, lost, bidirectional, activations) is
// recognised.
import { collection } from "./common.js";

const ARROW = /(<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\))/;
const BLOCK_OPENERS = /^(?:loop|alt|opt|par|critical|break|rect)\b/i;
const SKIPPED = /^(?:sequenceDiagram|title|autonumber|activate|deactivate|Note\b|note\b|else\b|and\b|option\b|links?\b|properties\b|details\b|accTitle|accDescr|%%)/i;

function participantId(fragment) {
  return fragment.trim().replace(/^"|"$/g, "");
}

export function parseSequence(rows) {
  const result = collection();
  const stack = [];
  const currentBox = () => [...stack].reverse().find((entry) => entry.kind === "box")?.key;

  rows.forEach(({ text, line }) => {
    if (!text || SKIPPED.test(text)) return;
    if (/^end\b/i.test(text)) {
      stack.pop();
      return;
    }
    const box = text.match(/^box\s+(?:(?:rgba?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)\s+)?(.*)$/i);
    if (box) {
      const label = box[1].trim() || "Box";
      result.addGroup(label, label, line, currentBox());
      stack.push({ kind: "box", key: label });
      return;
    }
    if (BLOCK_OPENERS.test(text)) {
      stack.push({ kind: "block" });
      return;
    }
    const participant = text.match(/^(?:create\s+)?(?:participant|actor)\s+("[^"]+"|[^\s:]+)(?:\s+as\s+(.+))?$/i);
    if (participant) {
      const key = participantId(participant[1]);
      result.addItem(key, participant[2]?.trim() || key, line, { group: currentBox(), explicitLabel: Boolean(participant[2]) });
      return;
    }
    if (/^destroy\s+/i.test(text)) return;
    const arrow = text.match(ARROW);
    if (!arrow || arrow.index === 0) return;
    const from = participantId(text.slice(0, arrow.index));
    const remainder = text.slice(arrow.index + arrow[0].length).replace(/^\s*[+-]?\s*/, "");
    const colon = remainder.indexOf(":");
    const to = participantId(colon >= 0 ? remainder.slice(0, colon) : remainder);
    const label = colon >= 0 ? remainder.slice(colon + 1).trim() : "";
    if (!from || !to || /\s/.test(to)) return;
    result.addItem(from, from, line);
    result.addItem(to, to, line);
    result.addRelation(from, to, line, label);
    if (arrow[0].startsWith("<<")) result.addRelation(to, from, line, label);
  });
  return result;
}

const ZEN_SKIPPED = /^(?:zenuml|title\b|if\b|else\b|while\b|for(?:Each)?\b|try\b|catch\b|finally\b|return\b|opt\b|par\b|new\b|\/\/|@Starter|\}|\{)/i;

export function parseZenuml(rows) {
  const result = collection();
  rows.forEach(({ text, line }) => {
    if (!text || ZEN_SKIPPED.test(text)) return;
    const annotated = text.match(/^@(?:Actor|Database|Boundary|Control|Entity|Queue|EC2|Lambda|S3|Cloud)\s+([\w.-]+)(?:\s+as\s+(.+))?$/i);
    const alias = text.match(/^([\w.-]+)\s+as\s+(.+)$/i);
    const declared = annotated || alias;
    if (declared) {
      result.addItem(declared[1], declared[2] || declared[1], line, { explicitLabel: Boolean(declared[2]) });
      return;
    }
    const message = text.match(/^([\w.-]+)\s*->\s*([\w.-]+)\s*(?:[:.]\s*(.*))?$/);
    if (message) {
      result.addItem(message[1], message[1], line);
      result.addItem(message[2], message[2], line);
      result.addRelation(message[1], message[2], line, message[3] || "");
      return;
    }
    const call = text.match(/^(?:[\w<>]+\s+)?(?:[\w.-]+\s*=\s*)?(?:new\s+)?([A-Za-z_][\w.-]*)\s*\.\s*[\w$]+\s*\(/);
    if (call) result.addItem(call[1], call[1], line);
    else if (/^[A-Za-z_][\w.-]*$/.test(text)) result.addItem(text, text, line);
  });
  return result;
}
