import { disposeLibrary, initialiseLibrary, tools } from "./tools.js";
import { announceReady, logToolCall } from "./activity-log.js";
import { atlasApi } from "../viewer/controller.js";

let registration = null;
let mode = "unavailable";

/**
 * Chrome 146 and the ChatGPT in-app browser expose `document.modelContext`
 * natively. Everywhere else the polyfill is loaded lazily, so judges on a
 * native build never download it.
 */
async function ensureModelContext() {
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
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
    async execute(input = {}) {
      const call = logToolCall(tool.name, input);
      try {
        const result = await tool.execute(input);
        const text = result?.content?.[0]?.text ?? "";
        const failed = result?.isError === true || text.startsWith("ERROR:");
        const headline = text.split("\n")[0].slice(0, 120);
        if (failed) call.fail(headline);
        else call.succeed(headline);
        return result;
      } catch (error) {
        const message = String(error?.message || error);
        call.fail(message.slice(0, 120));
        return {
          content: [{ type: "text", text: `ERROR: ${tool.name} failed. ${message}` }],
          structuredContent: {
            ok: false,
            summary: `${tool.name} failed.`,
            data: {},
            error: { message },
          },
          isError: true,
        };
      }
    },
  };
}

export async function registerAtlasTools() {
  // Avoid yielding during native startup: issue every registration before the
  // document-ready task can let a client take its first tool snapshot.
  mode = document.modelContext ? "native" : await ensureModelContext();
  initialiseLibrary();
  if (mode === "unavailable") {
    atlasApi.markAgentToolsReady();
    console.info("[atlas] WebMCP unavailable. Enable chrome://flags/#enable-webmcp-testing or open in a WebMCP-capable browser.");
    return { mode, registered: [] };
  }

  // A fresh controller per call: an aborted signal stays aborted, so reusing
  // one would silently unregister everything on a second registration.
  registration?.abort();
  registration = new AbortController();

  const registrations = tools.map(async (tool) => {
    try {
      await document.modelContext.registerTool(instrument(tool), { signal: registration.signal });
      return tool.name;
    } catch (error) {
      console.warn(`[atlas] could not register ${tool.name}`, error);
      return null;
    }
  });
  const registered = (await Promise.all(registrations)).filter(Boolean);

  announceReady(registered, mode);
  atlasApi.markAgentToolsReady();
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
