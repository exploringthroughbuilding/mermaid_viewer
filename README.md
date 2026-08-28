# Mermaid Atlas

A React browser workbench for very large Mermaid diagrams. It renders Mermaid source directly with
an increased edge allowance, then adds pan, zoom, search, source-linked item selection, and direct
neighbor navigation.

## Run

```sh
npm install
npm run dev
```

Open the URL Vite prints. Paste raw Mermaid source, paste Markdown containing one or more fenced
`mermaid` blocks, or use **Open file**. Markdown imports expose the selected block as editable raw
Mermaid source and retain the diagram picker for switching blocks.
The Examples menu includes flowcharts, sequence, ZenUML, class, state, ER, Gantt, pie, mindmap,
timeline, Git, quadrant, XY, block, and architecture diagrams. Dedicated examples exercise the ELK
and tidy-tree layout plugins.

Examples are grouped by interaction model. Relationship diagrams support directional navigation;
timeline and Git examples support item selection, source lookup, and zoom without inventing
parent/child links; aggregate charts use the canvas controls without a graph index.

## Agent collaboration (WebMCP)

Atlas registers nine tools on `document.modelContext`, so an AI agent can
investigate the graph you are looking at while you stay in control of the view.

| Tool | Purpose |
| --- | --- |
| `list_diagrams` | Enumerate diagrams catalogued from imported Markdown |
| `open_diagram` | Render one diagram and make it the active graph |
| `search_graph` | Bounded, ranked node lookup returning stable ids |
| `get_neighborhood` | Bounded BFS — dependencies, or dependents as blast radius |
| `trace_path` | Shortest-first routes between two nodes |
| `create_walkthrough` | Author a narrated tour the human steps through |
| `apply_patch` | Validated, line-targeted source edits |
| `undo_last_change` | Revert the last patch |
| `analyze_structure` | Cycles, orphans, entry points, dead ends |

Atlas acts as a **graph retrieval layer, not a document pipe**: every query is
capped and reports its own truncation, so a 20,000-edge diagram never has to be
sent to a model. Node ids are the Mermaid source identifiers, and every result
carries its `sourceLine`, which is how `apply_patch` targets edits precisely.

Agent edits are validated by the Mermaid parser before they are committed — an
invalid patch changes nothing — and every applied patch is snapshotted for
`undo_last_change`. Every tool call is shown in the on-screen activity log.

Walkthroughs are authored by the agent but **driven by you**: step with the
floating bar, the progress dots, or the arrow keys.

Requires **Chrome with `chrome://flags/#enable-webmcp-testing`** or the
**ChatGPT in-app browser**. Elsewhere the `@mcp-b/global` polyfill is lazily
loaded so the page still works; native builds never download it.

Try it: **Open file** → `docs/demo/checkout-architecture.md`, then ask the agent
to trace how a checkout request reaches the payment database.

See `WEBMCP_SUBMISSION.md` for the design rationale and prior-work disclosure.

## Controls

- Drag the canvas to pan.
- Scroll over the canvas to zoom around the pointer.
- Click a node to highlight it, its direct neighbors, and their connecting edges.
- Selecting an indexed item scrolls to and highlights its first matching source line in the editor.
- Click a neighbor in the Selection panel to move focus to that node.
- Click a Graph Index entry to select, center, and zoom to that node.
- Use `←` or `→` to browse incoming or outgoing relationships and `↑` and `↓` to preview alternatives.
- Press `S` or `Enter` to select a previewed node, `Z` to zoom to the committed selection, and `Escape` to cancel a preview.
- Toggle the Graph Index between a flat list and Mermaid subgraph groups, with name or connection-count sorting.
- Press `/` to search nodes and `Escape` to clear a selection.
- Press `Cmd+Enter` or `Ctrl+Enter` in the source editor to render.
- Use the toolbar theme switch to toggle the persisted light or dark appearance.

Mermaid is configured with `maxEdges: 20000`, `maxTextSize: 5000000`, and the ELK flowchart renderer.
The `@mermaid-js/layout-elk`, `@mermaid-js/layout-tidy-tree`, and `@mermaid-js/mermaid-zenuml`
packages are registered at startup. Diagram adapters parse source semantics independently from SVG
layout, so relationship direction and source lines remain stable across ELK and tidy-tree output.

## Development

Run `npm run dev` and open `/debug` for the development-only renderer laboratory. It renders every
fixture in the shared syntax catalog, displays pass/fail state inline, and exposes the source for
each specimen. The page covers built-in Mermaid families, C4 variants, ZenUML, every installed ELK
algorithm, and tidy-tree.

```sh
npm test
npm run test:e2e
npm run test:webmcp
npm run test:all
```

- `npm test` validates catalog IDs, adapter coverage, source-line semantics, layout fixtures,
  the Markdown diagram library, and the bounded graph-query layer.
- `npm run test:e2e` exercises the viewer and requires every `/debug` specimen to render.
- `npm run test:webmcp` drives all nine tools through the real `document.modelContext` API,
  steps a walkthrough with real input, and asserts an invalid patch leaves the source untouched.
- `npm run test:all` runs all three suites.

The fixture catalog at `src/fixtures/diagram-fixtures.js` is the source of truth for viewer examples,
the debug laboratory, and automated coverage. Add or remove syntax there; contract tests catch
duplicate IDs, unsupported declarations, and missing adapter families.

## Structure

- `src/viewer/` contains the production workbench, its imperative interaction controller, and the
  `atlasApi` seam that the agent tools drive it through.
- `src/webmcp/` owns the WebMCP tool surface, bounded graph queries, the diagram library, and the
  agent activity log.
- `src/walkthrough/` owns agent-authored, human-driven narrated tours.
- `src/debug/` contains the development-only visual compatibility laboratory.
- `src/fixtures/` owns syntax examples and fixture metadata.
- `src/mermaid/` owns Mermaid/plugin configuration and semantic adapters.
- `tests/unit/` contains fast catalog and adapter contracts.
- `scripts/test-app.mjs` contains browser-level interaction and rendering coverage.
- `tests/fixtures/` contains repository-owned import fixtures; tests do not depend on local files elsewhere.

## License

MIT — see `LICENSE`.
