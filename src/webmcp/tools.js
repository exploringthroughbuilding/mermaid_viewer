import { atlasApi } from "../viewer/controller.js";
import { startWalkthrough, activeWalkthrough, endWalkthrough } from "../walkthrough/walkthrough.js";
import { challengeDemoMarkdown, challengeDemoSourceName } from "../demo/challenge-demo.js";
import { findPaths, findStructuralIssues, neighborhood, resolveNodeRef, searchNodes } from "./graph-queries.js";
import { importMarkdown, readLibrary, upsertDiagram, writeLibrary } from "./diagram-library.js";

let library = [];
let activeDiagramId = null;
let renderedDiagramId = null;
let libraryListeners = null;
let disposeRenderListener = null;

const toolOutputSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean", description: "Whether the tool completed successfully." },
    summary: { type: "string", description: "Concise human-readable outcome." },
    data: { type: "object", description: "Machine-readable result payload." },
    error: {
      type: "object",
      properties: {
        message: { type: "string" },
        details: { type: "object" },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
  required: ["ok", "summary", "data"],
  additionalProperties: false,
};

function persist() {
  writeLibrary(library);
}

export function initialiseLibrary() {
  libraryListeners?.abort();
  disposeRenderListener?.();
  libraryListeners = new AbortController();

  const stored = readLibrary();
  const demoEntries = importMarkdown([], challengeDemoMarkdown, { sourceName: challengeDemoSourceName }).entries;
  const storedIds = new Set(stored.map(({ id }) => id));
  const missingDemoEntries = demoEntries.filter(({ id }) => !storedIds.has(id));
  library = [...missingDemoEntries, ...stored];
  activeDiagramId = library.find(({ source }) => source === atlasApi.getSource())?.id || null;
  renderedDiagramId = library.find(({ source }) => source === atlasApi.getRenderedSource())?.id || null;
  if (missingDemoEntries.length) persist();

  disposeRenderListener = atlasApi.onRender(() => {
    const source = atlasApi.getRenderedSource();
    renderedDiagramId = library.find(({ id, source: candidate }) => id === activeDiagramId && candidate === source)?.id
      || library.find((entry) => entry.source === source)?.id
      || null;
  });

  window.addEventListener("atlas-file-imported", (event) => {
    const { text, name } = event.detail || {};
    const result = importMarkdown(library, text, { sourceName: name?.replace(/\.[^.]+$/, "") || "import" });
    if (!result.imported.length) return;
    library = result.entries;
    activeDiagramId = result.imported[0].id;
    persist();
    window.dispatchEvent(new CustomEvent("atlas-library-imported", {
      detail: { diagramIds: result.imported.map(({ id }) => id), activeDiagramId },
    }));
  }, { signal: libraryListeners.signal });
  window.addEventListener("atlas-active-source-change", (event) => {
    const source = String(event.detail?.source || "");
    const diagramId = event.detail?.diagramId;
    activeDiagramId = library.some((entry) => entry.id === diagramId)
      ? diagramId
      : library.find((entry) => entry.source === source)?.id || null;
  }, { signal: libraryListeners.signal });
  return library;
}

export function disposeLibrary() {
  libraryListeners?.abort();
  libraryListeners = null;
  disposeRenderListener?.();
  disposeRenderListener = null;
}

function reply(summary, payload) {
  const text = payload === undefined ? summary : `${summary}\n\n${JSON.stringify(payload)}`;
  return {
    content: [{ type: "text", text }],
    structuredContent: { ok: true, summary, data: payload ?? {} },
  };
}

function failure(summary, payload) {
  const text = payload === undefined ? `ERROR: ${summary}` : `ERROR: ${summary}\n\n${JSON.stringify(payload)}`;
  return {
    content: [{ type: "text", text }],
    structuredContent: {
      ok: false,
      summary,
      data: {},
      error: { message: summary, ...(payload === undefined ? {} : { details: payload }) },
    },
    isError: true,
  };
}

function requireRenderedCanvas() {
  if (atlasApi.getSource() === atlasApi.getRenderedSource()) return null;
  return failure(
    "The editor contains source that has not finished rendering, so graph results may be stale.",
    { suggestedAction: "Render the editor source, wait for the canvas to finish, then retry this tool." },
  );
}

/** Turn an agent's node reference into an id, or an explanatory failure. */
function requireNode(ref, field = "nodeId") {
  const stale = requireRenderedCanvas();
  if (stale) return { error: stale };
  const graph = atlasApi.getGraph();
  if (!graph.nodes.size) return { error: failure("No diagram is rendered yet. Call open_diagram or render source first.") };
  const resolved = resolveNodeRef(graph, ref);
  if (resolved.ok) return { id: resolved.id };
  if (resolved.reason === "ambiguous") {
    return { error: failure(`"${ref}" matches several nodes; pass an exact id from the candidates.`, { field, candidates: resolved.candidates }) };
  }
  const nearby = searchNodes(graph, ref, 5).results;
  return { error: failure(`No node matches "${ref}".`, { field, didYouMean: nearby }) };
}

function activeCanvasState() {
  const editorSource = atlasApi.getSource();
  const renderedSource = atlasApi.getRenderedSource();
  const identityFor = (source, preferredId) => {
    const preferred = library.find((candidate) => candidate.id === preferredId && candidate.source === source);
    return preferred || library.find((entry) => entry.source === source);
  };
  const entry = identityFor(renderedSource, renderedDiagramId);
  const editorEntry = identityFor(editorSource, activeDiagramId);
  return {
    kind: entry ? "library" : "editor",
    libraryId: entry?.id ?? null,
    libraryTitle: entry?.title ?? null,
    editorIsRendered: editorSource === renderedSource,
    editor: {
      kind: editorEntry ? "library" : "editor",
      libraryId: editorEntry?.id ?? null,
      libraryTitle: editorEntry?.title ?? null,
    },
    ...atlasApi.getSummary(),
  };
}

function activeDiagramLabel() {
  return activeCanvasState().libraryTitle || "the current editor canvas";
}

const getAtlasGuide = {
  name: "get_atlas_guide",
  title: "Get the Atlas agent guide",
  annotations: { readOnlyHint: true, untrustedContentHint: false },
  description: "Use only when you need help choosing or sequencing Atlas tools for a multi-step task. Returns app-authored workflows and safety rules; it does not inspect the diagram, change the canvas, or contain user-provided instructions. Skip it when one specific tool clearly answers the request.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    return reply("Mermaid Atlas agent guide.", {
      purpose: "Help a human understand, explain, and safely improve a Mermaid model of a software system without loading the entire graph into agent context.",
      operatingModel: [
        "The human and agent share one current canvas. It may be a saved library diagram or unsaved editor source.",
        "Graph results use stable Mermaid node ids and include sourceLine where available.",
        "Retrieval is bounded; inspect truncated and complete flags before drawing conclusions.",
        "Walkthroughs are agent-authored but advanced by the human.",
      ],
      workflows: [
        {
          id: "orient_to_workspace",
          goal: "Discover and open the relevant architecture view.",
          calls: ["list_diagrams", "open_diagram only when the requested library diagram is not already active"],
        },
        {
          id: "explain_component",
          goal: "Resolve a component and explain its local dependencies and dependents.",
          calls: ["search_graph", "get_neighborhood"],
        },
        {
          id: "trace_request",
          goal: "Explain how a request, event, or dependency travels between two components.",
          calls: ["search_graph", "trace_path", "create_walkthrough"],
        },
        {
          id: "assess_change_impact",
          goal: "Estimate blast radius before changing a component.",
          calls: ["search_graph", "get_neighborhood"],
          options: { direction: "incoming" },
        },
        {
          id: "review_architecture",
          goal: "Find cycles, orphans, entry points, and dead ends, then inspect important findings.",
          calls: ["analyze_structure", "get_neighborhood"],
        },
        {
          id: "improve_documentation",
          goal: "Make a requested source change, validate it, and retain a safe recovery path.",
          calls: ["search_graph", "apply_patch", "undo_last_change"],
        },
      ],
      guidelines: [
        "If the user refers to the visible or current diagram, query it directly; do not call open_diagram.",
        "Call list_diagrams when the relevant diagram is unclear or the user asks about another saved diagram.",
        "A successful open_diagram call guarantees active.editorIsRendered=true; if rendering is interrupted or fails, it returns an error instead.",
        "Treat active.kind=editor as authoritative: it means the canvas does not exactly match a saved library entry.",
        "If active.editorIsRendered is false, wait for or request a render before using graph query or editing tools.",
        "Use search_graph to resolve natural-language names; do not guess an ambiguous node id.",
        "Use outgoing neighborhood edges for dependencies and incoming edges for dependents or blast radius.",
        "Prefer trace_path for end-to-end explanations and pass its node sequence to create_walkthrough.",
        "Do not call apply_patch for a read-only explanation or review request.",
        "Before applying a patch, use returned sourceLine values and describe the intended human-visible change.",
        "If a result is truncated or a path search is incomplete, say so and narrow the question rather than presenting it as exhaustive.",
        "Use undo_last_change when the human rejects the latest agent patch; it will refuse to overwrite newer human edits.",
      ],
      exampleTasks: [
        "Find the payment service and show what depends on it within two hops.",
        "Trace the shortest path from API Gateway to Payment Postgres and create a walkthrough.",
        "Review this diagram for cycles, isolated services, and suspicious dead ends.",
        "Explain the blast radius of changing Inventory Service without editing the source.",
      ],
    });
  },
};

const listDiagrams = {
  name: "list_diagrams",
  title: "List saved diagrams and canvas state",
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  description: "Use to discover saved diagrams or check current state. This does not change anything. active describes the rendered canvas; active.editor describes the editor source; active.editorIsRendered says whether graph queries reflect that source. kind='library' includes an exact saved id, while kind='editor' means custom/modified source. Do not call open_diagram merely to inspect the current canvas.",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 20, description: "Maximum diagrams in this page (default 8)." },
      cursor: { type: "integer", minimum: 0, description: "Zero-based cursor returned by the previous page (default 0)." },
    },
    additionalProperties: false,
  },
  async execute({ limit = 8, cursor = 0 } = {}) {
    const active = activeCanvasState();
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 8, 20));
    const start = Math.max(0, Math.min(Number(cursor) || 0, library.length));
    const page = library.slice(start, start + boundedLimit);
    const nextCursor = start + page.length < library.length ? start + page.length : null;
    return reply(
      library.length ? `${library.length} diagram(s) in the workspace.` : "The workspace library is empty; the editor still holds the active source.",
      {
        active,
        total: library.length,
        cursor: start,
        nextCursor,
        truncated: nextCursor !== null,
        diagrams: page.map(({ id, title, headingPath, source, origin }) => ({
          id,
          isActive: id === active.libraryId,
          title: title.slice(0, 120),
          headingPath: headingPath.slice(-6).map((heading) => String(heading).slice(0, 80)),
          origin: String(origin).slice(0, 80),
          lines: source.split("\n").length,
          declaration: source.split("\n").find((line) => line.trim())?.trim().slice(0, 60) ?? "",
        })),
      },
    );
  },
};

const openDiagram = {
  name: "open_diagram",
  title: "Switch to a saved diagram",
  annotations: {
    readOnlyHint: false, destructiveHint: true, idempotentHint: true, untrustedContentHint: true,
  },
  description: "Use only to replace the current canvas with a different saved diagram chosen from list_diagrams. This changes editor/canvas state and closes any walkthrough. It refuses to overwrite unrendered editor changes unless explicitly authorized. Do not call when the user means the current canvas; graph query tools already operate on it. Returns both previous and new identities, and reports success only after the exact editor source is rendered (active.editorIsRendered=true).",
  inputSchema: {
    type: "object",
    properties: {
      diagramId: { type: "string", description: "Diagram id from list_diagrams." },
      discardUnrenderedEditorChanges: {
        type: "boolean",
        description: "Set true only with user authorization to replace editor source that has not been rendered (default false).",
      },
    },
    required: ["diagramId"],
    additionalProperties: false,
  },
  async execute({ diagramId, discardUnrenderedEditorChanges = false }) {
    const previous = activeCanvasState();
    const entry = library.find((item) => item.id === diagramId)
      || library.find((item) => item.title.toLowerCase() === String(diagramId).toLowerCase());
    if (!entry) {
      return failure(`No diagram with id "${diagramId}".`, { available: library.map(({ id, title }) => ({ id, title })) });
    }
    if (!previous.editorIsRendered && previous.editor.kind === "editor" && !discardUnrenderedEditorChanges) {
      return failure("The editor has unrendered changes, so switching diagrams was stopped to avoid overwriting them.", {
        active: previous,
        suggestedAction: "Render or preserve the editor changes first. Retry with discardUnrenderedEditorChanges=true only if the user wants to discard them.",
      });
    }
    if (previous.libraryId === entry.id && previous.editorIsRendered) {
      return reply(`"${entry.title}" is already the current canvas; nothing changed.`, {
        changed: false,
        previous,
        active: previous,
        libraryId: entry.id,
        ...atlasApi.getSummary(),
      });
    }
    endWalkthrough();
    const summary = await atlasApi.setSourceAndRender(entry.source, { label: `open ${entry.title}`, snapshot: false });
    activeDiagramId = entry.id;
    renderedDiagramId = entry.id;
    if (!summary.renderOk || atlasApi.getSource() !== atlasApi.getRenderedSource()) {
      return failure(`"${entry.title}" did not finish rendering, so it was not opened successfully.`, {
        ...summary,
        active: activeCanvasState(),
        suggestedAction: "Retry open_diagram after any current render finishes. If it fails again, inspect the Mermaid source.",
      });
    }
    if (!summary.nodeCount && summary.mode !== "canvas") {
      return failure(`"${entry.title}" rendered but produced no indexable nodes.`, summary);
    }
    return reply(`Switched the canvas to "${entry.title}" — ${summary.nodeCount} nodes, ${summary.edgeCount} edges.`, {
      changed: true,
      previous,
      active: activeCanvasState(),
      libraryId: entry.id,
      ...summary,
    });
  },
};

const searchGraph = {
  name: "search_graph",
  title: "Search graph",
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  description: "Use first when a node id is unknown or a human names a component naturally. Searches only the current visible canvas and does not change it. Returns ranked exact node ids and source lines for get_neighborhood, trace_path, create_walkthrough, or apply_patch. Do not use to search saved diagram titles; use list_diagrams for that.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free text matched against node labels, ids, and subgroup names." },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Maximum results (default 20)." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute({ query, limit }) {
    const stale = requireRenderedCanvas();
    if (stale) return stale;
    const graph = atlasApi.getGraph();
    if (!graph.nodes.size) return failure("No diagram is rendered yet.");
    const result = searchNodes(graph, query, limit);
    if (!result.total) return reply(`No nodes match "${query}" in ${activeDiagramLabel()}.`, { results: [] });
    return reply(
      `${result.total} match(es) for "${query}"${result.truncated ? `, showing ${result.results.length}` : ""}.`,
      result,
    );
  },
};

const getNeighborhood = {
  name: "get_neighborhood",
  title: "Inspect neighborhood",
  annotations: {
    readOnlyHint: false, destructiveHint: false, idempotentHint: true, untrustedContentHint: true,
  },
  description: "Use for local dependencies, dependents, or blast radius around one node on the current canvas. outgoing means dependencies; incoming means dependents/blast radius. It selects the root node visually but never edits Mermaid source. For a route between two known endpoints use trace_path instead.",
  inputSchema: {
    type: "object",
    properties: {
      nodeId: { type: "string", description: "Node id or label. Get exact ids from search_graph." },
      direction: { type: "string", enum: ["incoming", "outgoing", "both"], description: "outgoing = dependencies, incoming = dependents/blast radius. Default both." },
      depth: { type: "integer", minimum: 1, maximum: 6, description: "How many hops to expand (default 1)." },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Maximum nodes returned (default 40)." },
    },
    required: ["nodeId"],
    additionalProperties: false,
  },
  async execute({ nodeId, direction = "both", depth = 1, limit = 40 }) {
    const resolved = requireNode(nodeId);
    if (resolved.error) return resolved.error;
    const result = neighborhood(atlasApi.getGraph(), resolved.id, { direction, depth, limit });
    const reached = result.levels.reduce((total, level) => total + level.nodes.length, 0);
    atlasApi.selectNode(resolved.id);
    return reply(
      `${result.root.label}: ${reached} node(s) within ${depth} hop(s) ${direction}${result.truncated ? " (truncated)" : ""}.`,
      result,
    );
  },
};

const tracePath = {
  name: "trace_path",
  title: "Trace path",
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  description: "Use only for an end-to-end route between two nodes on the current canvas. Returns shortest routes and every intermediate hop without changing source or selection. Resolve uncertain endpoints with search_graph first. Pass one returned nodes sequence to create_walkthrough; use get_neighborhood instead for one-node impact analysis.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Starting node id or label." },
      to: { type: "string", description: "Destination node id or label." },
      direction: { type: "string", enum: ["outgoing", "both"], description: "outgoing follows edge direction (default); both ignores direction." },
      maxPaths: { type: "integer", minimum: 1, maximum: 5, description: "How many routes to return (default 3)." },
    },
    required: ["from", "to"],
    additionalProperties: false,
  },
  async execute({ from, to, direction = "outgoing", maxPaths = 3 }) {
    const source = requireNode(from, "from");
    if (source.error) return source.error;
    const target = requireNode(to, "to");
    if (target.error) return target.error;
    if (source.id === target.id) return failure("`from` and `to` resolve to the same node.");

    const graph = atlasApi.getGraph();
    const result = findPaths(graph, source.id, target.id, { maxPaths, direction });
    const untraversableEdges = graph.untraversableEdges || [];
    if (!result.paths.length) {
      return reply(
        `No ${direction === "outgoing" ? "directed " : ""}route from ${result.from.label} to ${result.to.label}.`,
        {
          ...result,
          untraversableEdges,
          ...(untraversableEdges.length
            ? { hint: "One or more Mermaid edges target a subgraph container and cannot be traversed. Rewrite each reported endpoint to an explicit node, then retry." }
            : direction === "outgoing" ? { hint: "Retry with direction 'both' to ignore edge direction." } : {}),
        },
      );
    }
    return reply(
      `${result.paths.length} route(s) from ${result.from.label} to ${result.to.label}; shortest has ${result.paths[0].length} nodes.`,
      {
        ...result,
        ...(untraversableEdges.length ? {
          untraversableEdges,
          warning: "Some source edges target subgraph containers and were excluded from traversal.",
        } : {}),
      },
    );
  },
};

const createWalkthrough = {
  name: "create_walkthrough",
  title: "Create walkthrough",
  annotations: {
    readOnlyHint: false, destructiveHint: false, idempotentHint: false, untrustedContentHint: true,
  },
  description: "Use after finding an ordered route to show a human-driven Back/Next tour on the current canvas. This changes only walkthrough UI, never Mermaid source. Prefer a node sequence returned by trace_path. Connected steps are required by default; set requireConnected=false only for an intentional conceptual tour with jumps.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title for the tour, e.g. 'Checkout request to payment database'." },
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 24,
        description: "Ordered steps. Consecutive nodes should be connected for the edge highlight to appear.",
        items: {
          type: "object",
          properties: {
            nodeId: { type: "string", description: "Exact node id." },
            caption: { type: "string", description: "One or two sentences explaining what happens at this node and why the next hop follows." },
          },
          required: ["nodeId", "caption"],
          additionalProperties: false,
        },
      },
      requireConnected: {
        type: "boolean",
        description: "Reject the tour if any consecutive nodes lack a graph edge (default true). Set false only for intentional jumps.",
      },
    },
    required: ["title", "steps"],
    additionalProperties: false,
  },
  async execute({ title, steps, requireConnected = true }) {
    const stale = requireRenderedCanvas();
    if (stale) return stale;
    const graph = atlasApi.getGraph();
    if (!graph.nodes.size) return failure("No diagram is rendered yet.");

    const resolvedSteps = [];
    for (const entry of steps) {
      const resolved = requireNode(entry.nodeId, "steps[].nodeId");
      if (resolved.error) return resolved.error;
      resolvedSteps.push({ nodeId: resolved.id, caption: entry.caption });
    }

    const result = await startWalkthrough({ title, steps: resolvedSteps, requireConnected });
    if (!result.ok) return failure(`Could not start the walkthrough (${result.reason}).`, result);
    return reply(
      `Walkthrough "${title}" is live with ${result.total} steps. The human can step through it with the bar at the bottom of the canvas.`,
      {
        total: result.total,
        disconnectedSteps: result.disconnectedSteps,
        note: result.disconnectedSteps.length
          ? "Some consecutive steps are not directly connected, so no edge is highlighted between them."
          : undefined,
      },
    );
  },
};

const applyPatch = {
  name: "apply_patch",
  title: "Apply diagram patch",
  annotations: {
    readOnlyHint: false, destructiveHint: true, idempotentHint: false, untrustedContentHint: true,
  },
  description: "Use only when the user asks to modify Mermaid source on the current canvas. Applies exact line/text operations, validates before commit, and re-renders; invalid patches change nothing. This is not needed for explanations, reviews, selection, or walkthroughs. Use sourceLine from graph results and keep patches small. A successful patch can be reverted with undo_last_change.",
  inputSchema: {
    type: "object",
    properties: {
      operations: {
        type: "array",
        minItems: 1,
        maxItems: 40,
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["insert_after_line", "replace_line", "delete_line", "replace_text"] },
            line: { type: "integer", minimum: 0, description: "Zero-based source line, as returned in a node's sourceLine. Required for line operations." },
            text: { type: "string", description: "Replacement or inserted text. Required except for delete_line." },
            find: { type: "string", description: "Exact text to replace, for replace_text." },
          },
          required: ["type"],
          additionalProperties: false,
        },
      },
      description: { type: "string", description: "Short human-readable summary of the change, shown in the activity log." },
    },
    required: ["operations"],
    additionalProperties: false,
  },
  async execute({ operations, description = "agent patch" }) {
    const stale = requireRenderedCanvas();
    if (stale) return stale;
    const original = atlasApi.getSource();
    const historyContext = activeDiagramId || "editor";
    let lines = original.split("\n");

    // Line operations are applied on descending line numbers so that earlier
    // edits cannot shift the targets of later ones.
    const lineOps = operations.filter((operation) => operation.type !== "replace_text");
    const textOps = operations.filter((operation) => operation.type === "replace_text");

    const targetedLines = new Set();
    for (const operation of lineOps) {
      if (!Number.isInteger(operation.line)) return failure(`Operation "${operation.type}" requires a "line".`, { operation });
      if (operation.line < 0 || operation.line >= lines.length) {
        return failure(`Line ${operation.line} is out of range; the source has ${lines.length} lines.`, { operation });
      }
      if (targetedLines.has(operation.line)) {
        return failure(`Several line operations target line ${operation.line}. Split them into separate patches so their order is unambiguous.`, { operation });
      }
      targetedLines.add(operation.line);
      if (operation.type !== "delete_line" && typeof operation.text !== "string") {
        return failure(`Operation "${operation.type}" requires "text".`, { operation });
      }
    }

    for (const operation of [...lineOps].sort((first, second) => second.line - first.line)) {
      if (operation.type === "insert_after_line") lines.splice(operation.line + 1, 0, operation.text);
      else if (operation.type === "replace_line") lines[operation.line] = operation.text;
      else if (operation.type === "delete_line") lines.splice(operation.line, 1);
    }

    let next = lines.join("\n");
    for (const operation of textOps) {
      if (typeof operation.find !== "string" || typeof operation.text !== "string") {
        return failure('Operation "replace_text" requires both "find" and "text".', { operation });
      }
      if (!operation.find) return failure('Operation "replace_text" requires a non-empty "find" value.', { operation });
      if (!next.includes(operation.find)) return failure(`Could not find "${operation.find}" in the source.`, { operation });
      next = next.split(operation.find).join(operation.text);
    }

    if (next === original) return reply("The patch produced no change to the source.");

    try {
      await atlasApi.validateSource(next);
    } catch (error) {
      const parserError = String(error?.message || error);
      const oneBasedLine = Number(parserError.match(/line\s+(\d+)/i)?.[1]);
      const sourceLines = next.split("\n");
      const sourceLine = Number.isInteger(oneBasedLine) && oneBasedLine > 0 ? oneBasedLine - 1 : null;
      const excerptStart = sourceLine == null ? 0 : Math.max(0, sourceLine - 1);
      return failure("The patched source is not valid Mermaid, so nothing was changed.", {
        parserError: parserError.split("\n").slice(0, 4).join(" "),
        sourceLine,
        sourceExcerpt: sourceLines.slice(excerptStart, excerptStart + 3).map((text, index) => ({
          line: excerptStart + index,
          text,
        })),
        suggestedAction: sourceLine == null
          ? "Retry with a smaller operation and preserve the diagram declaration on the first non-comment line."
          : `Inspect zero-based line ${sourceLine}; retry with a smaller replace_line or replace_text operation around that line.`,
      });
    }

    if (atlasApi.getSource() !== original) {
      return failure("The source changed while the patch was being validated. Nothing was applied; inspect the latest source and retry.");
    }

    const summary = await atlasApi.setSourceAndRender(next, { label: description, historyContext });
    if (!summary.renderOk || atlasApi.getSource() !== next || atlasApi.getRenderedSource() !== next) {
      return failure("The source changed, but the patched diagram did not finish rendering in a stable state.", {
        ...summary,
        sourceStillMatchesPatch: atlasApi.getSource() === next,
        suggestedAction: "Inspect the editor and retry after the current render finishes. If the patch is still present and unwanted, call undo_last_change.",
      });
    }
    if (activeDiagramId) {
      const result = upsertDiagram(library, { id: activeDiagramId, source: next, origin: "agent" });
      library = result.entries;
      renderedDiagramId = activeDiagramId;
      persist();
    }
    return reply(
      `Applied ${operations.length} operation(s): ${description}. Now ${summary.nodeCount} nodes, ${summary.edgeCount} edges. Call undo_last_change to revert.`,
      summary,
    );
  },
};

const undoLastChange = {
  name: "undo_last_change",
  title: "Undo last agent change",
  annotations: {
    readOnlyHint: false, destructiveHint: true, idempotentHint: false, untrustedContentHint: true,
  },
  description: "Use only to revert the latest successful apply_patch on the current diagram, typically when the user rejects it or asks to undo it. It never undoes human edits or open_diagram switches, and refuses if the source changed after the patch.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    const historyContext = activeDiagramId || "editor";
    if (!atlasApi.historyDepth(historyContext)) return failure("There is no agent change to undo for this diagram.");
    const restored = await atlasApi.undoSourceChange({ historyContext });
    if (!restored) return failure("There is no agent change to undo.");
    if (!restored.ok) return failure(restored.message, { reason: restored.reason, patch: restored.label });
    if (activeDiagramId) {
      const result = upsertDiagram(library, { id: activeDiagramId, source: atlasApi.getSource(), origin: "agent" });
      library = result.entries;
      renderedDiagramId = activeDiagramId;
      persist();
    }
    return reply(`Reverted "${restored.label}". Now ${restored.nodeCount} nodes, ${restored.edgeCount} edges.`, restored);
  },
};

const analyzeStructure = {
  name: "analyze_structure",
  title: "Analyze structure",
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  description: "Use for a whole-current-canvas structural audit: cycles, orphans, entry points, and dead ends. It does not change canvas or source. Do not use for a named component's local dependencies (get_neighborhood) or a route between endpoints (trace_path).",
  inputSchema: {
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "Maximum items per category (default 20)." } },
    additionalProperties: false,
  },
  async execute({ limit = 20 }) {
    const stale = requireRenderedCanvas();
    if (stale) return stale;
    const graph = atlasApi.getGraph();
    if (!graph.nodes.size) return failure("No diagram is rendered yet.");
    const issues = findStructuralIssues(graph, limit);
    return reply(
      `${issues.cycles.length} cycle(s), ${issues.orphans.length} orphan(s), ${issues.sources.length} entry point(s), ${issues.sinks.length} dead end(s).`,
      issues,
    );
  },
};

export const tools = [
  getAtlasGuide,
  listDiagrams,
  openDiagram,
  searchGraph,
  getNeighborhood,
  tracePath,
  createWalkthrough,
  applyPatch,
  undoLastChange,
  analyzeStructure,
].map((tool) => ({
  ...tool,
  outputSchema: toolOutputSchema,
  annotations: { openWorldHint: false, ...tool.annotations },
}));

export function currentWalkthrough() {
  return activeWalkthrough();
}
