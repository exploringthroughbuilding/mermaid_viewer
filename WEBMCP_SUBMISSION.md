# WebMCP Challenge — submission notes

This documents exactly what existed before the submission period and what was
built during it, as the challenge rules require for pre-existing projects.

## Prior-work disclosure

The WebMCP Challenge submission period opened **25 August 2026, 11:00 PT**.

Mermaid Atlas has one commit before that boundary:

| Commit | Date | Status |
| --- | --- | --- |
| `096241b` Initial Commit | 2026-08-23 22:57 +0100 | **Prior work** |
| `5dc96a3` Migrate viewer to React | 2026-08-26 23:38 +0100 | In period |
| `c4684da` Improve graph navigation and zoom | 2026-08-27 01:09 +0100 | In period |
| `df3029d` Merge PR #1 (react-migration) | 2026-08-27 01:12 +0100 | In period |
| `ea79883` improvements | 2026-08-27 21:12 +0100 | In period |
| `9a463e5` Merge PR #2 (changes) | 2026-08-27 21:13 +0100 | In period |
| `9c34cb4` bkl codex | 2026-08-28 18:44 +0100 | In period |
| WebMCP integration | 2026-08-28 | In period |

`096241b` was a single-file vanilla prototype: a `src/main.js` pan/zoom canvas
for Mermaid source, a stylesheet, and a verification script — 4,675 lines,
almost 3,250 of which were `package-lock.json`. It had **no WebMCP, no React, no
diagram adapters, no graph index, and no agent surface of any kind.**

Everything else — `git diff 096241b HEAD` is 6,268 insertions across 21 files —
was written inside the submission period.

## What WebMCP added during the submission period

All of the following is new work:

- `src/webmcp/` — the entire tool surface: registration, bounded graph queries,
  the persistent diagram library, and the agent activity log.
- `src/walkthrough/` — agent-authored, human-driven narrated tours.
- `docs/demo/checkout-architecture.md` — the demo architecture document.
- `scripts/test-webmcp.mjs` — 17 browser checks driving the tools through the
  real `document.modelContext` API.
- `tests/unit/webmcp.test.js` — 19 unit tests for the retrieval and library layers.
- The `atlasApi` seam in `src/viewer/controller.js`, plus the camera tween and
  source-history stack the walkthrough and patch tools depend on.

## The tool surface

Nine tools registered on `document.modelContext`:

| Tool | Purpose |
| --- | --- |
| `list_diagrams` | Enumerate every diagram catalogued from imported Markdown |
| `open_diagram` | Render one diagram and make it the active graph |
| `search_graph` | Bounded, ranked node lookup returning stable ids |
| `get_neighborhood` | Bounded BFS — dependencies, or dependents as blast radius |
| `trace_path` | Shortest-first routes between two nodes |
| `create_walkthrough` | Author a narrated tour the human steps through |
| `apply_patch` | Validated, line-targeted source edits |
| `undo_last_change` | Revert the last patch |
| `analyze_structure` | Cycles, orphans, entry points, dead ends |

### Why this is the right shape for WebMCP

The central design decision is that **Atlas is a graph retrieval layer, not a
document pipe.** A 20,000-edge diagram is several megabytes; handing that to a
model defeats the purpose of a tool that exists to make huge diagrams tractable.

So every query tool is bounded and reports its own truncation:

- `search_graph` caps at 50 results and returns `total` alongside `truncated`.
- `get_neighborhood` caps by both hop depth and a node budget.
- `trace_path` caps explored nodes and reports `complete: false` if it stopped early.

Node ids are the Mermaid source identifiers, so they are stable across renders
and across ELK/tidy-tree layout changes. Every node result carries its
`sourceLine`, which is what lets `apply_patch` target edits precisely without
the agent ever reading the whole file.

### Human control

- The agent authors a walkthrough; **the human drives it** with Back/Next, the
  progress dots, or the arrow keys. The agent cannot advance the tour.
- Every tool call appears in the on-screen activity log, so agent actions that
  change what someone is looking at are never invisible.
- `apply_patch` is parsed by Mermaid before it is committed. Invalid source is
  rejected with the parser error and **nothing changes**. Valid patches are
  snapshotted so `undo_last_change` always has somewhere to go.

## Running it

```sh
npm install
npm run dev
```

Open in **Chrome with `chrome://flags/#enable-webmcp-testing` enabled**, or in
the **ChatGPT in-app browser**, which supports WebMCP out of the box. In any
other browser the app lazily loads the `@mcp-b/global` polyfill so the page
still works; native builds never download it.

Then: **Open file** → `docs/demo/checkout-architecture.md`, and ask the agent to
trace how a checkout request reaches the payment database.

### Tests

```sh
npm test          # 27 unit tests
npm run test:e2e  # existing renderer + interaction coverage
npm run test:webmcp   # 17 checks through the real document.modelContext API
```

`npm run test:webmcp` imports the demo Markdown, drives all nine tools through
`document.modelContext.executeTool()`, steps the walkthrough with a real click
and a real arrow keypress, and asserts that an invalid patch leaves the source
untouched.

## License

MIT — see `LICENSE`.
