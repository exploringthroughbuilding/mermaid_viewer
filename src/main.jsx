import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import App from "./App.jsx";
import { initializeController } from "./viewer/controller.js";
import { registerAtlasTools, unregisterAtlasTools } from "./webmcp/registry.js";

const root = createRoot(document.querySelector("#app"));
flushSync(() => root.render(<App />));

// Module scripts delay the document ready/load boundary until top-level awaits
// settle. Mount the workbench first so its DOM exists, then finish WebMCP
// registration before an external client can take its initial tool snapshot.
if (window.location.pathname !== "/debug") {
  try {
    initializeController();
    const { mode, registered } = await registerAtlasTools();
    console.info(`[atlas] WebMCP ${mode}: ${registered.length} tools`);
    if (import.meta.hot) import.meta.hot.dispose(unregisterAtlasTools);
  } catch (error) {
    console.error("[atlas] WebMCP setup failed", error);
  }
}
