// State diagram parser: transitions, descriptions, composite states (as
// groups), pseudo start/end states named the way Mermaid renders them, fork /
// join / choice states, and notes.
import { collection } from "./common.js";

const STATE_ID = "[\\w.-]+";
const TRANSITION = new RegExp(`^(\\[\\*\\]|${STATE_ID})\\s*-->\\s*(\\[\\*\\]|${STATE_ID})\\s*(?::\\s*(.*))?$`);
const SKIPPED = /^(?:stateDiagram(?:-v2)?|direction|classDef|class\s|hide\s|style\s|title|accTitle|accDescr|%%)/i;

export function parseState(rows) {
  const result = collection();
  const scopes = [];
  const scope = () => scopes.at(-1)?.key;
  const pseudoKey = (marker, role) => (scope() ? `${scope()}_${role}` : `root_${role}`);
  const resolve = (token, role) => {
    if (token === "[*]") {
      const key = pseudoKey(token, role);
      const suffix = scope() ? ` (${scopes.at(-1).label})` : "";
      result.addItem(key, `${role === "start" ? "Start" : "End"}${suffix}`, undefined, { group: scope(), kind: "pseudo", explicitLabel: true });
      return key;
    }
    result.addItem(token, token, undefined, { group: scope() });
    return token;
  };
  let pendingNote = null;

  rows.forEach(({ text, line }) => {
    if (pendingNote) {
      if (/^end note$/i.test(text)) {
        result.addItem(`${pendingNote.state}----note`, `Note: ${pendingNote.lines.join(" ")}`, pendingNote.line, { kind: "note", explicitLabel: true });
        pendingNote = null;
      } else pendingNote.lines.push(text);
      return;
    }
    if (!text || SKIPPED.test(text) || text === "--") return;
    if (text === "}") {
      scopes.pop();
      return;
    }
    const composite = text.match(/^state\s+(?:"([^"]+)"\s+as\s+)?([\w.-]+)\s*\{/i);
    if (composite) {
      const label = composite[1] || composite[2];
      result.addGroup(composite[2], label, line, scope());
      result.addItem(composite[2], label, line, { group: scope(), explicitLabel: Boolean(composite[1]), kind: "group" });
      scopes.push({ key: composite[2], label });
      return;
    }
    const alias = text.match(/^state\s+"([^"]+)"\s+as\s+([\w.-]+)/i);
    if (alias) {
      result.addItem(alias[2], alias[1], line, { group: scope(), explicitLabel: true });
      return;
    }
    const special = text.match(/^state\s+([\w.-]+)\s*<<(fork|join|choice)>>/i);
    if (special) {
      result.addItem(special[1], `${special[1]} (${special[2]})`, line, { group: scope(), explicitLabel: true });
      return;
    }
    const plain = text.match(/^state\s+([\w.-]+)\s*$/i);
    if (plain) {
      result.addItem(plain[1], plain[1], line, { group: scope() });
      return;
    }
    const note = text.match(/^note\s+(?:left|right)\s+of\s+([\w.-]+)\s*(?::\s*(.*))?$/i);
    if (note) {
      if (note[2]) result.addItem(`${note[1]}----note`, `Note: ${note[2]}`, line, { kind: "note", explicitLabel: true });
      else pendingNote = { state: note[1], line, lines: [] };
      return;
    }
    const transition = text.match(TRANSITION);
    if (transition) {
      const from = resolve(transition[1], "start");
      const to = resolve(transition[2], "end");
      result.addItem(from, from, line, { group: scope() });
      result.addItem(to, to, line, { group: scope() });
      result.addRelation(from, to, line, transition[3] || "");
      return;
    }
    const description = text.match(/^([\w.-]+)\s*:\s*(.+)$/);
    if (description) {
      result.addItem(description[1], description[1], line, { group: scope(), aliases: [description[2]] });
      return;
    }
    // A bare identifier inside a diagram or composite declares a state.
    if (/^[\w.-]+$/.test(text)) result.addItem(text, text, line, { group: scope() });
  });
  return result;
}
