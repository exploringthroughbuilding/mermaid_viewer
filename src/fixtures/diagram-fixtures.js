const fixture = (id, family, title, source, options = {}) => ({
  id,
  family,
  title,
  source,
  stability: "stable",
  features: [],
  ...options,
});

export const diagramFixtures = [
  fixture("flowchart-core", "Flowchart", "Shapes, subgraphs, links, and classes", `flowchart LR
  subgraph S[Pipeline]
    A([Start]) -->|input| B{Valid?}
  end
  B -->|yes| C[(Store)]
  B -. no .-> D[Fix]
  classDef hot fill:#fee,stroke:#900
  class B hot`, { features: ["subgraph", "shapes", "links", "classDef"], viewer: true }),
  fixture("flowchart-legacy", "Flowchart", "Legacy graph declaration", `graph TD
  A[Legacy declaration] --> B[Supported]`, { features: ["graph alias"] }),
  fixture("swimlane-core", "Swimlane", "Lanes and cross-lane handoff", `swimlane-beta LR
  subgraph client[Client]
    A([Start]) --> B[Submit]
  end
  subgraph api[API]
    C{Valid?} --> D[Store]
  end
  B -->|request| C`, { stability: "experimental", features: ["lanes", "handoff", "decision"] }),
  fixture("sequence-core", "Sequence", "Actors, activation, notes, and alternatives", `sequenceDiagram
  autonumber
  actor U as User
  participant API
  U->>+API: Request
  Note right of API: Validate
  alt valid
    API-->>U: OK
  else invalid
    API-->>-U: Error
  end`, { features: ["actor", "autonumber", "activation", "note", "alt"], viewer: true }),
  fixture("class-core", "Class", "Members, stereotypes, and cardinality", `classDiagram-v2
  class Animal {
    <<interface>>
    +String name
    +speak() String
  }
  class Dog
  class Owner
  Animal <|.. Dog : implements
  Owner "1" o-- "0..*" Dog : owns`, { features: ["members", "stereotype", "realization", "aggregation"], viewer: true }),
  fixture("state-core", "State", "Composite states, notes, and transitions", `stateDiagram-v2
  [*] --> Active
  state Active {
    [*] --> Idle
    Idle --> Busy : work
    Busy --> Idle
  }
  note right of Active : Composite state
  Active --> [*]`, { features: ["initial", "composite", "note", "final"], viewer: true }),
  fixture("er-core", "Entity relationship", "Cardinality, attributes, and keys", `erDiagram
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER {
    string id PK
    string email UK
  }
  ORDER {
    int id PK
    decimal total
  }`, { features: ["cardinality", "attributes", "keys"], viewer: true }),
  fixture("requirement-core", "Requirement", "Requirements, elements, and relationships", `requirementDiagram
  requirement render_req {
    id: 1
    text: Render valid source
    risk: medium
    verifymethod: test
  }
  element viewer {
    type: software
    docref: README.md
  }
  viewer - satisfies -> render_req`, { features: ["requirement", "element", "satisfies"] }),
  fixture("journey-core", "User journey", "Sections, scores, and actors", `journey
  title Checkout
  section Browse
    Find item: 5: User
    Add to cart: 4: User
  section Pay
    Submit order: 3: User, API`, { features: ["section", "score", "actors"] }),
  fixture("gantt-core", "Gantt", "Dependencies, task states, and milestones", `gantt
  title Release
  dateFormat YYYY-MM-DD
  excludes weekends
  section Build
  Design :done, d, 2026-01-01, 3d
  Code :active, c, after d, 5d
  Ship :milestone, after c, 0d`, { features: ["dateFormat", "excludes", "after", "milestone"], viewer: true }),
  fixture("gitgraph-core", "Git graph", "Branches, tags, checkout, and merge", `gitGraph LR:
  commit id: "Base" tag: "v1"
  branch feature
  checkout feature
  commit id: "Work"
  checkout main
  merge feature id: "Merge"`, { features: ["orientation", "tag", "branch", "merge"], viewer: true }),
  fixture("timeline-core", "Timeline", "Sections and multiple events", `timeline
  title Releases
  section Core
    2024 : Prototype : Pan and zoom
    2025 : Search
  section Plugins
    2026 : ELK : ZenUML`, { features: ["section", "period", "multiple events"], viewer: true }),
  fixture("kanban-core", "Kanban", "Columns, tasks, and metadata", `kanban
  todo[Todo]
    docs[Write docs]@{ assigned: Alice, ticket: DOC-1, priority: High }
  doing[Doing]
    test[Test fixtures]
  done[Done]
    setup[Set up viewer]`, { stability: "evolving", features: ["column", "task", "metadata"] }),
  fixture("pie-core", "Pie", "Title, values, and displayed data", `pie showData title Share
  "Core" : 60
  "Plugins" : 40`, { features: ["showData", "title", "values"], viewer: true }),
  fixture("quadrant-core", "Quadrant", "Axes, labels, and points", `quadrantChart
  title Priorities
  x-axis Hard --> Easy
  y-axis Low --> High
  quadrant-1 Do now
  A: [0.8, 0.9]
  B: [0.3, 0.4]`, { features: ["axes", "quadrant label", "points"], viewer: true }),
  fixture("xychart-core", "XY chart", "Horizontal bar and line series", `xychart-beta horizontal
  title "Latency"
  x-axis [Small, Medium, Large]
  y-axis "ms" 0 --> 100
  bar [20, 45, 80]
  line [15, 35, 70]`, { stability: "evolving", features: ["horizontal", "categorical axis", "bar", "line"], viewer: true }),
  fixture("sankey-core", "Sankey", "CSV flow data", `sankey-beta
Source,Parser,10
Parser,SVG,7
Parser,Error,3`, { stability: "evolving", features: ["CSV", "weighted flow"] }),
  fixture("radar-core", "Radar", "Axes, curves, graticule, and ticks", `radar-beta
  title Coverage
  axis syntax["Syntax"], render["Render"], layout["Layout"]
  curve core["Core"]{9, 8, 7}
  curve plugins["Plugins"]{syntax: 7, render: 6, layout: 9}
  graticule polygon
  ticks 4`, { stability: "experimental", features: ["axis", "positional curve", "keyed curve", "graticule"] }),
  fixture("mindmap-core", "Mindmap", "Hierarchy and node shapes", `mindmap
  root((Atlas))
    Rendering
      Mermaid
      Plugins
    Explore
      Search
      Zoom`, { features: ["hierarchy", "root shape"], viewer: true }),
  fixture("block-core", "Block", "Columns, space, composite blocks, and links", `block-beta
  columns 3
  A["Source"] space B["Parse"]
  A --> B
  block:group:3
    columns 2
    C["Inspect"] D["Zoom"]
  end`, { stability: "evolving", features: ["columns", "space", "composite block"], viewer: true }),
  fixture("packet-core", "Packet", "Explicit ranges and relative bit counts", `packet-beta
  0-3: "Version"
  +8: "Length"
  12-31: "Payload"`, { stability: "evolving", features: ["range", "relative bits"] }),
  fixture("architecture-core", "Architecture", "Groups, services, icons, ports, and edges", `architecture-beta
  group cloud(cloud)[Cloud]
  service client(internet)[Client]
  service api(server)[API] in cloud
  service db(database)[DB] in cloud
  client:R --> L:api
  api:B --> T:db`, { stability: "evolving", features: ["group", "service", "icon", "ports"], viewer: true }),
  fixture("treeview-core", "Tree view", "Directories, files, descriptions, and classes", `treeView-beta
  project/ ## root
    src/:::highlight
      index.js
    package.json`, { stability: "experimental", features: ["directory", "file", "description", "class"] }),
  fixture("treemap-core", "Treemap", "Hierarchy and weighted leaves", `treemap-beta
  "Core"
    "Parser": 40
    "Renderer": 35
  "Plugins"
    "Layouts": 25`, { stability: "experimental", features: ["hierarchy", "weight"] }),
  fixture("eventmodeling-core", "Event modeling", "UI, command, event, and read model", `eventmodeling
  tf 01 ui Shop.CartUI {items: []}
  tf 02 cmd Shop.AddItem
  tf 03 evt Shop.ItemAdded
  tf 04 rmo Shop.CartView`, { stability: "experimental", features: ["timeframe", "UI", "command", "event", "read model"] }),
  fixture("venn-core", "Venn", "Sets, unions, sizes, and nested text", `venn-beta
  set A["Core"]: 12
  set B["Plugins"]: 10
  union A,B["Shared"]: 4
    text overlap["Common API"]`, { stability: "experimental", features: ["set", "union", "size", "text"] }),
  fixture("ishikawa-core", "Ishikawa", "Problem, causes, and subcauses", `ishikawa-beta
  Slow render
    Input
      Large graph
    Layout
      Dense edges
    Browser
      Limited memory`, { stability: "experimental", features: ["problem", "cause", "subcause"] }),
  fixture("wardley-core", "Wardley map", "Anchors, components, links, evolution, and notes", `wardley-beta
  title Viewer strategy
  anchor User [0.95, 0.9]
  component Viewer [0.75, 0.65] (build)
  component Mermaid [0.55, 0.8] (buy)
  User -> Viewer
  Viewer -> Mermaid
  evolve Viewer 0.75
  note "Local rendering" [0.65, 0.55]`, { stability: "experimental", features: ["anchor", "component", "evolve", "note"] }),
  fixture("cynefin-core", "Cynefin", "Domains and transitions", `cynefin-beta
  title Delivery decisions
  complex
    "Explore interaction"
  complicated
    "Tune layout"
  clear
    "Run build"
  chaotic
    "Recover outage"
  confusion
    "Unknown issue"
  complex --> complicated : "Pattern found"`, { stability: "experimental", features: ["domains", "transition"] }),
  fixture("railroad-ir", "Railroad", "Intermediate representation constructors", `railroad-beta
  title Expression IR
  expr = sequence(
    nonterminal("term"),
    zeroOrMore(sequence(terminal("+"), nonterminal("term")))
  );`, { stability: "experimental", features: ["sequence", "terminal", "zeroOrMore"] }),
  fixture("railroad-ebnf", "Railroad", "EBNF sequence, repetition, and choice", `railroad-ebnf-beta
  title Expression EBNF
  expr = term, { "+", term } ;
  term = number | "(" expr ")" ;
  number = digit+ ;`, { stability: "experimental", features: ["EBNF", "repetition", "choice"] }),
  fixture("railroad-abnf", "Railroad", "ABNF alternation, repetition, and optional", `railroad-abnf-beta
  title Token ABNF
  token = 1*(ALPHA / DIGIT) ;
  prefix = [ "x-" ] token ;`, { stability: "experimental", features: ["ABNF", "alternation", "optional"] }),
  fixture("railroad-peg", "Railroad", "PEG choice and repetition", `railroad-peg-beta
  title Choice PEG
  Value <- String / Number ;
  String <- "text" ;
  Number <- "1"+ ;`, { stability: "experimental", features: ["PEG", "choice", "repetition"] }),
  fixture("c4-context", "C4", "System context", `C4Context
  title System context
  Person(user, "User", "Views diagrams")
  System(viewer, "Viewer", "Renders Mermaid")
  System_Ext(source, "Source")
  Rel(user, viewer, "Uses")
  Rel(viewer, source, "Loads")`, { stability: "experimental", features: ["person", "system", "external system", "relation"] }),
  fixture("c4-container", "C4", "Container diagram", `C4Container
  Person(user, "User")
  System_Boundary(sys, "Viewer") {
    Container(web, "Web app", "React", "UI")
    ContainerDb(db, "Store", "IndexedDB", "Data")
  }
  Rel(user, web, "Uses")
  Rel(web, db, "Writes")`, { stability: "experimental", features: ["boundary", "container", "database"] }),
  fixture("c4-component", "C4", "Component diagram", `C4Component
  Container_Boundary(web, "Web app") {
    Component(editor, "Editor", "React")
    Component(renderer, "Renderer", "Mermaid")
  }
  Rel(editor, renderer, "Renders")`, { stability: "experimental", features: ["container boundary", "component"] }),
  fixture("c4-dynamic", "C4", "Dynamic diagram", `C4Dynamic
  Person(user, "User")
  System(viewer, "Viewer")
  System(source, "Source")
  RelIndex(1, user, viewer, "Opens")
  RelIndex(2, viewer, source, "Loads")`, { stability: "experimental", features: ["ordered relation"] }),
  fixture("c4-deployment", "C4", "Deployment diagram", `C4Deployment
  Deployment_Node(browser, "Browser", "Device") {
    Container(viewer, "Viewer", "React")
  }
  Deployment_Node(cdn, "CDN", "Cloud") {
    Container(source, "Mermaid", "JavaScript")
  }
  Rel(viewer, source, "Loads")`, { stability: "experimental", features: ["deployment node", "container"] }),
  fixture("zenuml-core", "ZenUML", "Participants, calls, conditions, and replies", `zenuml
  title Request
  @Actor User
  API as Service
  User->API: Submit
  API.Validate() {
    if(valid) {
      result = Store.Save()
    } else {
      return error
    }
  }
  API->User: Done`, { stability: "experimental", features: ["annotator", "alias", "sync call", "if", "return"], viewer: true }),
  fixture("info-core", "Info", "Mermaid runtime information", `info
  showInfo`, { features: ["showInfo"] }),
  ...["elk", "elk.layered", "elk.stress", "elk.force", "elk.mrtree", "elk.sporeOverlap"].map((layout) => fixture(
    `flowchart-${layout.replace(/([a-z])([A-Z])/g, "$1-$2").replaceAll(".", "-").toLocaleLowerCase()}`,
    "ELK layout",
    layout,
    `---
config:
  layout: ${layout}
---
flowchart LR
  A --> B
  A --> C`,
    { stability: "plugin", features: [layout], viewer: layout === "elk.force" },
  )),
  fixture("flowchart-elk-declaration", "ELK layout", "flowchart-elk declaration", `flowchart-elk LR
  A --> B
  A --> C`, { stability: "plugin", features: ["declaration alias"] }),
  fixture("mindmap-tidy-tree", "Tidy-tree layout", "Bidirectional mindmap layout", `---
config:
  layout: tidy-tree
---
mindmap
  root((Root))
    One
      Leaf
    Two`, { stability: "plugin", features: ["tidy-tree"], viewer: true }),
];

export const viewerFixtures = diagramFixtures.filter(({ viewer }) => viewer);

export function fixtureById(id) {
  return diagramFixtures.find((entry) => entry.id === id);
}
