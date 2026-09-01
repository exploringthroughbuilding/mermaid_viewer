import { useEffect, useState } from "react";
import "./viewer.css";

const themeStorageKey = "mermaid-atlas-theme:v1";

function loadTheme() {
  try {
    return localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export default function App() {
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => {
    let unregister;
    let cancelled = false;
    // The controller is imported for its side effects first; the WebMCP layer
    // depends on the workbench already owning the DOM.
    void import("./controller.js")
      .then(() => import("../webmcp/registry.js"))
      .then(async ({ registerAtlasTools, unregisterAtlasTools }) => {
        if (cancelled) return;
        unregister = unregisterAtlasTools;
        const { mode, registered } = await registerAtlasTools();
        console.info(`[atlas] WebMCP ${mode}: ${registered.length} tools`);
      })
      .catch((error) => console.error("[atlas] WebMCP setup failed", error));
    return () => {
      cancelled = true;
      unregister?.();
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch {
      // The selected theme still applies when browser storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent("atlas-theme-change", { detail: { theme } }));
  }, [theme]);

  const isDark = theme === "dark";

  return (
    <div className="app-root" data-theme={theme}>
      <main className="workbench">
        <aside className="rail" aria-label="Diagram controls">
          <header className="brand">
            <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" />
            <div>
              <p className="eyebrow">Local graph workbench</p>
              <h1>Mermaid Atlas</h1>
            </div>
          </header>

          <section className="source-panel">
            <div className="section-heading">
              <label htmlFor="source">Mermaid source</label>
              <span id="source-size">0 chars</span>
            </div>
            <div className="source-editor">
              <div id="source-line-highlight" aria-hidden="true" />
              <textarea id="source" spellCheck="false" aria-describedby="source-help" />
            </div>
            <p id="source-help" className="hint">Paste raw Mermaid or Markdown containing fenced Mermaid blocks.</p>
            <div id="block-picker-wrap" className="block-picker-wrap" hidden>
              <label htmlFor="block-picker">Diagram in Markdown</label>
              <select id="block-picker" />
            </div>
            <div className="source-actions">
              <label className="file-button" htmlFor="file-input">Open file</label>
              <input id="file-input" type="file" accept=".mmd,.mermaid,.md,.markdown,.txt" />
              <select id="example-picker" aria-label="Load example diagram">
                <option value="">Load diagram</option>
              </select>
              <button id="render" className="primary" type="button">Render diagram</button>
            </div>
          </section>

          <div className="panel-resizer" data-resize="source" role="separator" aria-label="Resize Mermaid source section" aria-orientation="horizontal" tabIndex="0"><span /></div>

          <section className="index-panel" aria-labelledby="index-title">
            <div className="section-heading">
              <h2 id="index-title">Graph index</h2>
              <span id="graph-stats">Not rendered</span>
            </div>
            <div className="index-tools">
              <label className="search">
                <span aria-hidden="true">⌕</span>
                <input id="node-search" type="search" placeholder="Find a node" autoComplete="off" />
                <kbd>/</kbd>
              </label>
              <button id="group-index" className="index-mode" type="button" aria-pressed="false" aria-label="Group nodes by Mermaid subgraph" title="Group nodes by Mermaid subgraph">
                <span aria-hidden="true"><i /><i /></span>
              </button>
              <label className="index-sort-control" htmlFor="index-sort">
                <select id="index-sort" defaultValue="label-asc" aria-label="Sort graph index">
                  <option value="label-asc">Name A–Z</option>
                  <option value="label-desc">Name Z–A</option>
                  <option value="connections-desc">Most connected</option>
                  <option value="connections-asc">Least connected</option>
                </select>
              </label>
            </div>
            <div id="node-list" className="node-list empty-state">Render a diagram to build its index.</div>
          </section>

          <div className="panel-resizer" data-resize="index" role="separator" aria-label="Resize Graph Index and Selection sections" aria-orientation="horizontal" tabIndex="0"><span /></div>

          <section className="inspector" aria-live="polite">
            <div className="section-heading">
              <h2>Selection</h2>
              <button id="clear-selection" className="text-button" type="button" disabled>Clear</button>
            </div>
            <div id="selection-content" className="empty-state">Select any node to isolate its immediate connections.</div>
          </section>
        </aside>

        <div id="sidebar-resizer" className="sidebar-resizer" role="separator" aria-label="Resize sidebar width" aria-orientation="vertical" tabIndex="0"><span /></div>

        <section className="canvas-shell" aria-label="Rendered diagram">
          <header className="canvas-toolbar">
            <div className="status-group">
              <span id="status-dot" className="status-dot idle" />
              <span id="status">Ready for source</span>
            </div>
            <div className="toolbar-actions">
              <button id="zoom-out" type="button" title="Zoom out" aria-label="Zoom out">−</button>
              <output id="zoom-level" aria-label="Current zoom">100%</output>
              <button id="zoom-in" type="button" title="Zoom in" aria-label="Zoom in">+</button>
              <button id="fit" type="button">Fit graph</button>
              <button id="actual-size" type="button">100%</button>
              <button id="open-settings" type="button" title="Interaction settings" aria-label="Open interaction settings">Controls</button>
              <button
                className="theme-toggle"
                type="button"
                aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
                aria-pressed={isDark}
                onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
              >
                <span className="theme-toggle-track" aria-hidden="true"><i /></span>
                <span className="theme-toggle-label">{isDark ? "Light" : "Dark"}</span>
              </button>
            </div>
          </header>
          <div id="viewport" className="viewport" tabIndex="0">
            <div className="grid-plane" aria-hidden="true" />
            <div id="stage" className="stage" />
            <div id="canvas-empty" className="canvas-empty">
              <div className="empty-glyph" aria-hidden="true"><span /><span /><span /><span /></div>
              <p>Paste a graph, then render it here.</p>
              <small>Drag to move · scroll to zoom · click a node to inspect</small>
            </div>
          </div>
          <footer className="canvas-footer">
            <button
              id="agent-activity-trigger"
              className="agent-activity-trigger idle"
              type="button"
              aria-haspopup="dialog"
              aria-controls="agent-activity-dialog"
              aria-label="Open agent activity. No agent actions yet."
              disabled
            >
              <span className="agent-activity-dot" aria-hidden="true" />
              <span className="agent-activity-label">Agent</span>
              <code id="latest-agent-action" aria-live="polite">No actions yet</code>
              <span id="latest-agent-time" className="agent-activity-time" />
            </button>
            <span>←→ relation · ↑↓ browse · S select · Z zoom</span>
          </footer>
        </section>
      </main>

      <dialog id="settings-dialog" className="settings-dialog">
        <form method="dialog">
          <header>
            <div>
              <p className="eyebrow">Canvas controls</p>
              <h2>Interaction settings</h2>
            </div>
            <button value="close" className="dialog-close" aria-label="Close settings">×</button>
          </header>
          <div className="setting-control">
            <div className="setting-label">
              <label htmlFor="zoom-sensitivity">Zoom and pinch sensitivity</label>
              <output id="zoom-sensitivity-value">1.00×</output>
            </div>
            <input id="zoom-sensitivity" type="range" min="0.25" max="3" step="0.05" defaultValue="1" />
            <p>Controls mouse-wheel zoom and native trackpad pinch acceleration.</p>
          </div>
          <div className="setting-control">
            <div className="setting-label">
              <label htmlFor="pan-sensitivity">Drag movement sensitivity</label>
              <output id="pan-sensitivity-value">1.00×</output>
            </div>
            <input id="pan-sensitivity" type="range" min="0.25" max="2.5" step="0.05" defaultValue="1" />
            <p>Controls how far the graph moves for the same pointer distance.</p>
          </div>
          <div className="setting-control device-control">
            <div className="setting-label">
              <label htmlFor="pointer-device">Scroll gesture behavior</label>
            </div>
            <select id="pointer-device" defaultValue="trackpad">
              <option value="trackpad">Trackpad: scroll pans, pinch zooms</option>
              <option value="mouse">Mouse: wheel zooms</option>
            </select>
            <p>Trackpad mode applies movement sensitivity to two-finger scrolling.</p>
          </div>
          <footer>
            <button id="reset-settings" type="button">Reset defaults</button>
            <button value="done" className="primary">Done</button>
          </footer>
        </form>
      </dialog>

      <dialog id="agent-activity-dialog" className="settings-dialog agent-activity-dialog" aria-labelledby="agent-activity-title">
        <form method="dialog">
          <header>
            <div>
              <h2 id="agent-activity-title">Agent activity</h2>
            </div>
            <div className="agent-activity-dialog-actions">
              <span id="agent-activity-count" className="agent-activity-count">0 actions</span>
              <button value="close" className="dialog-close" aria-label="Close agent activity">×</button>
            </div>
          </header>
          <div className="agent-activity-dialog-body">
            <ol id="agent-activity-list" className="agent-activity-list" aria-live="polite">
              <li className="agent-activity-empty">Agent tool calls will appear here.</li>
            </ol>
          </div>
          <footer>
            <p>Newest action first</p>
            <button value="done" className="primary">Done</button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
