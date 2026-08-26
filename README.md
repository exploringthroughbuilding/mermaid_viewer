# Mermaid Atlas

A React browser workbench for very large Mermaid diagrams. It renders Mermaid source directly with
an increased edge allowance and ELK layout, then adds pan, zoom, search, node selection, and direct
neighbor navigation.

## Run

```sh
npm install
npm run dev
```

Open the URL Vite prints. Paste raw Mermaid source, paste Markdown containing one or more fenced
`mermaid` blocks, or use **Open file**.

## Controls

- Drag the canvas to pan.
- Scroll over the canvas to zoom around the pointer.
- Click a node to highlight it, its direct neighbors, and their connecting edges.
- Click a neighbor in the Selection panel to move focus to that node.
- Press `/` to search nodes and `Escape` to clear a selection.
- Press `Cmd+Enter` or `Ctrl+Enter` in the source editor to render.

Mermaid is configured with `maxEdges: 20000`, `maxTextSize: 5000000`, and the ELK flowchart renderer.
