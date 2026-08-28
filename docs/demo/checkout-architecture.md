# Northwind Commerce — Platform Architecture

Reference architecture for the Northwind storefront. Every service boundary,
queue, and datastore that a checkout request can touch is catalogued here so
new engineers can trace a request end to end without reading the whole repo.

## Service Topology

The full request-serving surface. Edge traffic terminates at the CDN, is routed
by the API gateway, and fans out into the domain services.

```mermaid
flowchart LR
  subgraph Edge
    CDN[Fastly CDN]
    WAF[Web Application Firewall]
    LB[Load Balancer]
  end

  subgraph Clients
    Web[Storefront Web]
    Mobile[Mobile App]
    Partner[Partner API Clients]
  end

  subgraph Gateway
    APIGateway[API Gateway]
    AuthN[Auth Service]
    RateLimiter[Rate Limiter]
  end

  subgraph Commerce
    CartService[Cart Service]
    CheckoutOrchestrator[Checkout Orchestrator]
    PricingEngine[Pricing Engine]
    TaxService[Tax Service]
    InventoryService[Inventory Service]
    PromotionService[Promotion Service]
  end

  subgraph Payments
    PaymentService[Payment Service]
    FraudScorer[Fraud Scorer]
    TokenVault[Card Token Vault]
    LedgerService[Ledger Service]
    PayoutWorker[Payout Worker]
  end

  subgraph Fulfilment
    OrderService[Order Service]
    ShippingService[Shipping Service]
    NotificationService[Notification Service]
    WarehouseAdapter[Warehouse Adapter]
  end

  subgraph Data
    CartCache[(Cart Redis)]
    OrderDB[(Order Postgres)]
    PaymentDB[(Payment Postgres)]
    LedgerDB[(Ledger Postgres)]
    InventoryDB[(Inventory Postgres)]
    EventBus[[Kafka Event Bus]]
    Warehouse[(Analytics Warehouse)]
  end

  Web --> CDN
  Mobile --> CDN
  Partner --> WAF
  CDN --> WAF
  WAF --> LB
  LB --> APIGateway
  APIGateway --> AuthN
  APIGateway --> RateLimiter
  APIGateway --> CartService
  APIGateway --> CheckoutOrchestrator
  APIGateway --> OrderService

  CartService --> CartCache
  CartService --> PricingEngine
  PricingEngine --> PromotionService
  PricingEngine --> TaxService

  CheckoutOrchestrator --> CartService
  CheckoutOrchestrator --> InventoryService
  CheckoutOrchestrator --> PricingEngine
  CheckoutOrchestrator --> PaymentService
  CheckoutOrchestrator --> OrderService

  InventoryService --> InventoryDB
  InventoryService --> EventBus

  PaymentService --> FraudScorer
  PaymentService --> TokenVault
  PaymentService --> PaymentDB
  PaymentService --> LedgerService
  FraudScorer --> PaymentDB
  LedgerService --> LedgerDB
  LedgerService --> EventBus
  PayoutWorker --> LedgerDB
  PayoutWorker --> PaymentDB

  OrderService --> OrderDB
  OrderService --> EventBus
  OrderService --> ShippingService
  ShippingService --> WarehouseAdapter
  ShippingService --> NotificationService
  WarehouseAdapter --> EventBus
  EventBus --> Warehouse
  NotificationService --> EventBus
```

## Checkout Request Flow

The happy path for `POST /checkout`. Payment authorisation is synchronous;
fulfilment is driven by events published after the order is durable.

```mermaid
sequenceDiagram
  participant Client as Storefront Web
  participant Gateway as API Gateway
  participant Orchestrator as Checkout Orchestrator
  participant Inventory as Inventory Service
  participant Payment as Payment Service
  participant Fraud as Fraud Scorer
  participant Ledger as Ledger Service
  participant Orders as Order Service

  Client->>Gateway: POST /checkout
  Gateway->>Orchestrator: authorise and forward
  Orchestrator->>Inventory: reserve line items
  Inventory-->>Orchestrator: reservation token
  Orchestrator->>Payment: authorise payment
  Payment->>Fraud: score transaction
  Fraud-->>Payment: risk verdict
  Payment->>Ledger: record authorisation
  Ledger-->>Payment: ledger entry id
  Payment-->>Orchestrator: authorisation id
  Orchestrator->>Orders: create order
  Orders-->>Orchestrator: order id
  Orchestrator-->>Client: 201 Created
```

## Payment Data Ownership

Which service is allowed to write which payment table. Only the Payment Service
and the Payout Worker hold write credentials for `payments`.

```mermaid
flowchart TD
  PaymentService[Payment Service] -->|write| PaymentsTable[(payments)]
  PaymentService -->|write| AuthorisationsTable[(authorisations)]
  PayoutWorker[Payout Worker] -->|write| PayoutsTable[(payouts)]
  PayoutWorker -->|read| PaymentsTable
  LedgerService[Ledger Service] -->|write| EntriesTable[(ledger_entries)]
  FraudScorer[Fraud Scorer] -->|read| PaymentsTable
  ReportingJob[Reporting Job] -->|read| PaymentsTable
  ReportingJob -->|read| EntriesTable
  ReconcilerJob[Reconciler Job] -->|read| PayoutsTable
  ReconcilerJob -->|read| EntriesTable
```

## Deployment Environments

```mermaid
flowchart LR
  Dev[Development] --> Staging[Staging]
  Staging --> Canary[Canary 5%]
  Canary --> Production[Production]
  Production --> DR[Disaster Recovery Region]
```
