import { atlasApi } from "../viewer/controller.js";
import { startWalkthrough, activeWalkthrough, endWalkthrough } from "../walkthrough/walkthrough.js";
import { challengeDemoMarkdown, challengeDemoSourceName } from "../demo/challenge-demo.js";
import { findPaths, findStructuralIssues, neighborhood, resolveNodeRef, searchNodes } from "./graph-queries.js";
import { importMarkdown, readLibrary, upsertDiagram, writeLibrary } from "./diagram-library.js";

let library = [];
let activeDiagramId = null;
let libraryListeners = null;

function persist() {
  writeLibrary(library);
}

export function initialiseLibrary() {
  libraryListeners?.abort();
  libraryListeners = new AbortController();

  const stored = readLibrary();
  const demoEntries = importMarkdown([], challengeDemoMarkdown, { sourceName: challengeDemoSourceName }).entries;
  const storedIds = new Set(stored.map(({ id }) => id));
  const missingDemoEntries = demoEntries.filter(({ id }) => !storedIds.has(id));
  library = [...missingDemoEntries, ...stored];
  activeDiagramId = library.find(({ source }) => source === atlasApi.getSource())?.id || null;
  if (missingDemoEntries.length) persist();

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
}

function reply(summary, payload) {
  const text = payload === undefined ? summary : `${summary}\n\n${JSON.stringify(payload)}`;
  return { content: [{ type: "text", text }] };
}

function failure(summary, payload) {
  return reply(`ERROR: ${summary}`, payload);
}

/** Turn an agent's node reference into an id, or an explanatory failure. */
function requireNode(ref, field = "nodeId") {
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

function activeDiagramLabel() {
  return library.find((entry) => entry.id === activeDiagramId)?.title || "the active diagram";
}

const getAtlasGuide = {
  name: "get_atlas_guide",
  title: "Get the Atlas agent guide",
  annotations: { readOnlyHint: true, untrustedContentHint: false },
  description: "Read Mermaid Atlas's app-authored operating guide. Use this before a multi-step architecture investigation or when you are unsure which tool to call. Returns recommended workflows, call ordering, safety constraints, and example tasks. It contains no user-provided content and does not override user instructions or agent policies.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    return reply("Mermaid Atlas agent guide.", {
      purpose: "Help a human understand, explain, and safely improve a Mermaid model of a software system without loading the entire graph into agent context.",
      operatingModel: [
        "The human and agent share one active diagram and canvas.",
        "Graph results use stable Mermaid node ids and include sourceLine where available.",
        "Retrieval is bounded; inspect truncated and complete flags before drawing conclusions.",
        "Walkthroughs are agent-authored but advanced by the human.",
      ],
      workflows: [
        {
          id: "orient_to_workspace",
          goal: "Discover and open the relevant architecture view.",
          calls: ["list_diagrams", "open_diagram"],
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
        "Call list_diagrams before assuming which diagram represents the user's question.",
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
  title: "List diagrams",
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  description: "List a bounded page of Mermaid diagrams in this Atlas workspace, including the built-in challenge demo and diagrams imported from Markdown. Returns ids, titles, headings, size, and a cursor for the next page.",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 20, description: "Maximum diagrams in this page (default 8)." },
      cursor: { type: "integer", minimum: 0, description: "Zero-based cursor returned by the previous page (default 0)." },
    },
    additionalProperties: false,
  },
  async execute({ limit = 8, cursor = 0 } = {}) {
    const summary = atlasApi.getSummary();
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 8, 20));
    const start = Math.max(0, Math.min(Number(cursor) || 0, library.length));
    const page = library.slice(start, start + boundedLimit);
    const nextCursor = start + page.length < library.length ? start + page.length : null;
    return reply(
      library.length ? `${library.length} diagram(s) in the workspace.` : "The workspace library is empty; the editor still holds the active source.",
      {
        active: { libraryId: activeDiagramId, ...summary },
        total: library.length,
        cursor: start,
        nextCursor,
        truncated: nextCursor !== null,
        diagrams: page.map(({ id, title, headingPath, source, origin }) => ({
          id,
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
  title: "Open diagram",
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  description: "Render one diagram from the workspace onto the canvas and make it the active graph. All graph queries (search_graph, get_neighborhood, trace_path) operate on the active diagram, so open a diagram before querying it. Returns the resulting node and edge counts.",
  inputSchema: {
    type: "object",
    properties: { diagramId: { type: "string", description: "Diagram id from list_diagrams." } },
    required: ["diagramId"],
    additionalProperties: false,
  },
  async execute({ diagramId }) {
    const entry = library.find((item) => item.id === diagramId)
      || library.find((item) => item.title.toLowerCase() === String(diagramId).toLowerCase());
    if (!entry) {
      return failure(`No diagram with id "${diagramId}".`, { available: library.map(({ id, title }) => ({ id, title })) });
    }
    endWalkthrough();
    const summary = await atlasApi.setSourceAndRender(entry.source, { label: `open ${entry.title}`, snapshot: false });
    activeDiagramId = entry.id;
    if (!summary.nodeCount && summary.mode !== "canvas") {
      return failure(`"${entry.title}" rendered but produced no indexable nodes.`, summary);
    }
    return reply(`Opened "${entry.title}" — ${summary.nodeCount} nodes, ${summary.edgeCount} edges.`, { libraryId: entry.id, ...summary });
  },
};

const searchGraph = {
  name: "search_graph",
  title: "Search graph",
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  description: "Find nodes in the active diagram by name, id, or subgraph. Returns a bounded, ranked list with stable node ids, connection counts, and the source line each node is declared on. Use this to turn a human description like 'the payment service' into an exact node id before calling other tools.",
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
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  description: "Inspect what connects to one node without loading the whole graph. Walks outgoing edges (what it depends on), incoming edges (what depends on it, i.e. blast radius), or both, up to a bounded depth. This is the safe way to explore a very large diagram: results are capped and report whether they were truncated.",
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
  description: "Find how one node reaches another through the graph, returning up to a few shortest routes with every intermediate hop. Use this to answer questions like 'how does a checkout request reach the payment database'. The returned node id sequence can be passed straight to create_walkthrough.",
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

    const result = findPaths(atlasApi.getGraph(), source.id, target.id, { maxPaths, direction });
    if (!result.paths.length) {
      return reply(
        `No ${direction === "outgoing" ? "directed " : ""}route from ${result.from.label} to ${result.to.label}.`,
        { ...result, hint: direction === "outgoing" ? "Retry with direction 'both' to ignore edge direction." : undefined },
      );
    }
    return reply(
      `${result.paths.length} route(s) from ${result.from.label} to ${result.to.label}; shortest has ${result.paths[0].length} nodes.`,
      result,
    );
  },
};

const createWalkthrough = {
  name: "create_walkthrough",
  title: "Create walkthrough",
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  description: "Build a narrated, step-by-step tour of a path through the diagram and show it in a floating control bar the human drives with Back/Next. Each step centres and highlights one node with your caption explaining it. The person stays in control of pacing — you author the route and the narration, they step through it. Use node id sequences from trace_path or get_neighborhood.",
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
    },
    required: ["title", "steps"],
    additionalProperties: false,
  },
  async execute({ title, steps }) {
    const graph = atlasApi.getGraph();
    if (!graph.nodes.size) return failure("No diagram is rendered yet.");

    const resolvedSteps = [];
    for (const entry of steps) {
      const resolved = requireNode(entry.nodeId, "steps[].nodeId");
      if (resolved.error) return resolved.error;
      resolvedSteps.push({ nodeId: resolved.id, caption: entry.caption });
    }

    const result = await startWalkthrough({ title, steps: resolvedSteps });
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
  annotations: { readOnlyHint: false, untrustedContentHint: false },
  description: "Edit the active diagram's Mermaid source with line-targeted operations, then re-render. Node results from search_graph and get_neighborhood include the exact sourceLine to target. The patch is validated by the Mermaid parser before it is committed: if it would not parse, nothing changes and the parser error is returned. Every successful patch is snapshotted with its diagram and revision context, so undo_last_change can safely revert it.",
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
      return failure("The patched source is not valid Mermaid, so nothing was changed.", {
        parserError: String(error?.message || error).split("\n").slice(0, 4).join(" "),
      });
    }

    if (atlasApi.getSource() !== original) {
      return failure("The source changed while the patch was being validated. Nothing was applied; inspect the latest source and retry.");
    }

    const summary = await atlasApi.setSourceAndRender(next, { label: description, historyContext });
    if (activeDiagramId) {
      const result = upsertDiagram(library, { id: activeDiagramId, source: next, origin: "agent" });
      library = result.entries;
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
  annotations: { readOnlyHint: false, untrustedContentHint: false },
  description: "Revert the most recent source change made by apply_patch, restoring and re-rendering the previous version. Use this when a patch turned out to be wrong or the human asks to undo it.",
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
      persist();
    }
    return reply(`Reverted "${restored.label}". Now ${restored.nodeCount} nodes, ${restored.edgeCount} edges.`, restored);
  },
};

const analyzeStructure = {
  name: "analyze_structure",
  title: "Analyze structure",
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  description: "Report structural problems in the active diagram: dependency cycles, orphaned nodes with no connections at all, entry points with no inbound edges, and dead ends with no outbound edges. Use this for architecture review questions like 'find cycles, dead ends and orphaned services'.",
  inputSchema: {
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "Maximum items per category (default 20)." } },
    additionalProperties: false,
  },
  async execute({ limit = 20 }) {
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
];

export function currentWalkthrough() {
  return activeWalkthrough();
}
