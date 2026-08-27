// Class diagram parser: classes, namespaces, annotations, members and every
// relation token including cardinality strings on either side.
import { collection } from "./common.js";

const CLASS_ID = "[\\w.~$-]+";
const RELATION = new RegExp(
  `^(${CLASS_ID}|"[^"]+")\\s*(?:"[^"]*"\\s*)?(<\\|?|\\*|o|\\(\\))?(--|\\.\\.)(\\|>|\\*|o|>|\\(\\))?\\s*(?:"[^"]*"\\s*)?(${CLASS_ID}|"[^"]+")(?:\\s*:\\s*(.*))?$`,
);
const SKIPPED = /^(?:classDiagram(?:-v2)?|direction|note\b|click|callback|link|style|cssClass|classDef|title|accTitle|accDescr|%%)/i;

function classKey(raw) {
  return raw.replace(/^"|"$/g, "").replace(/~.*$/, "").trim();
}

export function parseClass(rows) {
  const result = collection();
  const stack = [];
  const currentNamespace = () => [...stack].reverse().find((entry) => entry.kind === "namespace")?.key;

  rows.forEach(({ text, line }) => {
    if (!text || SKIPPED.test(text)) return;
    if (text === "}") {
      stack.pop();
      return;
    }
    const namespace = text.match(/^namespace\s+([\w.-]+)\s*\{/i);
    if (namespace) {
      result.addGroup(namespace[1], namespace[1], line, currentNamespace());
      stack.push({ kind: "namespace", key: namespace[1] });
      return;
    }
    if (stack.at(-1)?.kind === "class") return;
    const declaration = text.match(/^class\s+([\w.~$-]+)(?:\s*\[\s*"([^"]*)"\s*\])?(?::::\S+)?\s*(\{)?/i);
    if (declaration) {
      const key = classKey(declaration[1]);
      result.addItem(key, declaration[2] || key, line, { group: currentNamespace(), explicitLabel: Boolean(declaration[2]) });
      if (declaration[3]) stack.push({ kind: "class", key });
      return;
    }
    const annotation = text.match(/^<<[^>]+>>\s+([\w.~$-]+)/);
    if (annotation) {
      result.addItem(classKey(annotation[1]), classKey(annotation[1]), line, { group: currentNamespace() });
      return;
    }
    const relation = text.match(RELATION);
    if (relation) {
      const left = classKey(relation[1]);
      const right = classKey(relation[5]);
      const leftMarker = Boolean(relation[2]);
      const rightMarker = Boolean(relation[4]);
      const label = relation[6] || "";
      result.addItem(left, left, line, { group: currentNamespace() });
      result.addItem(right, right, line, { group: currentNamespace() });
      // The marker side owns the relation, so `Animal <|-- Dog` reads as Dog → Animal.
      if (rightMarker || !leftMarker) result.addRelation(left, right, line, label);
      if (leftMarker) result.addRelation(right, left, line, label);
      return;
    }
    const member = text.match(/^([\w.~$-]+)\s*:\s*\S/);
    if (member) result.addItem(classKey(member[1]), classKey(member[1]), line, { group: currentNamespace() });
  });
  return result;
}
