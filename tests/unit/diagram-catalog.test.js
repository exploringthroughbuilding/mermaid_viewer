import { describe, expect, it } from "vitest";
import { diagramFixtures, fixtureById, viewerFixtures } from "../../src/fixtures/diagram-fixtures.js";
import { analyzeDiagram } from "../../src/mermaid/diagram-adapters.js";

const requiredAdapterIds = new Set([
  "flowchart", "block", "sequence", "class", "state", "er", "architecture", "swimlane",
  "requirement", "sankey", "mindmap", "treeView", "treemap", "ishikawa", "wardley", "gantt",
  "kanban", "eventmodeling", "timeline", "gitGraph", "journey", "packet", "railroad", "pie",
  "quadrantChart", "xychart", "radar", "venn", "cynefin", "c4", "info",
]);

describe("diagram fixture catalog", () => {
  it("uses unique, stable fixture IDs", () => {
    const ids = diagramFixtures.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/));
  });

  it("covers every supported adapter family", () => {
    const covered = new Set(diagramFixtures.map(({ source }) => analyzeDiagram(source).id));
    requiredAdapterIds.forEach((id) => expect(covered, `Missing fixture for ${id}`).toContain(id));
  });

  it("never falls through to the generic adapter", () => {
    diagramFixtures.forEach(({ id, source }) => expect(analyzeDiagram(source).id, id).not.toBe("diagram"));
  });

  it("keeps viewer examples as references to catalog entries", () => {
    expect(viewerFixtures.map(({ id }) => id)).toEqual([
      "flowchart-core",
      "sequence-core",
      "class-core",
      "state-core",
      "er-core",
      "mindmap-core",
      "architecture-core",
    ]);
    viewerFixtures.forEach(({ id }) => expect(fixtureById(id)?.viewer, id).toBe(true));
  });

  it("covers every installed ELK algorithm", () => {
    const sources = diagramFixtures.map(({ source }) => source).join("\n\n");
    ["elk", "elk.layered", "elk.stress", "elk.force", "elk.mrtree", "elk.sporeOverlap"]
      .forEach((layout) => expect(sources).toContain(`layout: ${layout}`));
  });
});

describe("semantic analysis", () => {
  it("maps inline flowchart labels to the correct relation and source line", () => {
    const analysis = analyzeDiagram("flowchart LR\n  A[API] -->|writes| B[(Store)]");
    expect(analysis.relations).toContainEqual(expect.objectContaining({ from: "A", to: "B", line: 1, label: "writes" }));
    expect(analysis.items.find(({ key }) => key === "B")?.line).toBe(1);
  });

  it("detects declarations after frontmatter", () => {
    const analysis = analyzeDiagram("---\nconfig:\n  layout: elk.force\n---\nflowchart LR\n  A --> B");
    expect(analysis.id).toBe("flowchart");
    expect(analysis.relations).toHaveLength(1);
  });

  it("indexes every node in chained flowchart links", () => {
    const analysis = analyzeDiagram("flowchart LR\n  A --> B --> C");
    expect(analysis.items.map(({ key }) => key)).toEqual(["A", "B", "C"]);
    expect(analysis.relations.map(({ from, to }) => [from, to])).toEqual([["A", "B"], ["B", "C"]]);
  });

  it("expands flowchart fan-in and fan-out without parsing arrows inside labels", () => {
    const analysis = analyzeDiagram(`flowchart LR
  A["returns X -> Y"]
  A & B --> C & D
  C -. failure .-> E`);
    expect(analysis.items.find(({ key }) => key === "A")?.label).toBe("returns X -> Y");
    expect(analysis.items.some(({ key }) => key === "X")).toBe(false);
    expect(analysis.relations.map(({ from, to, label }) => [from, to, label])).toEqual([
      ["A", "C", ""],
      ["A", "D", ""],
      ["B", "C", ""],
      ["B", "D", ""],
      ["C", "E", "failure"],
    ]);
  });

  it("derives Git ancestry and branch groups from checkout state", () => {
    const analysis = analyzeDiagram(fixtureById("gitgraph-core").source);
    expect(analysis.mode).toBe("relational");
    expect(analysis.groups.map(({ label }) => label)).toEqual(["main", "feature"]);
    expect(analysis.relations.map(({ from, to }) => [from, to])).toEqual([
      ["commit-1", "commit-4"],
      ["commit-1", "commit-6"],
      ["commit-4", "commit-6"],
    ]);
  });

  it("groups timeline events beneath their periods", () => {
    const analysis = analyzeDiagram(fixtureById("timeline-core").source);
    expect(analysis.mode).toBe("relational");
    expect(analysis.groups.map(({ label }) => label)).toEqual(["Core", "Plugins"]);
    expect(analysis.items).toHaveLength(8);
    expect(analysis.relations).toHaveLength(5);
  });

  it("preserves source-defined groups for state, block, Gantt, and architecture", () => {
    const grouped = ["state-core", "block-core", "gantt-core", "architecture-core"]
      .map((id) => analyzeDiagram(fixtureById(id).source));
    expect(grouped.map(({ groups }) => groups.map(({ label }) => label))).toEqual([
      ["Checkout"],
      ["group"],
      ["Build"],
      ["Cloud"],
    ]);
  });
});
