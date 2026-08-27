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

## Open a diagram from a URL

The viewer reads its initial state from the address bar, so other tools, scripts and bookmarks can
open a diagram directly:

| Parameter | Effect |
| --- | --- |
| `?src=<url>` | Fetch Mermaid or Markdown from a URL. Same-origin paths such as `?src=/docs/flow.md` work out of the box; remote hosts need CORS. |
| `?example=<id>` | Load a catalog example, e.g. `?example=sequence-core`. |
| `?block=<n>` | Pick the n-th fenced `mermaid` block of a Markdown import (1-based). |
| `?select=<key or label>` | Select and zoom to a node once the diagram is rendered. |
| `?theme=dark` or `?theme=light` | Force the appearance for that visit. |
| `#pako:<data>` | Compressed source in the same format as mermaid.live, so links from either tool open in the other. |
| `#base64:<data>` / `#code:<data>` | mermaid.live JSON state, or base64url-encoded raw source. |

**Share link** in the toolbar copies a `#pako:` URL for the current source (and updates the address
bar). Changing the hash while the page is open loads the new source as well.

## Controls

- Drag the canvas to pan.
- Scroll over the canvas to zoom around the pointer.
- Click a node to highlight it, its direct neighbors, and their connecting edges. Everything else is
  dimmed; incoming relations are drawn dashed in purple, outgoing in green, and edge or message text
  takes the same colour.
- Nodes that are only an icon (architecture services, `@{ icon: ... }` shapes without a form, stick
  figure actors) get an outline box drawn around them; icons that already sit in a box get the box
  outlined and the glyph left alone.
- Selecting an indexed item scrolls to and highlights its first matching source line in the editor.
- Click a neighbor in the Selection panel to move focus to that node; the view only pans when the
  node is off screen.
- Click a Graph Index entry to select, center, and zoom to that node.
- Use `←` or `→` to browse incoming or outgoing relationships and `↑` and `↓` to preview alternatives.
  Browsing keeps the current zoom level and only pans (or zooms out as a last resort) to keep both
  nodes visible.
- Press `S` or `Enter` to select a previewed node, `Z` to zoom to the committed selection, and `Escape` to cancel a preview.
- Toggle the Graph Index between a flat list and groups. Groups come from the source (subgraphs,
  namespaces, composite states, sequence boxes, sections, kanban columns, architecture groups, C4
  boundaries, git branches, mindmap branches) and show nested paths such as `Backend › Store`.
- Press `/` to search nodes and `Escape` to clear a selection.
- Press `Cmd+Enter` or `Ctrl+Enter` in the source editor to render.
- Use the toolbar theme switch to toggle the persisted light or dark appearance. Both themes ship a
  full Mermaid palette (notes, gantt tasks, git branches, ER rows, timeline sections, pies, charts).

Mermaid is configured with `maxEdges: 20000`, `maxTextSize: 5000000`, and the ELK flowchart renderer.
The `@mermaid-js/layout-elk`, `@mermaid-js/layout-tidy-tree`, and `@mermaid-js/mermaid-zenuml`
packages are registered at startup. Diagram adapters parse source semantics independently from SVG
layout, so relationship direction and source lines remain stable across ELK and tidy-tree output.

Rendered nodes are bound to source items by exact key or label only. Edge endpoints are resolved from
`data-from`/`data-to` attributes, then from edge ids (`L_A_B_0`, `id_A_B_1`, `edge_0_1`), and finally
from geometry (where the path starts and ends), which is what state, C4 and ZenUML diagrams need.

## Development

Run `npm run dev` and open `/debug` for the development-only renderer laboratory. It renders every
fixture in the shared syntax catalog, displays pass/fail state inline, and exposes the source for
each specimen. The page covers built-in Mermaid families, C4 variants, ZenUML, every installed ELK
algorithm, and tidy-tree.

```sh
npm test
npm run test:e2e
npm run test:all
```

- `npm test` validates catalog IDs, adapter coverage, every parser family, URL state encoding, and
  the geometry index.
- `npm run test:e2e` exercises the viewer (highlighting per diagram family, icon outlines, zoom-stable
  navigation, URL and share-link launches) and requires every `/debug` specimen to render. It finds
  Chrome in puppeteer's cache or `/Applications`; set `CHROME_PATH` to use another binary.
- `npm run test:all` runs both suites.

The fixture catalog at `src/fixtures/diagram-fixtures.js` is the source of truth for viewer examples,
the debug laboratory, and automated coverage. Add or remove syntax there; contract tests catch
duplicate IDs, unsupported declarations, and missing adapter families.

## Structure

- `src/viewer/` contains the production workbench: `controller.js` wires the pieces, `node-detection.js`
  and `edge-detection.js` read the rendered SVG, `graph-model.js` merges source relations with drawn
  paths, `highlight.js` applies selection roles, `viewport.js` owns pan/zoom, `index-panel.js` renders
  the Graph Index, `url-state.js` handles launch parameters and share links, and `panels.js` keeps
  persisted preferences.
- `src/debug/` contains the development-only visual compatibility laboratory.
- `src/fixtures/` owns syntax examples and fixture metadata.
- `src/mermaid/` owns Mermaid/plugin configuration (`runtime.js` holds both theme palettes), the
  adapter registry, and one parser module per diagram family under `parsers/`.
- `tests/unit/` contains fast catalog and adapter contracts.
- `scripts/test-app.mjs` contains browser-level interaction and rendering coverage.
- `tests/fixtures/` contains repository-owned import fixtures; tests do not depend on local files elsewhere.
