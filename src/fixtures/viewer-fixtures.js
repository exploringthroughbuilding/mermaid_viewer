const fixture = (id, family, title, source, options = {}) => ({
  id,
  family,
  title,
  source,
  stability: "stable",
  features: [],
  viewer: true,
  ...options,
});

export const viewerFixtures = [
  fixture("flowchart-core", "Flowchart", "Shapes, subgraphs, links, and classes", `flowchart LR
  subgraph S[Pipeline]
    A([Start]) -->|input| B{Valid?}
  end
  B -->|yes| C[(Store)]
  B -. no .-> D[Fix]
  classDef hot fill:#fee,stroke:#900
  class B hot`, { features: ["subgraph", "shapes", "links", "classDef"] }),
  fixture("sequence-core", "Sequence", "Checkout request across six participants", `sequenceDiagram
  autonumber
  actor Shopper
  participant Web as Storefront
  participant API as API Gateway
  participant Checkout as Checkout Service
  participant Payment as Payment Service
  participant DB as Order Database
  Shopper->>Web: Confirm cart
  Web->>+API: POST /checkout
  API->>Checkout: Validate cart
  Checkout->>Payment: Authorize payment
  Note right of Payment: Tokenized card payment
  alt approved
    Payment-->>Checkout: Authorization
    Checkout->>DB: Create order
    DB-->>Checkout: Order ID
    Checkout-->>API: Confirmed
  else declined
    Payment-->>Checkout: Declined
    Checkout-->>API: Payment required
  end
  API-->>-Web: Result
  Web-->>Shopper: Show confirmation`, { features: ["actor", "aliases", "autonumber", "activation", "note", "alt"] }),
  fixture("class-core", "Class", "Members, stereotypes, and cardinality", `classDiagram-v2
  class Animal {
    <<interface>>
    +String name
    +speak() String
  }
  class Dog
  class Owner
  Animal <|.. Dog : implements
  Owner "1" o-- "0..*" Dog : owns`, { features: ["members", "stereotype", "realization", "aggregation"] }),
  fixture("state-core", "State", "Eight-state checkout lifecycle", `stateDiagram-v2
  [*] --> Browsing
  Browsing --> Checkout : begin checkout
  state Checkout {
    [*] --> Validating
    Validating --> AwaitingPayment : cart valid
    AwaitingPayment --> Confirming : payment approved
    AwaitingPayment --> Failed : payment declined
    Failed --> AwaitingPayment : retry
    Confirming --> [*]
  }
  Checkout --> Fulfilled : order placed
  Checkout --> Cancelled : abandon
  Fulfilled --> [*]
  Cancelled --> [*]
  note right of Checkout : Payment and order orchestration`, { features: ["initial", "composite", "branching", "retry", "note", "final"] }),
  fixture("er-core", "Entity relationship", "Cardinality, attributes, and keys", `erDiagram
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER {
    string id PK
    string email UK
  }
  ORDER {
    int id PK
    decimal total
  }`, { features: ["cardinality", "attributes", "keys"] }),
  fixture("mindmap-core", "Mindmap", "Hierarchy and node shapes", `mindmap
  root((Atlas))
    Rendering
      Mermaid
      Plugins
    Explore
      Search
      Zoom`, { features: ["hierarchy", "root shape"] }),
  fixture("architecture-core", "Architecture", "Groups, services, icons, ports, and edges", `architecture-beta
  group cloud(cloud)[Cloud]
  service client(internet)[Client]
  service api(server)[API] in cloud
  service db(database)[DB] in cloud
  client:R --> L:api
  api:B --> T:db`, { stability: "evolving", features: ["group", "service", "icon", "ports"] }),
];

export function viewerFixtureById(id) {
  return viewerFixtures.find((entry) => entry.id === id);
}
