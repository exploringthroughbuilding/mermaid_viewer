# Mermaid Interaction Remediation Plan

## Purpose

Restore accurate selection, grouping, and relationship highlighting for every
supported Mermaid family. The current implementation assumes that all diagrams
use flowchart node wrappers and edge paths. That assumption causes three
classes of failure:

- Broad CSS highlights every descendant `rect`, `path`, `polygon`, or `circle`,
  including decoration and icon fills rather than the visual part that denotes
  the selected item.
- Only `path.flowchart-link` and `g.edgePath path` are discovered as edges, so
  most relational diagrams retain source relationships but cannot highlight
  their rendered links.
- Generic selector, key, and bounding-box heuristics misidentify targets and
  groups for diagram renderers with a different SVG structure.

This is a remediation plan only. Do not claim an adapter is complete until its
fixture-level interaction contract and browser tests pass.

## Target Model

Replace the `selectors` plus controller heuristics with an adapter-owned
extraction result:

```js
{
  targets: [{
    rendererKey,
    key,
    label,
    sourceLine,
    element,        // receives click, focus, dim, and ARIA state
    paintParts,     // exact SVG elements that receive selection styling
    groupKeys,
  }],
  edges: [{
    id,
    from,
    to,
    sourceLine,
    pathParts,      // visual line or path parts
    arrowParts,
    labelParts,
  }],
  groups: [{
    key,
    label,
    parentKey,
    memberKeys,
    elementParts,
  }],
}
```

Rules for every adapter:

- Keep renderer identity, semantic/source identity, and display label separate.
- Use source membership first, DOM ancestry second, and screen geometry only
  when the match is unique and explicitly tested.
- Match directed relations exactly. Preserve parallel edges by renderer edge ID
  and source line.
- A selectable wrapper does not imply that all of its children are highlighted.
  `paintParts` is the sole source of visual selection styling.
- If an adapter cannot identify a visual edge reliably, expose semantic
  navigation without highlighting a guessed line. Promote it to visual-edge
  support only after a stable extractor and test exist.

## Implementation Order

### Phase 0: Establish The Interaction Contract

1. Add fixture metadata for expected targets, groups, semantic relations,
   visual-edge support, and intentional exclusions.
2. Create an SVG inspection helper used only by tests to print candidate IDs,
   classes, data attributes, and shape kinds for a fixture.
3. Add a browser assertion that every non-canvas fixture has the expected
   target count and source-line mapping.
4. Add a browser assertion that no unintended wrapper, label, axis, note,
   pseudostate, or duplicate marker is selectable.
5. Keep the current controller behavior behind the new test contracts only
   long enough to migrate one adapter at a time; do not add more generic
   fallback heuristics.

Exit criteria: the catalog declares the expected interaction level for all
fixtures, and the test suite can report a missing target, group, or edge by
adapter and fixture ID.

### Phase 1: Build The Shared Interaction Layer

1. Move SVG extraction out of `indexRenderedGraph()` in
   `src/viewer/controller.js` and into adapter-specific extractors.
2. Replace global `canonical()` identity logic with per-adapter renderer-key
   extractors. In particular, do not strip trailing numeric IDs; this currently
   collapses Sankey `node-1`, `node-2`, and similar IDs.
3. Store `paintParts` on each target and path, arrow, and label parts on each
   edge.
4. Change click, keyboard focus, zoom, index rendering, source-line
   highlighting, and dimming to read the shared target model.
5. Remove the text-nearest-`g` fallback. An adapter must explicitly opt in to
   synthetic text targets when its renderer has no node wrapper.
6. Replace geometric `g.cluster` membership as the default grouping approach
   with adapter-provided source or DOM ancestry membership.

Exit criteria: one migrated adapter can select, focus, zoom, group, dim, and
highlight through the new model without relying on the legacy generic selector
path.

### Phase 2: Fix Visual Highlighting

1. Replace the broad descendant selectors in `src/viewer/viewer.css` with
   classes on explicit `paintParts` and edge parts.
2. Define state styles for selected, parent, child, bidirectional, preview,
   incoming edge, and outgoing edge without enumerating SVG tag names.
3. Preserve the original stroke, fill, dash array, and stroke width when a
   state is removed.
4. For icon-based diagrams, style the real painted icon strokes (`path`,
   `line`, `polyline`, `ellipse`, or `circle` where their computed stroke is
   visible). Do not draw an invented rectangular selection box.
5. For filled cards and task bars, select the renderer's real container shape;
   do not style labels, dividers, or unrelated nested decoration.
6. Add browser checks for both themes and verify that selected architecture
   icons change their actual strokes while their label/backdrop rectangles are
   not incorrectly restyled.

Exit criteria: a selected item changes only the adapter-defined visual parts,
and clearing selection restores the untouched SVG presentation.

### Phase 3: Migrate Relational Families With Stable Rendered Edges

Complete these families first because they have reliable target and relation
IDs or data attributes. Each completed family must support source-linked
selection, groups where applicable, directed relationship navigation, and
visual relationship highlighting.

| Family | Target and identity plan | Edge and grouping plan | Status |
| --- | --- | --- | --- |
| Flowchart and graph alias | `g.node`; use renderer data/ID suffixes without global normalization. | `path.flowchart-link[data-id]`; preserve parallel IDs. Use nested cluster ancestry and source subgraphs. | Planned |
| Flowchart ELK variants | Same target contract as flowchart. | Verify ELK edge IDs for every installed ELK layout before sharing the flowchart extractor. | Planned |
| Swimlane | `g.node`, excluding lane structure. | Flowchart-link extractor plus lane/source membership rather than bounding boxes. | Planned |
| Architecture | `g.architecture-service` and explicit group background/label parts. | Parse architecture edge IDs and source ports/groups. Highlight icon stroke parts, never an imaginary service box. | Planned |
| Sequence | Participant/actor wrappers keyed by `data-id` or `name`. | Use message `data-from` and `data-to`; exclude notes, activation bars, and duplicate bottom actors. | Planned |
| Class | Explicit class node wrappers and class IDs. | Parse `path.relation` IDs, including labels and cardinality decorations. Add namespace/package groups. | Planned |
| ER | Entity wrappers keyed by entity identity. | Parse `path.relationshipLine` IDs with cardinality/label parts. | Planned |
| Requirement | Explicit rendered node wrappers, not a text fallback. | Parse requirement relationship IDs and exclude edge-label groups. | Planned |
| Mindmap and tidy-tree | `g.node.mindmap-node`, preserving ordinal renderer IDs. | Use `path.edge[data-id]`, then map source hierarchy to visual IDs. | Planned |

Exit criteria: selection of each target highlights only its configured paint
parts and highlights the exact incoming/outgoing edge parts in the direction
declared by the source.

### Phase 4: Migrate Relational Families Requiring Dedicated Probes

These families need fixture expansion or renderer-specific probes before
visual-edge highlighting can be trusted.

| Family | Target and identity plan | Edge and grouping plan | Status |
| --- | --- | --- | --- |
| Block | Use visible `g.node.flowchart-label`; exclude structural composite group nodes. | Probe block-specific edge IDs and source blocks. Semantic navigation first; add visual edges after IDs are stable. | Planned |
| ZenUML | Use participant wrappers keyed by `data-participant`. | Parse call/return source semantics. Match message lines by validated order and geometry only when unique. | Planned |
| State | Explicit simple and composite state targets; exclude pseudostates and notes. | Probe `path.transition`, composite ancestry, and note edges before visual association. | Planned |
| Sankey | Pair node rectangles with external labels by tested unique geometry. | Keep source relations. Attach `g.link > path` only when both endpoints are uniquely resolvable. | Planned |
| TreeView | Create explicit synthetic text targets and associated tree connector parts. | Source indentation supplies the hierarchy; do not fabricate visual edge IDs. | Planned |
| Treemap | Use `g.treemapSection` and `g.treemapNode.treemapLeafGroup`. | Sections are groups; area containment is hierarchy, not directional graph edges. | Planned |
| Ishikawa | Use head, label, and sub-group wrappers as explicit targets. | Source indentation supplies causes; connector-line association is semantic-only until stable. | Planned |
| Wardley | Use `g.wardley-node`, never the map, axes, or stages. | Add native parser for anchors, components, evolution, notes, and links. Use geometry only for unique line endpoints. | Planned |
| Gantt | `rect.task`, keyed by declared ID with ordinal fallback for autogenerated milestones. | Source dependencies and sections are authoritative. Keep visual dependency highlight disabled until a stable rendered dependency exists. | Planned |
| C4 | Explicit `g.node.c4-shape` targets with boundary membership. | Extend parser for Dynamic relations such as `RelIndex`; add a dedicated boundary/edge probe before visual edges. | Planned |

Exit criteria: every family has an explicit target extractor and correct source
navigation. Any family without trusted visual edges reports semantic-only
behavior in code and tests, rather than silently pretending to highlight one.

### Phase 5: Migrate Ordered, Selectable Families

Ordered diagrams are selectable and source-linked but do not expose
parent/child navigation. Each should have useful group membership and exact
paint parts.

| Family | Target and grouping plan | Status |
| --- | --- | --- |
| Kanban | Task cards from `g.items > g.node`; columns from `g.sections > g.cluster`. Preserve source metadata. | Planned |
| Event Modeling | `g.em-box` targets and `g.em-swimlane` groups. Treat `path.em-relation` as decorative unless product semantics explicitly promote it. | Planned |
| Timeline | Build one composite target per source event from task/event wrappers; sections are groups. Exclude period and section fragments. | Planned |
| Git graph | Select only primary commit circles, excluding duplicate merge markers; branches are groups. | Planned |
| Journey | Bind task rectangles to source task text and associated actor/face parts; sections are groups. | Planned |
| Packet | Use direct `rect.packetBlock` targets and source bit-range/order mappings. | Planned |
| Railroad, EBNF, ABNF, PEG | Use `g.railroad-rule` keyed by the rule-name group; internal terminals and choices are paint parts, not separate index entries. | Planned |

Exit criteria: selecting an ordered item highlights only its real visual parts,
zooms to it, and maps it to the correct source line. No relationship UI is
shown.

### Phase 6: Preserve Canvas-Only Families Deliberately

Pie, quadrant chart, XY chart, radar, Venn, Cynefin, and Info remain
canvas-only. They retain rendering, pan, and zoom but do not appear in the
graph index or relationship inspector. Optional tooltips or data exploration
are separate product work and must not reuse graph-navigation semantics.

Exit criteria: tests assert that no accidental text, axes, slices, or chart
marks become selectable graph nodes.

### Phase 7: Retire Legacy Heuristics

1. Delete generic `renderedNodes()`, global ID canonicalization, and
   flowchart-only edge discovery once all adapters have explicit extractors.
2. Delete broad CSS rules that target descendant SVG shape names.
3. Move semantic parsers that remain regex-based into per-family parsers with
   fixture coverage for labels, aliases, duplicate labels, parallel relations,
   reverse arrows, nested groups, and source frontmatter.
4. Update README documentation to describe the interaction levels:
   visual-relational, semantic-relational, ordered, and canvas-only.

## Family-by-Family Test Matrix

For every non-canvas fixture:

1. Render through the full viewer, not only Mermaid's debug renderer.
2. Assert target keys, labels, source lines, group memberships, and exclusions.
3. Click each target and verify selected, dimmed, focused, and zoom states.
4. For visual-relational adapters, select a middle node and assert exact
   incoming/outgoing path, arrow, and label parts receive role classes.
5. For semantic-only relational adapters, assert correct neighbors but assert
   no unrelated visual edge gains a highlight class.
6. Test selected targets in light and dark mode.
7. Test duplicate labels, nested groups, parallel and reversed edges, and
   renderer ID nondeterminism without using full SVG snapshots.

Additional required probes:

- Architecture service icons: verify visible icon strokes are highlighted and
  background/label rectangles are not used as proxy outlines.
- Sankey: verify `node-1` through `node-N` remain distinct identities.
- Timeline: verify one target per source event, not one target per rendered
  period or wrapper fragment.
- State: verify initial/final states, notes, and transitions are excluded or
  intentionally modeled.
- Git graph: verify merge decorations do not create duplicate commit targets.

## Delivery Checkpoints

1. Land Phase 0 and Phase 1 with one flowchart migration as the reference
   implementation.
2. Land Phase 2 and Phase 3 in small, family-scoped changes, starting with
   flowchart, swimlane, architecture, and sequence.
3. Land Phase 4 only after each renderer-specific DOM probe is captured in a
   fixture test.
4. Land Phase 5 and Phase 6, then remove legacy fallbacks in Phase 7.
5. Run `npm test`, `npm run build`, and `npm run test:e2e` after every family
   migration. The browser suite must include the complete fixture catalog and
   adapter-specific interaction expectations before declaring the work done.
