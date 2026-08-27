# FORSAURANSH.md — how Mermaid Atlas works, and what we learned building it

This is the plain-language tour of the project: what it is, how the pieces fit, why they are
shaped the way they are, and the bugs that taught us something. Read it top to bottom once; after
that, jump to whichever section you're touching.

---

## 1. What the thing is

Mermaid Atlas is a **local workbench for very large Mermaid diagrams**. Mermaid itself is great at
turning text into an SVG, and terrible at letting you *explore* that SVG once it has 800 nodes.
Atlas wraps the renderer with the things a map app has: pan and zoom, a searchable index of every
node, "show me only this node and its neighbours", keyboard navigation along relationships, and a
link back to the exact source line that produced a node.

Think of Mermaid as a printer and Atlas as the light table you put the print on: the print doesn't
change, but now you have a loupe, a ruler and sticky notes.

---

## 2. The architecture in one picture

```
   source text ──► analyzeDiagram() ──► items / relations / groups   (what the text *means*)
        │                                          │
        ▼                                          ▼
   mermaid.render() ──► SVG ──► detectNodes() + detectEdges() ──► buildGraph()   (what was *drawn*)
                                                                        │
                    ┌───────────────────────────────────────────────────┤
                    ▼                    ▼                   ▼          ▼
              highlight.js         index-panel.js       viewport.js   selection panel
              (roles + dimming)    (Graph Index)        (pan/zoom)    (neighbours, source line)
```

Two independent readings of the diagram are merged:

1. **Semantic** — `src/mermaid/parsers/*` read the *source text* and produce items (nodes), relations
   (edges with direction and labels), and groups (subgraphs, sections, namespaces…). This is where
   source line numbers come from, and where direction is authoritative (`Animal <|-- Dog` means Dog
   points at Animal even though the arrowhead is drawn on Animal's side).
2. **Rendered** — `src/viewer/node-detection.js` and `edge-detection.js` read the *SVG Mermaid
   produced* and find the actual DOM elements: which `<g>` is a node, which `<path>` is an edge,
   which shape inside a node deserves a highlight stroke.

`graph-model.js` marries the two: a rendered node is bound to a source item by **exact** key or
label; a source relation borrows the drawn path between the same pair of nodes; anything drawn but
not in the source (or vice-versa) still survives as its own edge. The result is one `graph` object
(`nodes`, `edges`, `incoming`, `outgoing`, `groups`) that everything downstream uses.

### Why two readings and not one?

Because each one is wrong in a different way. The SVG knows exact geometry but has lost meaning
(state-diagram edges are literally `edge0`, `edge1`; ELK ids differ from dagre ids; icons are nested
`<svg>`s). The source knows meaning but nothing about pixels, and Mermaid's grammar is forgiving
enough that any regex we write will miss a shape someone uses tomorrow. Merging them means a miss on
one side degrades gracefully instead of breaking selection.

---

## 3. Directory map

| Path | Owns |
| --- | --- |
| `src/viewer/ViewerPage.jsx` | The static React shell (panels, toolbar, dialog). It only manages the theme. |
| `src/viewer/controller.js` | Imperative wiring: editor, examples, Markdown blocks, render pipeline, selection state, keyboard navigation, URL launch. |
| `src/viewer/node-detection.js` | Finds nodes in the SVG, names them, binds them to source items, chooses outline shapes (icons never get stroked). |
| `src/viewer/edge-detection.js` | Finds edges and resolves endpoints: data attributes → id tokens → geometry. |
| `src/viewer/graph-model.js` | Merges source relations with drawn edges; builds adjacency and index groups. |
| `src/viewer/highlight.js` | Applies roles (selected / parent / child / both / preview) and dimming; recolours arrow markers. |
| `src/viewer/viewport.js` | Pan, zoom, fit, "zoom here", and `reveal()` (the minimal camera move). |
| `src/viewer/index-panel.js` | Graph Index rendering (flat or grouped) with incremental active-row updates. |
| `src/viewer/url-state.js` | `?src`, `?example`, `?block`, `?select`, `?theme`, `#pako:` decoding and share-link encoding. |
| `src/viewer/panels.js` | Persisted preferences (pointer sensitivity, panel sizes, index settings) and the resizers. |
| `src/viewer/svg-geometry.js` | Screen boxes, path endpoints, and a grid index for "which node is at this point". |
| `src/mermaid/runtime.js` | Mermaid configuration and the full light/dark theme palettes. |
| `src/mermaid/diagram-adapters.js` | Registry: which grammar → which parser, mode (relational/ordered/canvas), selectors, vocabulary. |
| `src/mermaid/parsers/` | One module per family: `flowchart`, `class`, `state`, `sequence`, `hierarchy` (mindmap/kanban/gantt/timeline/journey/git), `misc` (ER/architecture/sankey/requirement/C4/wardley), `common` (shared helpers). |
| `tests/unit/` | Vitest suites for parsers, URL state, geometry and the fixture catalog. |
| `scripts/test-app.mjs` | The browser e2e: drives a real Chrome through every example and interaction. |

Vanilla-JS controller inside a React shell looks odd at first. The reason is practical: the hot
paths (thousands of SVG elements, pointer events at 60 fps) want direct DOM control, and React's
reconciliation would only get in the way. React handles the parts that benefit from declarative
markup (the static layout, the theme toggle).

---

## 4. The technologies, and why

- **Mermaid 11 + ELK layout plugin** — ELK gives dramatically better layouts for big flowcharts than
  dagre. It is also the slow part (see §7). ZenUML and tidy-tree plugins are registered too.
- **Vite** — instant dev server and the reason `?src=/tests/fixtures/large-flowchart.mmd` just works
  (Vite serves project files).
- **Vitest** — unit tests for everything that has no DOM.
- **puppeteer-core** — drives a real Chrome for the e2e. Real browser, real Mermaid, real SVG: the
  detection code can only be trusted against the actual DOM.
- **CSS custom properties for highlight colours** — `--role-selected`, `--role-incoming`, … live in
  `viewer.css` for light and dark, and `highlight.js` reads the same variables when it clones arrow
  markers. One palette, two consumers, no drift.
- **`CompressionStream`** — share links use the browser's native deflate so no `pako` dependency is
  needed, and the output is byte-compatible with mermaid.live's `#pako:` links.

---

## 5. Stories from the trenches (the bugs that taught us the most)

### 5.1 "Node B is labelled Circle, so its key must be C"

The original semantic matcher had a fallback: if no exact alias matched, accept a *substring* match.
That sounds friendly until node `B` (label "Circle") looks for a source item and finds `C`, because
the letter "c" is inside "circle". `B` was renamed to `C`, the real `C` was pushed onto `E`, and so on
down the alphabet — every relation quietly attached to the wrong node.

**Lesson:** fuzzy matching is a debt you pay with silent corruption. `matchSemanticItem` now matches
exact keys, exact normalised aliases, or a "letters and digits only" form — never substrings. If a
node has no source item, it simply has no source line; that's honest.

### 5.2 Icons wearing purple outlines

Highlight CSS used to target `.atlas-node path` — every path inside a node, including the paths of
the icon glyph nested in an `<svg>`. Selecting an architecture service outlined the little server
drawing in orange. Meanwhile flowchart `@{ icon: ... }` nodes weren't selectable at all, because
Mermaid renders them as `g.icon-shape`, not `g.node`.

**Fix:** `node-detection.js` decides *which shapes are the node's outline*: direct shape children and
Mermaid's roughjs wrapper groups, never nested `<svg>`s or label groups. If those shapes cover less
than about half the node (a naked icon, a stick-figure actor) it appends a synthetic invisible
`<rect>` and highlights that instead. Only elements carrying `.atlas-outline` ever get a stroke.

**Lesson:** when you style someone else's DOM, enumerate what you *want* rather than excluding what
you don't — you can't enumerate a renderer's future.

### 5.3 The 2,000-pixel-wide two-state diagram

The e2e emulates `prefers-reduced-motion` to keep camera moves synchronous. Suddenly every diagram
laid out with nodes thousands of pixels apart, and edge detection found nothing. The culprit was a
well-meaning accessibility rule already in the stylesheet:

```css
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: .01ms !important; } }
```

Mermaid measures text by inserting temporary elements into the document; a transition on `*`
apparently disturbs those measurements enough to corrupt the layout. Users with "reduce motion" on
in macOS would have seen broken diagrams all along.

**Lesson:** global `*` rules leak into code you don't own. Reduced-motion overrides are now scoped to
our own controls. And: emulate accessibility settings in tests — it found a real bug.

### 5.4 The benchmark that said "you made it slower"

The first version of the new highlighter benchmarked *worse* than the original on a 1,500-node
graph: a second selection took 2.9 s, clearing one took 3.6 s. Four causes stacked, and the last one
was the interesting one:

1. `getComputedStyle(edge).strokeWidth` was read for every highlighted edge *between* DOM writes —
   each read forces a full style recalculation of a 30,000-element SVG. Widths are now captured in
   one batch while the graph is built.
2. `transition: opacity` on thousands of nodes and edges meant every selection repainted the whole
   SVG for 120 ms of frames. Fades are now only enabled on small graphs (`.atlas-small`).
3. Clearing a selection restored arrow markers on *every* edge instead of the ones that were lit.
4. **`will-change: transform` locked the raster scale.** Chrome keeps a promoted layer's raster scale
   at the zoom it was first painted at. The new render pipeline yielded to the browser (so the
   "Laying out…" status could paint) *before* fitting the diagram, so a 15,000 px wide SVG was first
   painted at 1.25× and stayed rasterised at that size after the fit to 0.1×. Every later repaint
   re-rastered a ~20,000 px layer (the trace showed 1.9 s of GPU raster and a 1.3 s layer commit).
   The fix: fit *before* the first paint, and promote the stage to a compositor layer only while it
   is moving (`viewport.js` sets `will-change` on interaction and removes it ~300 ms after).

After the fixes, the same 1,500-node graph selects in ~20 ms of script plus ~100 ms of frames and
clears in ~60 ms — faster than the original.

**Lesson:** measure before believing, and when the numbers make no sense, trace. Chrome's tracing via
puppeteer (`page.tracing.start`) told in one run what an hour of theorising about CSS selectors could
not. The bench and trace scripts lived in the session scratchpad; recreate them whenever the
highlighter or viewport changes: render a generated graph, time select/clear/search, watch frame time
while panning.

### 5.5 The block picker that pointed at the wrong diagram

`?src=file.md&block=2` rendered block 2 but the dropdown showed block 1. `loadSource` set the
`<select>`'s value before its `<option>`s existed, so the browser dropped it.

**Lesson:** DOM writes have ordering constraints that plain data doesn't. Populate, then select.

---

## 6. How the highlighting works, end to end

1. Click a node → `controller.selectNode(key)`.
2. `highlight.select(graph, key)`:
   - Adds `atlas-has-selection` to the `<svg>` root. A single CSS rule dims every `.atlas-node`,
     `.atlas-edge`, `.atlas-edge-label` and `.atlas-companion` that is *not* `.atlas-lit`. One class
     write, one style recalc, no per-element loop over the whole graph.
   - Lights the selected node, its parents (`atlas-parent`, dashed purple), its children
     (`atlas-child`, green) or both (`atlas-bidirectional`, amber). "Companions" — a sequence
     participant's lifeline and bottom box, a gantt task's label — get the same role.
   - Paints the role colour inline on `.atlas-outline` shapes (C4 uses inline `!important` strokes
     that no stylesheet can beat).
   - Colours edges, their labels/message text, and clones arrow markers in the role colour (markers
     are `<defs>`; you can't restyle them from outside, so we copy them).
3. The selection panel lists neighbours with the diagram's own vocabulary ("Previous states",
   "Sends to"…), the group path ("in Backend › Store") and the source line.

Keyboard browsing previews a candidate (`atlas-preview`) and calls `viewport.reveal()`, which moves
the camera **only if needed**: nothing if both nodes are visible, a pan if they fit at the current
zoom, a zoom-out only as a last resort. That is the fix for "it zooms out when navigating from the
parent": the old code refit both nodes on every arrow press.

---

## 7. Performance notes

Numbers from a generated 1,500-node / 2,397-edge flowchart, headless Chrome, Apple Silicon. "Script"
is synchronous JavaScript; "frames" is how long the next two animation frames took (style, paint,
raster, commit):

| Operation | Before | After |
| --- | --- | --- |
| Second selection (click another node) | 13 ms script + 73 ms frames | 17 ms script + 98 ms frames |
| Clear selection | 13 ms script + 166 ms frames | 0 ms script + 63 ms frames |
| Search the index | 15 ms | 16 ms |
| Pan frame | 33 ms (measurement floor) | 33 ms (measurement floor) |

(At 600 nodes the second selection went from 129 ms to 60 ms; everything else was already at the
floor.) The render itself is ~9 s at 600 nodes and ~100 s at 1,500 nodes, and virtually all of it is
ELK's layout running on the main thread inside Mermaid. Dagre is not faster at that size (it exceeded
a 3-minute protocol timeout) and ELK's `SIMPLE` node placement saves only a few percent. What Atlas
does about it:

- Yields to the browser before calling Mermaid so "Laying out 1,500 items · 2,397 relations… large
  layouts can take a while" actually paints instead of a frozen tab.
- Fits the new diagram before its first paint, and promotes the stage to a compositor layer only
  while the view moves (see 5.4).
- Dropped the `filter: drop-shadow` on the whole SVG (filters force an offscreen surface every frame)
  and the hover filter on nodes.
- `contain: layout paint style` on the canvas so a pan never invalidates the rest of the page.
- Never writes `style.transition` on the stage unless it changes.
- The Graph Index is rebuilt only when its inputs change; selecting a node toggles one `active` class.

If layout time ever becomes the priority, the honest options are a Web Worker build of ELK (Mermaid's
plugin doesn't expose one) or rendering fewer nodes (collapsing subgraphs).

---

## 8. How to think about changes here

- **Start from the DOM, not from memory.** Every diagram family renders differently; before touching
  detection, render a fixture and look at the actual elements (`window.atlasDebug()` in dev exposes
  the graph model). Memory notes in this repo's Claude memory summarise what we found for Mermaid 11.17.
- **Prefer exact over clever.** Exact matching, explicit selectors per family, explicit CSS variables.
  Every "smart" fallback we removed had produced a wrong answer somewhere.
- **Batch reads, then write.** Layout thrash is the silent killer with big SVGs.
- **Tests are the spec.** `npm test` covers parsing and encoding; `npm run test:e2e` covers what a
  user sees. Add a fixture when you add syntax — the `/debug` page renders all of them.

---

## 9. Things to explore next

- Collapsing subgraphs into a single node for huge graphs (both a perf and a readability win).
- Registering icon packs (`mermaid.registerIconPacks`) so `fa:` icons render instead of the `?` box.
- A "Copy as PNG/SVG" export using the same share-link plumbing.
