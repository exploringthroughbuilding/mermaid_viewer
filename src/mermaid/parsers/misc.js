// Parsers for the remaining relational grammars: ER, architecture, sankey,
// requirement, C4 and Wardley maps.
import { collection } from "./common.js";

export function parseER(rows) {
  const result = collection();
  let inEntity = false;
  rows.forEach(({ text, line }) => {
    if (!text || /^(erDiagram|title|direction|%%)/i.test(text)) return;
    if (inEntity) {
      if (text === "}") inEntity = false;
      return;
    }
    const relation = text.match(/^([\w-]+)(?:\s*\[\s*"([^"]*)"\s*\])?\s+(\S+(?:\s+(?:to|or|many|one|zero|more)\s+\S+)*)\s+([\w-]+)(?:\s*\[\s*"([^"]*)"\s*\])?\s*:\s*(.*)$/);
    if (relation) {
      result.addItem(relation[1], relation[2] || relation[1], line, { explicitLabel: Boolean(relation[2]) });
      result.addItem(relation[4], relation[5] || relation[4], line, { explicitLabel: Boolean(relation[5]) });
      result.addRelation(relation[1], relation[4], line, relation[6]);
      return;
    }
    const entity = text.match(/^([\w-]+)(?:\s*\[\s*"([^"]*)"\s*\])?\s*(\{)?$/);
    if (entity) {
      result.addItem(entity[1], entity[2] || entity[1], line, { explicitLabel: Boolean(entity[2]) });
      if (entity[3]) inEntity = true;
    }
  });
  return result;
}

export function parseArchitecture(rows) {
  const result = collection();
  rows.forEach(({ text, line }) => {
    if (!text || /^(architecture-beta|title|%%)/i.test(text)) return;
    const group = text.match(/^group\s+([\w-]+)(?:\([^)]*\))?\s*(?:\[([^\]]+)\])?(?:\s+in\s+([\w-]+))?/i);
    if (group) {
      result.addGroup(group[1], group[2] || group[1], line, group[3]);
      return;
    }
    const item = text.match(/^(service|junction)\s+([\w-]+)(?:\([^)]*\))?\s*(?:\[([^\]]+)\])?(?:\s+in\s+([\w-]+))?/i);
    if (item) {
      const isJunction = item[1].toLowerCase() === "junction";
      result.addItem(item[2], item[3] || (isJunction ? `Junction ${item[2]}` : item[2]), line, { group: item[4], explicitLabel: true, kind: isJunction ? "junction" : "node" });
      return;
    }
    const edge = text.match(/^([\w-]+)(?:\{group\})?(?::[LRBT])?\s+(<)?[-=.]{2,}(>)?\s+(?:[LRBT]:)?([\w-]+)(?:\{group\})?/i);
    if (edge) {
      const pointsLeft = Boolean(edge[2]) && !edge[3];
      result.addRelation(pointsLeft ? edge[4] : edge[1], pointsLeft ? edge[1] : edge[4], line);
      if (edge[2] && edge[3]) result.addRelation(edge[4], edge[1], line);
    }
  });
  return result;
}

export function parseSankey(rows) {
  const result = collection();
  rows.forEach(({ text, line }) => {
    if (!text || /^sankey-beta$/i.test(text) || text.startsWith("%%")) return;
    const columns = text.match(/^\s*(?:"([^"]+)"|([^,]+))\s*,\s*(?:"([^"]+)"|([^,]+))\s*,/);
    if (!columns) return;
    result.addRelation((columns[1] || columns[2]).trim(), (columns[3] || columns[4]).trim(), line);
  });
  return result;
}

export function parseRequirement(rows) {
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

const C4_SHAPES = /^(?:Person|Person_Ext|System|System_Ext|SystemDb|SystemQueue|SystemDb_Ext|SystemQueue_Ext|Container|ContainerDb|ContainerQueue|Container_Ext|ContainerDb_Ext|ContainerQueue_Ext|Component|ComponentDb|ComponentQueue|Component_Ext|ComponentDb_Ext|ComponentQueue_Ext|Deployment_Node|Node|Node_L|Node_R)\s*\(\s*([\w.-]+)\s*,\s*["']([^"']+)["']/i;
const C4_BOUNDARY = /^(?:Enterprise_Boundary|System_Boundary|Container_Boundary|Boundary|Deployment_Node|Node|Node_L|Node_R)\s*\(\s*([\w.-]+)\s*,\s*["']([^"']+)["'][^{]*\{/i;

export function parseC4(rows) {
  const result = collection();
  const stack = [];
  rows.forEach(({ text, line }) => {
    if (!text || /^(?:C4\w*|title|%%)/i.test(text) || /^Update/i.test(text)) return;
    if (text === "}") {
      stack.pop();
      return;
    }
    const boundary = text.match(C4_BOUNDARY);
    if (boundary) {
      result.addGroup(boundary[1], boundary[2], line, stack.at(-1));
      stack.push(boundary[1]);
      return;
    }
    const item = text.match(C4_SHAPES);
    if (item) {
      result.addItem(item[1], item[2], line, { group: stack.at(-1), explicitLabel: true });
      return;
    }
    const relation = text.match(/^(?:Rel|BiRel|Rel_U|Rel_D|Rel_L|Rel_R|Rel_Up|Rel_Down|Rel_Left|Rel_Right|Rel_Back|Rel_Neighbor)\s*\(\s*([\w.-]+)\s*,\s*([\w.-]+)(?:\s*,\s*["']([^"']*)["'])?/i)
      || text.match(/^RelIndex\s*\(\s*[^,]+,\s*([\w.-]+)\s*,\s*([\w.-]+)(?:\s*,\s*["']([^"']*)["'])?/i);
    if (relation) {
      result.addRelation(relation[1], relation[2], line, relation[3] || "");
      if (/^BiRel/i.test(text)) result.addRelation(relation[2], relation[1], line, relation[3] || "");
    }
  });
  return result;
}

export function parseWardley(rows) {
  const result = collection();
  rows.forEach(({ text, line }) => {
    if (!text || /^(wardley-beta|title|evolve|note|pipeline|style|%%)/i.test(text)) return;
    const item = text.match(/^(?:anchor|component)\s+(.+?)\s*\[/i);
    if (item) {
      result.addItem(item[1].trim(), item[1].trim(), line);
      return;
    }
    const link = text.match(/^(.+?)\s*(?:->|-->|\+<>|<>)\s*(.+?)(?:\s*;.*)?$/);
    if (link) result.addRelation(link[1].trim(), link[2].trim(), line);
  });
  return result;
}
