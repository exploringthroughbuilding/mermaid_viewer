import { disposeLibrary, initialiseLibrary, tools } from "./tools.js";
import { announceReady, logToolCall } from "./activity-log.js";

let registration = null;
let mode = "unavailable";

/**
 * Chrome 146 and the ChatGPT in-app browser expose `document.modelContext`
 * natively. Everywhere else the polyfill is loaded lazily, so judges on a
 * native build never download it.
 */
async function ensureModelContext() {
  if (document.modelContext) return "native";
  try {
    await import("@mcp-b/global");
  } catch {
    return "unavailable";
  }
  return document.modelContext ? "polyfill" : "unavailable";
}

/**
 * Wrap every handler so that the human watching the page sees each call, and so
 * a thrown error becomes a readable tool result instead of an opaque rejection.
 */
function instrument(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    async execute(input = {}) {
      const call = logToolCall(tool.name, input);
      try {
        const result = await tool.execute(input);
        const text = result?.content?.[0]?.text ?? "";
        const failed = text.startsWith("ERROR:");
        const headline = text.split("\n")[0].slice(0, 120);
        if (failed) call.fail(headline);
        else call.succeed(headline);
        return result;
      } catch (error) {
        const message = String(error?.message || error);
        call.fail(message.slice(0, 120));
        return { content: [{ type: "text", text: `ERROR: ${tool.name} failed. ${message}` }] };
      }
    },
  };
}

export async function registerAtlasTools() {
  mode = await ensureModelContext();
  initialiseLibrary();
  if (mode === "unavailable") {
    console.info("[atlas] WebMCP unavailable. Enable chrome://flags/#enable-webmcp-testing or open in a WebMCP-capable browser.");
    return { mode, registered: [] };
  }

  // A fresh controller per call: an aborted signal stays aborted, so reusing
  // one would silently unregister everything on a second registration.
  registration?.abort();
  registration = new AbortController();

  const registered = [];
  for (const tool of tools) {
    try {
      await document.modelContext.registerTool(instrument(tool), { signal: registration.signal });
      registered.push(tool.name);
    } catch (error) {
      console.warn(`[atlas] could not register ${tool.name}`, error);
    }
  }

  announceReady(registered, mode);
  return { mode, registered };
}

export function unregisterAtlasTools() {
  registration?.abort();
  registration = null;
  disposeLibrary();
}

export function webmcpMode() {
  return mode;
}
