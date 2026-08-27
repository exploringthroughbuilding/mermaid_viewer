// Finds selectable nodes in a rendered Mermaid SVG, names them, binds them to
// source items, and decides which shapes receive highlight strokes. Icons are
// never stroked: a node whose visible shape is missing (naked icon, stick
// figure, service icon) gets a synthetic outline box instead.
import { groupPath, matchSemanticItem } from "../mermaid/diagram-adapters.js";
import { boxArea, screenBox, unionBoxes } from "./svg-geometry.js";

const SHAPE_TAGS = new Set(["rect", "circle", "ellipse", "polygon", "path"]);
const WRAPPER_CLASSES = new Set(["label-container", "basic", "outer-path", "icon-shape2"]);
const TYPED_ID = /^(?:flowchart|classId|state|entity|service|junction)-(.+?)(?:-\d+)?$/;
const GENERIC_ID = /^(?:node[_-]\d+|root-\d+|actor\d*|item-\d+)?$/;

const labelRules = {
  class: [":scope > .label-group .nodeLabel", ":scope > .label-group .label"],
  er: [":scope > .label.name", ":scope > g.label"],
  c4: [".c4-name", ":scope > .label"],
  sequence: ["text.actor"],
  zenuml: ["text.participant-label"],
  timeline: ["text"],
  architecture: ["text"],
  packet: ["text"],
};
const DEFAULT_LABEL_RULES = [":scope > .label .nodeLabel", ":scope > .label", "text"];

const tagOf = (element) => element.tagName.toLowerCase();
const BLOCK_TAGS = new Set(["br", "p", "div", "li", "tr"]);

// textContent glues "Multi<br>line" into "Multiline"; this keeps a space at
// every line break or block boundary without forcing layout.
function readableText(element) {
  let text = "";
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    if (BLOCK_TAGS.has(tag)) text += " ";
    node.childNodes.forEach(walk);
    if (BLOCK_TAGS.has(tag) || tag === "tspan") text += " ";
  };
  walk(element);
  return text.replace(/\s+/g, " ").trim();
}

const textOf = (element) => (element ? readableText(element) : "");

function stripPrefix(id, svgId) {
  if (!id) return "";
  return id.startsWith(`${svgId}-`) ? id.slice(svgId.length + 1) : id;
}

function gitToken(element) {
  return [...element.classList].find((name) => name !== "commit" && name !== "commit-merge" && !/^commit\d+$/.test(name));
}

function rawKeyFor(element, kind, svgId) {
  if (element.dataset.id) return element.dataset.id;
  if (element.dataset.participant) return element.dataset.participant;
  if (element.getAttribute("name")) return element.getAttribute("name");
  if (kind === "gitGraph") return gitToken(element);
  const domId = stripPrefix(element.id, svgId);
  const typed = domId.match(TYPED_ID);
  if (typed) return typed[1];
  return GENERIC_ID.test(domId) ? undefined : domId;
}

function renderedLabelFor(element, kind, context) {
  if (kind === "gantt") return textOf(context.svg.querySelector(`#${CSS.escape(`${element.id}-text`)}`));
  if (kind === "journey") return textOf(element.parentElement?.querySelector("switch > *, text"));
  if (kind === "sankey") return textOf(context.sankeyLabels[context.index]).split(/\s+\d+$/)[0];
  if (kind === "gitGraph") return "";
  if (kind === "requirement") {
    // The first label is the stereotype (<<Requirement>>); the name follows it.
    const labels = [...element.querySelectorAll(":scope > .label")].map(textOf).filter(Boolean);
    return labels.find((text) => !/^<<.*>>$/.test(text)) || labels[0] || "";
  }
  const rules = labelRules[kind] || DEFAULT_LABEL_RULES;
  for (const rule of rules) {
    const found = element.querySelector(rule);
    if (found && textOf(found)) return textOf(found);
  }
  if (labelRules[kind]) return "";
  return textOf(element);
}

function isVisibleShape(shape) {
  const hidden = (value) => value === "none" || value === "transparent";
  const stroke = shape.getAttribute("stroke");
  const fill = shape.getAttribute("fill");
  return !(stroke != null && fill != null && hidden(stroke) && hidden(fill));
}

// Direct shapes plus the shapes inside Mermaid's roughjs wrapper groups; icons
// (nested <svg>), labels and decorative sub-groups are skipped on purpose.
function shapeCandidates(element) {
  if (SHAPE_TAGS.has(tagOf(element))) return [element];
  const found = [];
  for (const child of element.children) {
    const tag = tagOf(child);
    if (SHAPE_TAGS.has(tag)) {
      found.push(child);
      continue;
    }
    if (tag !== "g") continue;
    const classes = (child.getAttribute("class") || "").split(/\s+/).filter(Boolean);
    const shapes = [...child.children].filter((grandchild) => SHAPE_TAGS.has(tagOf(grandchild)));
    const isWrapper = classes.some((name) => WRAPPER_CLASSES.has(name));
    const onlyShapes = shapes.length > 0 && [...child.children].every((grandchild) => SHAPE_TAGS.has(tagOf(grandchild)) || tagOf(grandchild) === "line");
    if (isWrapper || (!classes.length && onlyShapes && shapes.some(isVisibleShape))) found.push(...shapes);
  }
  return found;
}

function synthesizeOutline(element) {
  let bbox;
  try {
    bbox = element.getBBox();
  } catch {
    return undefined;
  }
  if (!bbox || (!bbox.width && !bbox.height)) return undefined;
  const padding = 5;
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(bbox.x - padding));
  rect.setAttribute("y", String(bbox.y - padding));
  rect.setAttribute("width", String(bbox.width + padding * 2));
  rect.setAttribute("height", String(bbox.height + padding * 2));
  rect.setAttribute("rx", "6");
  rect.setAttribute("fill", "none");
  rect.setAttribute("stroke", "none");
  rect.setAttribute("pointer-events", "none");
  rect.classList.add("atlas-outline", "atlas-synthetic");
  element.append(rect);
  return rect;
}

function outlineElementsFor(element, nodeBox) {
  const candidates = shapeCandidates(element);
  if (candidates.length && candidates[0] === element) return candidates;
  const covered = unionBoxes(candidates.map(screenBox));
  const coverage = boxArea(nodeBox) ? boxArea(covered) / boxArea(nodeBox) : 0;
  if (candidates.length && coverage >= 0.45) return candidates;
  const synthetic = synthesizeOutline(element);
  return synthetic ? [synthetic] : candidates;
}

function clusterGroups(svg) {
  return [...svg.querySelectorAll("g.cluster")]
    .map((cluster, index) => {
      const box = screenBox(cluster);
      const label = textOf(cluster.querySelector(".cluster-label")) || cluster.dataset.id || stripPrefix(cluster.id, svg.id) || `Subgraph ${index + 1}`;
      return { key: cluster.dataset.id || cluster.id || `subgraph-${index}`, label, box, area: boxArea(box) };
    })
    .sort((a, b) => a.area - b.area);
}

function companionsFor(element, key, kind, context) {
  if (kind === "sequence") {
    const lifeline = context.svg.querySelector(`line.actor-line[data-id="${CSS.escape(key)}"]`);
    const companions = [];
    if (lifeline) {
      lifeline.classList.add("atlas-outline");
      companions.push(lifeline);
      const x = screenBox(lifeline).cx;
      const bottom = context.bottomActors.find((entry) => Math.abs(entry.cx - x) < 2);
      if (bottom) {
        bottom.rect.classList.add("atlas-outline");
        companions.push(bottom.group);
      }
    }
    return companions;
  }
  if (kind === "gantt") return [context.svg.querySelector(`#${CSS.escape(`${element.id}-text`)}`)].filter(Boolean);
  if (kind === "sankey") return [context.sankeyLabels[context.index]].filter(Boolean);
  if (kind === "journey") return [element.parentElement?.querySelector("switch")].filter(Boolean);
  if (kind === "gitGraph") {
    const token = gitToken(element) || "";
    const label = [...context.svg.querySelectorAll("g.commit-labels > g")].find((group) => token.endsWith(textOf(group.querySelector("text"))));
    return label ? [label] : [];
  }
  return [];
}

function detectionContext(svg, kind) {
  return {
    svg,
    index: 0,
    sankeyLabels: kind === "sankey" ? [...svg.querySelectorAll("g.node-labels text")] : [],
    bottomActors: kind === "sequence"
      ? [...svg.querySelectorAll("rect.actor-bottom")].map((rect) => ({ rect, group: rect.parentElement, cx: screenBox(rect).cx }))
      : [],
  };
}

function uniqueKey(base, taken) {
  let key = base;
  let counter = 1;
  while (taken.has(key)) key = `${base} #${counter += 1}`;
  return key;
}

// Mermaid names implicit state pseudo-nodes `<scope>_start` / `<scope>_end`.
function pseudoStateLabel(rawKey) {
  const match = rawKey?.match(/^(.*)_(start|end)$/);
  if (!match) return undefined;
  const role = match[2] === "start" ? "Start" : "End";
  const scope = match[1] === "root" || /^divider-id-\d+$/.test(match[1]) ? "" : ` (${match[1]})`;
  return `${role}${scope}`;
}

function chooseLabel({ rendered, semantic, rawKey, key, kind }) {
  if (semantic && (semantic.kind === "note" || semantic.kind === "pseudo" || semantic.kind === "junction")) return semantic.label;
  if (rendered) return rendered;
  if (kind === "state") return pseudoStateLabel(rawKey) || semantic?.label || key;
  return semantic?.label || key;
}

function semanticFor(analysis, { kind, element, rawKey, renderedLabel, used, ordinals }) {
  if (kind === "gitGraph") return analysis.items[ordinals.commit++];
  if (kind === "architecture" && element.matches(".architecture-junction")) {
    return analysis.items.filter((item) => item.kind === "junction")[ordinals.junction++];
  }
  return matchSemanticItem(analysis, rawKey, renderedLabel, used);
}

export function detectNodes(svg, analysis) {
  const kind = analysis.id;
  const selectors = analysis.selectors.filter((selector) => svg.querySelector(selector));
  const elements = selectors.length ? [...svg.querySelectorAll(selectors.join(", "))] : [];
  const context = detectionContext(svg, kind);
  const clusters = clusterGroups(svg);
  const usedSemanticKeys = new Set();
  const nodes = new Map();
  const seenGitTokens = new Set();
  const ordinals = { commit: 0, junction: 0 };

  // Read every box first so the writes below never interleave with layout reads.
  const boxes = elements.map(screenBox);

  elements.forEach((element, index) => {
    if (kind === "gitGraph") {
      const token = gitToken(element);
      if (!token || seenGitTokens.has(token)) return;
      seenGitTokens.add(token);
    }
    context.index = index;
    const rawKey = rawKeyFor(element, kind, svg.id);
    const renderedLabel = renderedLabelFor(element, kind, context);
    const semantic = semanticFor(analysis, { kind, element, rawKey, renderedLabel, used: usedSemanticKeys, ordinals });
    if (semantic) usedSemanticKeys.add(semantic.key);
    const baseKey = semantic?.key || rawKey || renderedLabel || `item-${index + 1}`;
    const key = uniqueKey(baseKey, nodes);
    const label = chooseLabel({ rendered: renderedLabel, semantic, rawKey, key, kind });
    const box = boxes[index];
    const semanticGroup = semantic?.group;
    const cluster = semanticGroup ? undefined : clusters.find(({ box: clusterBox }) => box.cx >= clusterBox.left && box.cx <= clusterBox.right && box.cy >= clusterBox.top && box.cy <= clusterBox.bottom);
    const path = semanticGroup ? groupPath(analysis, semanticGroup) : cluster ? [cluster.label] : [];

    element.dataset.graphKey = key;
    if (semantic?.line != null) element.dataset.sourceLine = String(semantic.line);
    element.classList.add("atlas-node");
    element.setAttribute("tabindex", "0");
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", `${label}. Select to show attached nodes.`);
    const outlines = outlineElementsFor(element, box);
    outlines.forEach((outline) => outline.classList.add("atlas-outline"));
    const companions = companionsFor(element, key, kind, context);
    companions.forEach((companion) => companion.classList.add("atlas-companion"));

    nodes.set(key, {
      key,
      rawKey,
      domId: stripPrefix(element.id, svg.id),
      label,
      kind: semantic?.kind || "node",
      sourceLine: semantic?.line,
      aliases: semantic?.aliases || [],
      element,
      outlines,
      companions,
      box,
      groupKey: semanticGroup || cluster?.key,
      groupLabel: path.length ? path.join(" › ") : undefined,
      groupPath: path,
      groupOrder: semanticGroup ? analysis.groupsByKey.get(semanticGroup)?.line ?? Infinity : Infinity,
      connections: 0,
    });
  });

  return nodes;
}
