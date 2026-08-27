import { describe, expect, it } from "vitest";
import { analyzeDiagram, groupPath, matchSemanticItem } from "../../src/mermaid/diagram-adapters.js";
import { cleanLabel, readShape, shapeLabel, splitStatements } from "../../src/mermaid/parsers/common.js";
import { mindmapNode } from "../../src/mermaid/parsers/hierarchy.js";

const item = (analysis, key) => analysis.items.find((candidate) => candidate.key === key);
const relation = (analysis, from, to) => analysis.relations.find((candidate) => candidate.from === from && candidate.to === to);

describe("label helpers", () => {
  it("cleans quotes, line breaks, entities and markdown emphasis", () => {
    expect(cleanLabel('"Quoted <br/> label"')).toBe("Quoted label");
    expect(cleanLabel("`**bold** text`")).toBe("`bold text`");
    expect(cleanLabel("A #quot;B#quot; &amp; C")).toBe('A "B" & C');
  });

  it("extracts labels from every flowchart shape delimiter", () => {
    expect(shapeLabel("[Text]")).toBe("Text");
    expect(shapeLabel('(("Circle"))')).toBe("Circle");
    expect(shapeLabel("(((Triple)))")).toBe("Triple");
    expect(shapeLabel("[/Slanted/]")).toBe("Slanted");
    expect(shapeLabel("[\\Back\\]")).toBe("Back");
    expect(shapeLabel(">Flag]")).toBe("Flag");
    expect(shapeLabel("{{Hex}}")).toBe("Hex");
    expect(shapeLabel("[(Cyl)]")).toBe("Cyl");
    expect(shapeLabel("([Stadium])")).toBe("Stadium");
    expect(shapeLabel('@{ shape: hex, label: "Config hex" }', "K")).toBe("Config hex");
    expect(shapeLabel("@{ shape: cyl }", "D")).toBe("D");
  });

  it("reads nested and quoted shapes without stopping early", () => {
    expect(readShape('["a ] b"] --> C', 0)).toBe(9);
    expect(readShape("[Multi<br>line] --> N", 0)).toBe(15);
    expect(readShape('@{ label: "x }" }rest', 0)).toBe(17);
  });

  it("splits statements on top-level semicolons only", () => {
    expect(splitStatements('A["x;y"] --> B; B --> C')).toEqual(['A["x;y"] --> B', "B --> C"]);
  });
});

describe("flowchart parser", () => {
  const source = `flowchart TB
  subgraph Outer[Outer group]
    subgraph Inner
      A["Quoted <br/> label"] & B(("Circle")) --> C[/Slanted/] & D[\\Back\\]
    end
    E>Flag] -- text --> F{{Hex}}
    F ==> G[[Sub]]
    G -.->|dotted| H[(Cyl)]
    H --o I(((Triple)))
    J <--> K@{ shape: hex, label: "Config hex" }
    K ~~~ L
  end
  L --> M[Multi<br>line] --> N; N --> O
  P -. dotted text .-> Q
  my-node --> other.node
  style N fill:#f9f
  click A "https://example.com"`;
  const analysis = analyzeDiagram(source);

  it("names nodes from every shape", () => {
    expect(item(analysis, "A").label).toBe("Quoted label");
    expect(item(analysis, "B").label).toBe("Circle");
    expect(item(analysis, "D").label).toBe("Back");
    expect(item(analysis, "E").label).toBe("Flag");
    expect(item(analysis, "I").label).toBe("Triple");
    expect(item(analysis, "K").label).toBe("Config hex");
    expect(item(analysis, "M").label).toBe("Multi line");
    expect(item(analysis, "my-node")).toBeDefined();
    expect(item(analysis, "other.node")).toBeDefined();
  });

  it("expands node lists, chains and text links into relations", () => {
    expect(relation(analysis, "A", "C")).toBeDefined();
    expect(relation(analysis, "B", "D")).toBeDefined();
    expect(relation(analysis, "E", "F").label).toBe("text");
    expect(relation(analysis, "G", "H").label).toBe("dotted");
    expect(relation(analysis, "P", "Q").label).toBe("dotted text");
    expect(relation(analysis, "L", "M")).toBeDefined();
    expect(relation(analysis, "M", "N")).toBeDefined();
    expect(relation(analysis, "N", "O")).toBeDefined();
    expect(relation(analysis, "J", "K")).toBeDefined();
    expect(relation(analysis, "K", "J")).toBeDefined();
    expect(relation(analysis, "K", "L")).toBeUndefined();
    expect(analysis.items.map(({ key }) => key)).not.toContain("text");
    expect(analysis.items.map(({ key }) => key)).not.toContain("o");
  });

  it("tracks nested subgraph membership", () => {
    expect(groupPath(analysis, item(analysis, "A").group)).toEqual(["Outer group", "Inner"]);
    expect(groupPath(analysis, item(analysis, "E").group)).toEqual(["Outer group"]);
    expect(item(analysis, "M").group).toBeUndefined();
  });

  it("parses block diagrams with space tokens and composite blocks", () => {
    const block = analyzeDiagram(`block-beta
  columns 3
  A["Source"] space B["Parse"]
  A --> B
  block:group:3
    columns 2
    C["Inspect"] D["Zoom"]
  end`);
    expect(item(block, "B").label).toBe("Parse");
    expect(relation(block, "A", "B")).toBeDefined();
    expect(item(block, "C").group).toBe("group");
  });
});

describe("class parser", () => {
  const analysis = analyzeDiagram(`classDiagram
  namespace Shapes {
    class Shape {
      <<abstract>>
      +draw()
    }
    class Circle
  }
  class Owner["Owner label"]
  Shape <|-- Circle : extends
  Owner "1" o-- "0..*" Circle : owns
  Circle ..> Shape
  Animal : +String name`);

  it("reads namespaces, labels and members", () => {
    expect(item(analysis, "Owner").label).toBe("Owner label");
    expect(item(analysis, "Circle").group).toBe("Shapes");
    expect(item(analysis, "Animal")).toBeDefined();
  });

  it("handles cardinality strings and marker direction", () => {
    expect(relation(analysis, "Circle", "Owner").label).toBe("owns");
    expect(relation(analysis, "Circle", "Shape").label).toBe("extends");
  });
});

describe("state parser", () => {
  const analysis = analyzeDiagram(`stateDiagram-v2
  [*] --> Idle
  state "Long running job" as Job
  Idle --> Job : start
  state Job {
    [*] --> Prep
    Prep --> Run
    Monitor
  }
  Done --> [*]
  note right of Idle : Waiting`);

  it("names pseudo states the way Mermaid renders them", () => {
    expect(relation(analysis, "root_start", "Idle")).toBeDefined();
    expect(relation(analysis, "Job_start", "Prep")).toBeDefined();
    expect(relation(analysis, "Done", "root_end")).toBeDefined();
    expect(item(analysis, "Job_start").label).toBe("Start (Job)");
  });

  it("keeps descriptions, composite membership and notes", () => {
    expect(item(analysis, "Job").label).toBe("Long running job");
    expect(item(analysis, "Prep").group).toBe("Job");
    expect(item(analysis, "Monitor").group).toBe("Job");
    expect(item(analysis, "Idle----note").label).toBe("Note: Waiting");
    expect(relation(analysis, "Idle", "Job").label).toBe("start");
  });
});

describe("sequence parser", () => {
  const analysis = analyzeDiagram(`sequenceDiagram
  box Frontend
    participant U as User
  end
  participant S as Server
  U->>+S: activate
  S-->>-U: done
  U<<->>S: bidi
  U-xS: lost
  create participant D as DB
  S-)D: async
  Note over U,S: shared`);

  it("reads aliases, boxes and every arrow type", () => {
    expect(item(analysis, "U").label).toBe("User");
    expect(item(analysis, "U").group).toBe("Frontend");
    expect(relation(analysis, "U", "S").label).toBe("activate");
    expect(relation(analysis, "S", "U")).toBeDefined();
    expect(relation(analysis, "S", "D").label).toBe("async");
    expect(item(analysis, "D").label).toBe("DB");
    expect(analysis.items.map(({ key }) => key)).not.toContain("Note");
  });
});

describe("hierarchy parsers", () => {
  it("parses mindmap shapes into keys and labels", () => {
    expect(mindmapNode("root((Atlas))")).toEqual({ key: "root", label: "Atlas" });
    expect(mindmapNode("id4))Bang((")).toEqual({ key: "id4", label: "Bang" });
    expect(mindmapNode("id5)Cloud(")).toEqual({ key: "id5", label: "Cloud" });
    expect(mindmapNode("id6{{Hexagon}}")).toEqual({ key: "id6", label: "Hexagon" });
    expect(mindmapNode("Plain text")).toEqual({ key: "Plain text", label: "Plain text" });
  });

  it("groups mindmap branches only when they have descendants", () => {
    const analysis = analyzeDiagram(`mindmap
  root((Atlas))
    Rendering
      Mermaid
      ::icon(fa fa-book)
    Explore`);
    expect(item(analysis, "Mermaid").group).toBe("Rendering");
    expect(item(analysis, "Explore").group).toBeUndefined();
    expect(analysis.groups.map(({ key }) => key)).toEqual(["Rendering"]);
    expect(relation(analysis, "Rendering", "Mermaid")).toBeDefined();
  });

  it("turns kanban columns into groups and reads item labels", () => {
    const analysis = analyzeDiagram(`kanban
  todo[Todo]
    docs[Write docs]@{ assigned: Alice }
  done[Done]
    setup[Set up viewer]`);
    expect(item(analysis, "docs").label).toBe("Write docs");
    expect(item(analysis, "docs").group).toBe("todo");
    expect(analysis.items.map(({ key }) => key)).not.toContain("todo");
    expect(analysis.relations).toEqual([]);
  });

  it("parses gantt sections, auto ids and multi-parent dependencies", () => {
    const analysis = analyzeDiagram(`gantt
  section Build
  Design :done, d, 2026-01-01, 3d
  Code :active, c, after d, 5d
  Ship :milestone, after d c, 0d`);
    expect(item(analysis, "task-auto-1").label).toBe("Ship");
    expect(item(analysis, "d").group).toBe("Build");
    expect(relation(analysis, "d", "task-auto-1")).toBeDefined();
    expect(relation(analysis, "c", "task-auto-1")).toBeDefined();
  });

  it("parses timeline periods, events and sections", () => {
    const analysis = analyzeDiagram(`timeline
  section Core
    2024 : Prototype : Pan and zoom
    2025 : Search`);
    expect(item(analysis, "period-1").label).toBe("2024");
    expect(item(analysis, "period-1-event-2").label).toBe("Pan and zoom");
    expect(item(analysis, "period-2").group).toBe("Core");
    expect(item(analysis, "Core").kind).toBe("section");
  });

  it("parses journeys and git graphs in source order", () => {
    const journey = analyzeDiagram(`journey
  section Browse
    Find item: 5: User`);
    expect(item(journey, "task-1").label).toBe("Find item");
    const git = analyzeDiagram(`gitGraph
  commit id: "Base"
  branch dev
  commit
  checkout main
  merge dev`);
    expect(git.items.map(({ label }) => label)).toEqual(["Base", "Commit 2", "Merge dev"]);
    expect(item(git, "commit-auto-2").group).toBe("dev");
  });
});

describe("other relational parsers", () => {
  it("parses architecture groups, junctions and undirected edges", () => {
    const analysis = analyzeDiagram(`architecture-beta
  group api(cloud)[API]
  group data(database)[Data] in api
  service db(database)[Database] in data
  service server(server)[Server] in api
  junction j
  db:L -- R:server
  server:B --> T:j`);
    expect(groupPath(analysis, item(analysis, "db").group)).toEqual(["API", "Data"]);
    expect(relation(analysis, "db", "server")).toBeDefined();
    expect(relation(analysis, "server", "j")).toBeDefined();
    expect(item(analysis, "j").kind).toBe("junction");
  });

  it("parses ER aliases and skips attribute blocks", () => {
    const analysis = analyzeDiagram(`erDiagram
  CUSTOMER["Customer"] ||--o{ ORDER : places
  CUSTOMER {
    string id PK
  }`);
    expect(item(analysis, "CUSTOMER").label).toBe("Customer");
    expect(relation(analysis, "CUSTOMER", "ORDER").label).toBe("places");
    expect(analysis.items).toHaveLength(2);
  });

  it("parses C4 boundaries as groups", () => {
    const analysis = analyzeDiagram(`C4Container
  Person(user, "User")
  System_Boundary(sys, "Viewer") {
    Container(web, "Web app", "React", "UI")
  }
  Rel(user, web, "Uses")`);
    expect(item(analysis, "web").group).toBe("sys");
    expect(relation(analysis, "user", "web").label).toBe("Uses");
  });
});

describe("semantic matching", () => {
  it("never binds a node through substring matches", () => {
    const analysis = analyzeDiagram("flowchart LR\n  A --> C[Circle]\n  B --> D");
    expect(matchSemanticItem(analysis, "B", "Circle")?.key).toBe("B");
    expect(matchSemanticItem(analysis, "X", "circle")?.key).toBe("C");
    expect(matchSemanticItem(analysis, "X", "irc")).toBeUndefined();
  });
});
