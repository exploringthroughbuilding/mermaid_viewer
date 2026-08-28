import puppeteer from "puppeteer-core";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { discoverChrome } from "./discover-chrome.mjs";

const demoDoc = fileURLToPath(new URL("../docs/demo/checkout-architecture.md", import.meta.url));
const checks = [];

function check(name, passed, detail = "") {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "  ok" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const server = await createServer({ server: { host: "127.0.0.1", port: 4175 }, logLevel: "error" });
let browser;

try {
  await server.listen();
  browser = await puppeteer.launch({
    executablePath: discoverChrome(),
    headless: true,
    args: ["--enable-features=WebMCP,WebMachineLearningModelContext", "--enable-blink-features=WebMCP"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 950 });
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`    [browser error] ${message.text()}`);
  });

  // Native Chrome exposes getTools(); the polyfill exposes listTools().
  await page.evaluateOnNewDocument(() => {
    window.listRegisteredTools = async () => {
      const mc = document.modelContext;
      try {
        return await mc.getTools();
      } catch {
        return await mc.listTools();
      }
    };
  });

  await page.goto("http://127.0.0.1:4175/", { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("#stage svg"), { timeout: 30000 });

  // --- registration -------------------------------------------------------
  await page.waitForFunction(() => Boolean(document.modelContext), { timeout: 20000 });
  const registered = await page.evaluate(async () => {
    const tools = await listRegisteredTools();
    return tools.map((tool) => tool.name);
  });
  const expected = [
    "list_diagrams", "open_diagram", "search_graph", "get_neighborhood",
    "trace_path", "create_walkthrough", "apply_patch", "undo_last_change", "analyze_structure",
  ];
  const missing = expected.filter((name) => !registered.includes(name));
  check("all tools registered via document.modelContext", missing.length === 0, missing.length ? `missing ${missing}` : `${registered.length} tools`);

  const call = async (name, input = {}) => page.evaluate(async (toolName, args) => {
    const tools = await listRegisteredTools();
    const tool = tools.find((candidate) => candidate.name === toolName);
    if (!tool) return { text: `ERROR: tool ${toolName} is not registered` };
    // A RegisteredTool carries its owner window and origin; Chrome's native
    // convention passes arguments as a JSON string, so try that first.
    const descriptor = { ...tool, origin: tool.origin ?? location.origin, window };
    let raw;
    try {
      raw = await document.modelContext.executeTool(descriptor, JSON.stringify(args));
    } catch {
      raw = await document.modelContext.executeTool(descriptor, args);
    }
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { text: result?.content?.[0]?.text ?? "" };
  }, name, input);

  const payloadOf = (text) => {
    const brace = text.indexOf("\n\n");
    if (brace < 0) return null;
    try { return JSON.parse(text.slice(brace + 2)); } catch { return null; }
  };

  // --- markdown import ----------------------------------------------------
  const fileInput = await page.$("#file-input");
  await fileInput.uploadFile(demoDoc);
  await page.waitForFunction(() => document.querySelector("#stage svg"), { timeout: 30000 });

  const listed = await call("list_diagrams");
  const library = payloadOf(listed.text);
  const titles = library?.diagrams?.map((entry) => entry.title) ?? [];
  check("list_diagrams sees every Markdown block by heading", titles.length === 4, titles.join(" | "));

  const topologyId = library?.diagrams?.find((entry) => entry.title === "Service Topology")?.id;
  const opened = await call("open_diagram", { diagramId: topologyId });
  const topology = payloadOf(opened.text);
  check("open_diagram renders and indexes the topology", (topology?.nodeCount ?? 0) > 30, `${topology?.nodeCount} nodes, ${topology?.edgeCount} edges`);

  // --- bounded retrieval --------------------------------------------------
  const searched = await call("search_graph", { query: "payment", limit: 10 });
  const search = payloadOf(searched.text);
  check("search_graph returns bounded ranked ids", (search?.results?.length ?? 0) > 0, search?.results?.map((r) => r.id).join(", "));

  const blast = await call("get_neighborhood", { nodeId: "PaymentService", direction: "incoming", depth: 2 });
  const neighborhood = payloadOf(blast.text);
  check("get_neighborhood walks dependents", (neighborhood?.levels?.length ?? 0) > 0,
    neighborhood?.levels?.map((level) => `d${level.depth}:${level.nodes.length}`).join(" "));

  const capped = await call("get_neighborhood", { nodeId: "APIGateway", direction: "both", depth: 6, limit: 5 });
  check("get_neighborhood honours the node budget", payloadOf(capped.text)?.truncated === true, "truncated flag set");

  const traced = await call("trace_path", { from: "APIGateway", to: "PaymentDB" });
  const paths = payloadOf(traced.text);
  const shortest = paths?.paths?.[0]?.nodes?.map((node) => node.id) ?? [];
  check("trace_path finds a multi-hop route", shortest.length >= 4, shortest.join(" -> "));

  // --- walkthrough --------------------------------------------------------
  const steps = shortest.map((nodeId, index) => ({ nodeId, caption: `Step ${index + 1}: traffic reaches ${nodeId}.` }));
  const tour = await call("create_walkthrough", { title: "Checkout to payment database", steps });
  check("create_walkthrough starts a tour", !tour.text.startsWith("ERROR"), tour.text.split("\n")[0]);

  await page.waitForFunction(() => {
    const bar = document.querySelector(".walkthrough-bar");
    return bar && !bar.hidden;
  }, { timeout: 5000 });
  const firstStep = await page.evaluate(() => document.querySelector(".walkthrough-counter").textContent);
  check("walkthrough bar is visible on step 1", firstStep === `1 / ${steps.length}`, firstStep);

  await page.click(".walkthrough-next");
  await page.waitForFunction(() => document.querySelector(".walkthrough-counter").textContent.startsWith("2"), { timeout: 5000 });
  const highlighted = await page.evaluate(() => ({
    counter: document.querySelector(".walkthrough-counter").textContent,
    current: document.querySelectorAll(".atlas-walk-current").length,
    edges: document.querySelectorAll(".atlas-walk-edge").length,
    caption: document.querySelector(".walkthrough-caption").textContent,
  }));
  check("human stepping advances and highlights the traversed edge",
    highlighted.counter.startsWith("2") && highlighted.current > 0 && highlighted.edges > 0,
    `current=${highlighted.current} edgeParts=${highlighted.edges}`);

  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.querySelector(".walkthrough-counter").textContent.startsWith("3"), { timeout: 5000 });
  check("arrow keys drive the walkthrough", true, "advanced to step 3");

  // --- patching -----------------------------------------------------------
  const beforePatch = await page.evaluate(() => document.querySelector("#source").value);
  const patched = await call("apply_patch", {
    operations: [{ type: "replace_text", find: "PaymentService --> FraudScorer", text: "PaymentService --> FraudScorer\n  PaymentService --> RiskArchive[Risk Archive]" }],
    description: "add risk archive",
  });
  const afterPatch = payloadOf(patched.text);
  check("apply_patch validates and applies", (afterPatch?.nodeCount ?? 0) > (topology?.nodeCount ?? 0),
    `${topology?.nodeCount} -> ${afterPatch?.nodeCount} nodes`);

  const sourceBeforeReject = await page.evaluate(() => document.querySelector("#source").value);
  const rejected = await call("apply_patch", {
    operations: [{ type: "replace_text", find: "flowchart LR", text: "notARealDiagramType QQ" }],
    description: "invalid syntax",
  });
  const sourceAfterReject = await page.evaluate(() => document.querySelector("#source").value);
  check("invalid patch is rejected without changing the source",
    rejected.text.startsWith("ERROR") && sourceAfterReject === sourceBeforeReject,
    rejected.text.split("\n")[0].slice(0, 80));

  const undone = await call("undo_last_change");
  const sourceAfterUndo = await page.evaluate(() => document.querySelector("#source").value);
  check("undo_last_change restores the previous source",
    !undone.text.startsWith("ERROR") && sourceAfterUndo.trim() === beforePatch.trim(),
    undone.text.split("\n")[0].slice(0, 80));

  // --- analysis -----------------------------------------------------------
  const analysed = await call("analyze_structure");
  const issues = payloadOf(analysed.text);
  check("analyze_structure reports entry points and dead ends",
    (issues?.sources?.length ?? 0) > 0 && (issues?.sinks?.length ?? 0) > 0,
    `${issues?.sources?.length} entry, ${issues?.sinks?.length} dead ends, ${issues?.cycles?.length} cycles`);

  // --- error paths --------------------------------------------------------
  const unknown = await call("get_neighborhood", { nodeId: "NoSuchService" });
  check("unknown node returns a recoverable suggestion", unknown.text.startsWith("ERROR") && unknown.text.includes("didYouMean"),
    unknown.text.split("\n")[0].slice(0, 70));

  const activity = await page.evaluate(() => document.querySelectorAll(".agent-activity-item").length);
  check("agent activity log records the calls for the human", activity > 8, `${activity} entries shown`);
} finally {
  await browser?.close();
  await server.close();
}

const failed = checks.filter((entry) => !entry.passed);
console.log(`\n${checks.length - failed.length}/${checks.length} WebMCP checks passed`);
if (failed.length) {
  console.error(`Failed: ${failed.map((entry) => entry.name).join("; ")}`);
  process.exit(1);
}
