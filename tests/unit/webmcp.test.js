import { describe, expect, it } from "vitest";
import {
  hasMermaidBlocks,
  importMarkdown,
  parseMarkdownDiagrams,
  slugify,
  upsertDiagram,
} from "../../src/webmcp/diagram-library.js";
import {
  findPaths,
  findStructuralIssues,
  neighborhood,
  resolveNodeRef,
  searchNodes,
} from "../../src/webmcp/graph-queries.js";

const fence = "```";

function graphOf(edges, labels = {}, groups = {}) {
  const nodes = new Map();
  const incoming = new Map();
  const outgoing = new Map();
  const touch = (id) => {
    if (!nodes.has(id)) {
      nodes.set(id, { key: id, label: labels[id] || id, groupLabel: groups[id] ?? null, sourceLine: 1, connections: 0 });
    }
    if (!incoming.has(id)) incoming.set(id, new Set());
    if (!outgoing.has(id)) outgoing.set(id, new Set());
  };
  edges.forEach(([from, to]) => {
    touch(from);
    touch(to);
    outgoing.get(from).add(to);
    incoming.get(to).add(from);
  });
  nodes.forEach((node, id) => {
    node.connections = new Set([...incoming.get(id), ...outgoing.get(id)]).size;
  });
  return { nodes, edges: edges.map(([from, to]) => ({ from, to })), incoming, outgoing };
}

const checkout = graphOf(
  [
    ["Web", "Gateway"], ["Mobile", "Gateway"], ["Gateway", "Checkout"],
    ["Checkout", "Payment"], ["Payment", "PaymentDB"], ["Checkout", "Inventory"],
    ["Inventory", "InventoryDB"], ["Payment", "Ledger"], ["Ledger", "PaymentDB"],
  ],
  { Gateway: "API Gateway", Payment: "Payment Service", PaymentDB: "Payment Database" },
  { Payment: "Payments", PaymentDB: "Payments" },
);

describe("markdown diagram library", () => {
  const markdown = [
    "# Platform",
    "",
    "## Service Map",
    "",
    `${fence}mermaid`,
    "flowchart LR",
    "  A --> B",
    fence,
    "",
    "## Flows",
    "",
    "### Checkout",
    "",
    `${fence}mermaid`,
    "sequenceDiagram",
    "  A->>B: hello",
    fence,
    "",
  ].join("\n");

  it("titles each block with its nearest heading and records the full path", () => {
    const diagrams = parseMarkdownDiagrams(markdown);
    expect(diagrams).toHaveLength(2);
    expect(diagrams[0].title).toBe("Service Map");
    expect(diagrams[0].headingPath).toEqual(["Platform", "Service Map"]);
    expect(diagrams[1].title).toBe("Checkout");
    expect(diagrams[1].headingPath).toEqual(["Platform", "Flows", "Checkout"]);
    expect(diagrams[1].source).toBe("sequenceDiagram\n  A->>B: hello");
  });

  it("falls back to the diagram declaration when no heading precedes a block", () => {
    const [diagram] = parseMarkdownDiagrams(`${fence}mermaid\nflowchart TD\n  X --> Y\n${fence}`);
    expect(diagram.title).toBe("flowchart TD 1");
    expect(diagram.headingPath).toEqual([]);
  });

  it("ignores non-mermaid fences and empty blocks", () => {
    const mixed = [
      `${fence}js`,
      "const a = 1;",
      fence,
      `${fence}mermaid`,
      fence,
    ].join("\n");
    expect(parseMarkdownDiagrams(mixed)).toHaveLength(0);
    expect(hasMermaidBlocks(mixed)).toBe(true);
    expect(hasMermaidBlocks("# Just prose")).toBe(false);
  });

  it("handles indented fences inside list items", () => {
    const nested = ["- item", "", `  ${fence}mermaid`, "  flowchart LR", "    A --> B", `  ${fence}`].join("\n");
    expect(parseMarkdownDiagrams(nested)).toHaveLength(1);
  });

  it("assigns unique ids across repeated headings", () => {
    const repeated = `## Map\n\n${fence}mermaid\nflowchart LR\n A-->B\n${fence}\n\n## Map\n\n${fence}mermaid\nflowchart LR\n C-->D\n${fence}`;
    const { entries } = importMarkdown([], repeated, { sourceName: "doc" });
    expect(entries.map((entry) => entry.id)).toEqual(["doc-map", "doc-map-2"]);
  });

  it("updates an existing diagram in place rather than forking it", () => {
    const { entries } = importMarkdown([], markdown, { sourceName: "doc" });
    const target = entries[0].id;
    const updated = upsertDiagram(entries, { id: target, source: "flowchart TD\n  Z --> Q" });
    expect(updated.created).toBe(false);
    expect(updated.entries).toHaveLength(entries.length);
    expect(updated.entries.find((entry) => entry.id === target).source).toContain("Z --> Q");
  });

  it("slugifies titles safely", () => {
    expect(slugify("API Gateway / Edge!")).toBe("api-gateway-edge");
    expect(slugify("!!!")).toBe("diagram");
  });
});

describe("bounded graph queries", () => {
  it("resolves a node by id, by label, and by unique fragment", () => {
    expect(resolveNodeRef(checkout, "Gateway")).toEqual({ ok: true, id: "Gateway" });
    expect(resolveNodeRef(checkout, "API Gateway")).toEqual({ ok: true, id: "Gateway" });
    expect(resolveNodeRef(checkout, "ledger")).toEqual({ ok: true, id: "Ledger" });
  });

  it("reports ambiguity instead of guessing", () => {
    const result = resolveNodeRef(checkout, "inventory");
    expect(result.ok).toBe(true); // exact id match wins over the substring collision
    const ambiguous = resolveNodeRef(checkout, "DB");
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.reason).toBe("ambiguous");
    expect(ambiguous.candidates.length).toBeGreaterThan(1);
  });

  it("reports a missing node without throwing", () => {
    expect(resolveNodeRef(checkout, "Nope").reason).toBe("not_found");
    expect(resolveNodeRef(checkout, "").reason).toBe("empty");
  });

  it("ranks search results and honours the limit", () => {
    const result = searchNodes(checkout, "payment", 2);
    expect(result.results).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.results[0].id).toBe("Payment");

    const clipped = searchNodes(checkout, "payment", 1);
    expect(clipped.results).toHaveLength(1);
    expect(clipped.total).toBe(2);
    expect(clipped.truncated).toBe(true);
    expect(searchNodes(checkout, "Payments").results.map((entry) => entry.id)).toContain("PaymentDB");
  });

  it("matches natural-language spacing against camel-cased Mermaid ids", () => {
    const lifecycle = graphOf([["Validating", "AwaitingPayment"]]);
    expect(searchNodes(lifecycle, "awaiting payment").results[0]?.id).toBe("AwaitingPayment");
    expect(resolveNodeRef(lifecycle, "awaiting payment")).toEqual({ ok: true, id: "AwaitingPayment" });
  });

  it("expands a neighbourhood by direction and depth", () => {
    const out = neighborhood(checkout, "Checkout", { direction: "outgoing", depth: 2 });
    expect(out.levels[0].nodes.map((node) => node.id).sort()).toEqual(["Inventory", "Payment"]);
    expect(out.levels[1].nodes.map((node) => node.id).sort()).toEqual(["InventoryDB", "Ledger", "PaymentDB"]);
    expect(out.truncated).toBe(false);

    const dependents = neighborhood(checkout, "PaymentDB", { direction: "incoming", depth: 1 });
    expect(dependents.levels[0].nodes.map((node) => node.id).sort()).toEqual(["Ledger", "Payment"]);
  });

  it("caps the neighbourhood at the node budget and says so", () => {
    const capped = neighborhood(checkout, "Gateway", { direction: "both", depth: 6, limit: 3 });
    expect(capped.truncated).toBe(true);
    const returned = capped.levels.reduce((total, level) => total + level.nodes.length, 0);
    expect(returned).toBeLessThanOrEqual(3);
  });

  it("returns null for an unknown root", () => {
    expect(neighborhood(checkout, "Missing", {})).toBeNull();
    expect(findPaths(checkout, "Missing", "Gateway", {})).toBeNull();
  });

  it("finds shortest-first routes and every hop", () => {
    const result = findPaths(checkout, "Web", "PaymentDB", { maxPaths: 3 });
    expect(result.paths[0].nodes.map((node) => node.id)).toEqual(["Web", "Gateway", "Checkout", "Payment", "PaymentDB"]);
    expect(result.paths[0].steps).toHaveLength(4);
    expect(result.paths[1].nodes.map((node) => node.id)).toContain("Ledger");
    expect(result.complete).toBe(true);
  });

  it("returns no directed route when the direction forbids it", () => {
    expect(findPaths(checkout, "PaymentDB", "Web", { direction: "outgoing" }).paths).toHaveLength(0);
    expect(findPaths(checkout, "PaymentDB", "Web", { direction: "both" }).paths.length).toBeGreaterThan(0);
  });

  it("caps queued paths on dense graphs before memory grows without bound", () => {
    const nodeCount = 60;
    const edges = [];
    for (let from = 0; from < nodeCount - 1; from += 1) {
      for (let to = from + 1; to < nodeCount - 1; to += 1) edges.push([String(from), String(to)]);
    }
    edges.push([String(nodeCount - 1), String(nodeCount - 1)]);
    const result = findPaths(graphOf(edges), "0", String(nodeCount - 1), { explorationCap: 500 });
    expect(result.paths).toHaveLength(0);
    expect(result.complete).toBe(false);
    expect(result.explored).toBeLessThanOrEqual(500);
  });

  it("identifies entry points, dead ends, and orphans", () => {
    const withOrphan = graphOf([...checkout.edges.map(({ from, to }) => [from, to]), ["Lonely", "Lonely"]]);
    const issues = findStructuralIssues(checkout);
    expect(issues.sources.map((node) => node.id).sort()).toEqual(["Mobile", "Web"]);
    expect(issues.sinks.map((node) => node.id).sort()).toEqual(["InventoryDB", "PaymentDB"]);
    expect(issues.orphans).toHaveLength(0);
    expect(findStructuralIssues(withOrphan).cycles.length).toBeGreaterThan(0);
  });

  it("detects a cycle", () => {
    const cyclic = graphOf([["A", "B"], ["B", "C"], ["C", "A"], ["C", "D"]]);
    const { cycles } = findStructuralIssues(cyclic);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(["A", "B", "C", "A"]);
  });

  it("traverses a very deep chain without exhausting the stack", () => {
    const deep = graphOf(Array.from({ length: 20000 }, (_, index) => [`n${index}`, `n${index + 1}`]));
    expect(() => findStructuralIssues(deep)).not.toThrow();
    expect(findStructuralIssues(deep).cycles).toHaveLength(0);
  });
});
