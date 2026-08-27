// Applies selection roles to the rendered SVG. Dimming is a single class on the
// <svg> root (`atlas-has-selection`) so selecting a node touches only its
// neighbourhood instead of every element in a large graph.
const ROLE_CLASSES = ["atlas-lit", "atlas-selected", "atlas-parent", "atlas-child", "atlas-bidirectional", "atlas-incoming", "atlas-outgoing", "atlas-preview"];

function markerId(reference) {
  return reference?.match(/url\(["']?#([^"')]+)["']?\)/)?.[1];
}

export function createHighlighter({ stage, colorRoot }) {
  let litElements = new Set();
  let previewElements = new Set();
  let colorCache = new Map();

  const roleColor = (role) => {
    if (!colorCache.has(role)) {
      const value = getComputedStyle(colorRoot).getPropertyValue(`--role-${role}`).trim();
      colorCache.set(role, value || "#dc684f");
    }
    return colorCache.get(role);
  };

  const markerForRole = (graph, reference, role) => {
    const sourceId = markerId(reference);
    if (!sourceId) return reference;
    const cacheKey = `${sourceId}:${role}`;
    if (graph.markerCache.has(cacheKey)) return `url(#${graph.markerCache.get(cacheKey)})`;
    const source = stage.querySelector(`#${CSS.escape(sourceId)}`);
    if (!source) return reference;
    const clone = source.cloneNode(true);
    const color = roleColor(role);
    const cloneId = `${sourceId}-atlas-${role}`;
    clone.id = cloneId;
    clone.style.color = color;
    clone.querySelectorAll("path, polygon, polyline, circle").forEach((shape) => {
      shape.setAttribute("fill", color);
      shape.setAttribute("stroke", color);
      shape.style.setProperty("fill", color, "important");
      shape.style.setProperty("stroke", color, "important");
    });
    source.parentNode.append(clone);
    graph.markerCache.set(cacheKey, cloneId);
    return `url(#${cloneId})`;
  };

  const light = (element, ...roles) => {
    if (!element) return;
    element.classList.add("atlas-lit", ...roles);
    litElements.add(element);
  };

  const outlineRoleColors = { "atlas-selected": "selected", "atlas-parent": "incoming", "atlas-child": "outgoing", "atlas-bidirectional": "both", "atlas-preview": "preview" };

  // Some diagrams (C4) paint shapes with inline `!important` strokes that no
  // stylesheet can beat, so the role stroke is also written inline.
  const paintOutlines = (node, role) => {
    const color = roleColor(outlineRoleColors[role]);
    const targets = [node.element, ...node.companions].flatMap((target) => (
      target.classList.contains("atlas-outline") ? [target] : [...target.querySelectorAll(".atlas-outline")]
    ));
    targets.forEach((outline) => {
      outline.style.setProperty("stroke", color, "important");
      litElements.add(outline);
    });
  };

  const lightNode = (node, role) => {
    [node.element, ...node.companions].forEach((element) => light(element, role));
    paintOutlines(node, role);
  };

  // Markers scale with stroke width, so a highlighted edge only grows relative
  // to its own width; a fixed 4px would turn ER crow's feet into blobs.
  const emphasizeStroke = (element) => {
    if (element.closest("g.link")) return; // sankey ribbons are stroked to their flow width
    const original = Number.parseFloat(getComputedStyle(element).strokeWidth) || 1;
    element.style.setProperty("stroke-width", `${Math.min(4, Math.max(2.25, original * 1.6))}px`, "important");
  };

  const setEdgeRole = (graph, edge, role) => {
    edge.elements.forEach((element) => {
      light(element, role);
      emphasizeStroke(element);
    });
    edge.labels.forEach((label) => light(label, role));
    edge.markers.forEach(({ element, start, end }) => {
      if (start) element.setAttribute("marker-start", markerForRole(graph, start, role === "atlas-incoming" ? "incoming" : role === "atlas-outgoing" ? "outgoing" : "preview"));
      if (end) element.setAttribute("marker-end", markerForRole(graph, end, role === "atlas-incoming" ? "incoming" : role === "atlas-outgoing" ? "outgoing" : "preview"));
    });
  };

  const restoreMarkers = (edge) => {
    edge.markers.forEach(({ element, start, end }) => {
      if (start) element.setAttribute("marker-start", start);
      if (end) element.setAttribute("marker-end", end);
    });
  };

  return {
    invalidateColors() {
      colorCache = new Map();
    },
    clear(graph) {
      litElements.forEach((element) => {
        element.classList.remove(...ROLE_CLASSES);
        element.style.removeProperty("stroke-width");
        element.style.removeProperty("stroke");
      });
      litElements = new Set();
      previewElements = new Set();
      graph?.edges.forEach(restoreMarkers);
      stage.querySelector("svg")?.classList.remove("atlas-has-selection");
    },
    // Lights the node, its neighbours and the connecting edges.
    select(graph, key) {
      this.clear(graph);
      const selected = graph.nodes.get(key);
      if (!selected) return;
      const parents = graph.incoming.get(key) || new Set();
      const children = graph.outgoing.get(key) || new Set();
      lightNode(selected, "atlas-selected");
      parents.forEach((parentKey) => {
        const parent = graph.nodes.get(parentKey);
        if (parent) lightNode(parent, children.has(parentKey) ? "atlas-bidirectional" : "atlas-parent");
      });
      children.forEach((childKey) => {
        const child = graph.nodes.get(childKey);
        if (child && !parents.has(childKey)) lightNode(child, "atlas-child");
      });
      graph.edges.forEach((edge) => {
        if (edge.to === key) setEdgeRole(graph, edge, "atlas-incoming");
        else if (edge.from === key) setEdgeRole(graph, edge, "atlas-outgoing");
      });
      stage.querySelector("svg")?.classList.add("atlas-has-selection");
    },
    preview(graph, key, edge) {
      this.clearPreview();
      const node = graph.nodes.get(key);
      if (!node) return;
      [node.element, ...node.companions].forEach((element) => {
        element.classList.add("atlas-lit", "atlas-preview");
        previewElements.add(element);
        litElements.add(element);
      });
      paintOutlines(node, "atlas-preview");
      if (edge) {
        [...edge.elements, ...edge.labels].forEach((element) => {
          element.classList.add("atlas-lit", "atlas-preview");
          previewElements.add(element);
          litElements.add(element);
        });
        edge.elements.forEach(emphasizeStroke);
      }
    },
    clearPreview() {
      previewElements.forEach((element) => {
        element.classList.remove("atlas-preview");
        const keepsRole = ["atlas-incoming", "atlas-outgoing", "atlas-selected", "atlas-parent", "atlas-child", "atlas-bidirectional"]
          .some((role) => element.classList.contains(role));
        if (keepsRole) return;
        element.style.removeProperty("stroke-width");
        element.querySelectorAll?.(".atlas-outline").forEach((outline) => outline.style.removeProperty("stroke"));
        if (element.classList.contains("atlas-outline")) element.style.removeProperty("stroke");
      });
      previewElements = new Set();
    },
  };
}
