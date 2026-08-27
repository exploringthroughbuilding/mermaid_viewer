import { describe, expect, it } from "vitest";
import { diagramFixtures, fixtureById, viewerFixtures } from "../../src/fixtures/diagram-fixtures.js";
import { analyzeDiagram } from "../../src/mermaid/diagram-adapters.js";

const requiredAdapterIds = new Set([
  "flowchart", "block", "sequence", "zenuml", "class", "state", "er", "architecture", "swimlane",
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
    expect(viewerFixtures.length).toBeGreaterThan(10);
    viewerFixtures.forEach(({ id }) => expect(fixtureById(id)?.viewer, id).toBe(true));
  });

  it("covers every installed ELK algorithm and tidy-tree", () => {
    const sources = diagramFixtures.map(({ source }) => source).join("\n\n");
    ["elk", "elk.layered", "elk.stress", "elk.force", "elk.mrtree", "elk.sporeOverlap", "tidy-tree"]
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

  it("does not invent relationships for ordered diagrams", () => {
    expect(analyzeDiagram(fixtureById("gitgraph-core").source).relations).toEqual([]);
    expect(analyzeDiagram(fixtureById("timeline-core").source).mode).toBe("ordered");
  });
});
