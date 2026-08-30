import puppeteer from "puppeteer-core";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { discoverChrome } from "./discover-chrome.mjs";
import { viewerFixtures } from "../src/fixtures/viewer-fixtures.js";

const demoDoc = fileURLToPath(new URL("../README.md", import.meta.url));
const agentFixtureTitles = {
  "sequence-core": "Agent sequence fixture",
  "class-core": "Agent class fixture",
  "state-core": "Agent state fixture",
  "architecture-core": "Agent architecture fixture",
};
const agentFixtureMarkdown = ["# Agent interaction fixtures", ...Object.entries(agentFixtureTitles).map(([id, title]) => {
  const fixture = viewerFixtures.find((entry) => entry.id === id);
  return `## ${title}\n\n\`\`\`mermaid\n${fixture.source}\n\`\`\``;
})].join("\n\n");
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
    return tools.map((tool) => ({ name: tool.name, title: tool.title, annotations: tool.annotations }));
  });
  const expected = [
    "get_atlas_guide", "list_diagrams", "open_diagram", "search_graph", "get_neighborhood",
    "trace_path", "create_walkthrough", "apply_patch", "undo_last_change", "analyze_structure",
  ];
  const registeredNames = registered.map(({ name }) => name);
  const missing = expected.filter((name) => !registeredNames.includes(name));
  check("all tools registered via document.modelContext", missing.length === 0, missing.length ? `missing ${missing}` : `${registered.length} tools`);
  const listMetadata = registered.find(({ name }) => name === "list_diagrams");
  const guideMetadata = registered.find(({ name }) => name === "get_atlas_guide");
  const patchMetadata = registered.find(({ name }) => name === "apply_patch");
  check("tools expose trust and read-only annotations",
    listMetadata?.annotations?.readOnlyHint === true
      && listMetadata?.annotations?.untrustedContentHint === true
      && guideMetadata?.annotations?.readOnlyHint === true
      && guideMetadata?.annotations?.untrustedContentHint === false
      && patchMetadata?.annotations?.readOnlyHint === false,
    JSON.stringify({ guide: guideMetadata?.annotations, list: listMetadata?.annotations, patch: patchMetadata?.annotations }));

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

  const guide = payloadOf((await call("get_atlas_guide")).text);
  check("get_atlas_guide provides app-authored workflows and safety guidance",
    guide?.workflows?.some(({ id, calls }) => id === "trace_request" && calls.includes("create_walkthrough"))
      && guide?.guidelines?.some((guideline) => guideline.includes("Do not call apply_patch"))
      && guide?.exampleTasks?.length >= 4,
    `${guide?.workflows?.length ?? 0} workflows · ${guide?.guidelines?.length ?? 0} guidelines`);

  // --- first-run challenge experience ------------------------------------
  const coldStart = payloadOf((await call("list_diagrams", { limit: 8 })).text);
  const initialState = await page.evaluate(() => ({
    source: document.querySelector("#source")?.value,
    nodes: document.querySelectorAll("#node-list [data-node-key]").length,
  }));
  check("fresh visitors receive the built-in challenge library",
    coldStart?.total === 4 && coldStart?.diagrams?.some(({ title }) => title === "Service Topology"),
    `${coldStart?.total} seeded diagrams`);
  check("the checkout service topology is the initial live graph",
    initialState.source?.includes("CheckoutOrchestrator") && initialState.nodes > 30 && Boolean(coldStart?.active?.libraryId),
    `${initialState.nodes} indexed nodes; active=${coldStart?.active?.libraryId}`);

  const firstPage = payloadOf((await call("list_diagrams", { limit: 2 })).text);
  const secondPage = payloadOf((await call("list_diagrams", { limit: 2, cursor: firstPage?.nextCursor })).text);
  check("list_diagrams paginates and reports truncation",
    firstPage?.diagrams?.length === 2 && firstPage?.truncated === true && secondPage?.diagrams?.length === 2,
    `next cursor ${firstPage?.nextCursor}`);

  // --- markdown import ----------------------------------------------------
  const fileInput = await page.$("#file-input");
  await fileInput.uploadFile(demoDoc);
  await page.waitForFunction(() => document.querySelector("#stage svg"), { timeout: 30000 });

  const listed = await call("list_diagrams", { limit: 20 });
  const library = payloadOf(listed.text);
  const imported = library?.diagrams?.filter((entry) => entry.origin === "README") ?? [];
  check("list_diagrams sees every imported Markdown block by heading", imported.length === 4, imported.map(({ title }) => title).join(" | "));

  await page.select("#block-picker", "1");
  await page.waitForFunction(() => document.querySelector("#source")?.value.startsWith("sequenceDiagram"));
  const selectedBlockLibrary = payloadOf((await call("list_diagrams", { limit: 20 })).text);
  const selectedBlock = selectedBlockLibrary?.diagrams?.find(({ id }) => id === selectedBlockLibrary?.active?.libraryId);
  check("human Markdown block selection updates WebMCP active state",
    selectedBlock?.title === "Checkout Request Flow" && selectedBlock?.origin === "README",
    `${selectedBlockLibrary?.active?.libraryId} -> ${selectedBlock?.title}`);
  await page.select("#block-picker", "0");
  await page.waitForFunction(() => document.querySelector("#source")?.value.startsWith("flowchart LR"));

  const topologyId = imported.find((entry) => entry.title === "Service Topology")?.id;
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
  const firstStep = await page.evaluate(() => {
    const bar = document.querySelector(".walkthrough-bar");
    const footer = document.querySelector(".canvas-footer");
    const progress = document.querySelector(".walkthrough-progress");
    const progressButton = progress?.querySelector("button");
    return {
      counter: document.querySelector(".walkthrough-counter").textContent,
      clearsFooter: bar.getBoundingClientRect().bottom < footer.getBoundingClientRect().top,
      progressAccessible: progress?.getAttribute("aria-hidden") !== "true"
        && progress?.getAttribute("aria-label") === "Walkthrough steps",
      progressBackgroundSize: progressButton ? getComputedStyle(progressButton).backgroundSize : "",
      theme: document.querySelector(".app-root")?.dataset.theme,
      zoom: document.querySelector("#zoom-level")?.textContent,
    };
  });
  await page.click(".theme-toggle");
  await page.waitForFunction((previousTheme, expectedCounter, expectedZoom) => {
    const bar = document.querySelector(".walkthrough-bar");
    return document.querySelector(".app-root")?.dataset.theme !== previousTheme
      && document.querySelector("#status")?.textContent === "Diagram ready"
      && bar && !bar.hidden
      && document.querySelector(".walkthrough-counter")?.textContent === expectedCounter
      && document.querySelectorAll(".atlas-walk-current").length === 1
      && document.querySelector("#zoom-level")?.textContent === expectedZoom;
  }, { timeout: 8000 }, firstStep.theme, firstStep.counter, firstStep.zoom);
  check("walkthrough survives theme renders with accessible, footer-safe progress",
    firstStep.counter === `1 / ${steps.length}`
      && firstStep.clearsFooter
      && firstStep.progressAccessible
      && firstStep.progressBackgroundSize === "100% 3px",
    `${firstStep.counter} · footer=${firstStep.clearsFooter} · accessible=${firstStep.progressAccessible} · track=${firstStep.progressBackgroundSize}`);

  await page.click(".walkthrough-next");
  await page.waitForFunction(() => document.querySelector(".walkthrough-counter").textContent.startsWith("2"), { timeout: 5000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".atlas-walk-path.atlas-dimmed")]
    .every((node) => Math.abs(Number.parseFloat(getComputedStyle(node).opacity) - 0.62) < 0.01), { timeout: 2000 });
  const highlighted = await page.evaluate(() => ({
    counter: document.querySelector(".walkthrough-counter").textContent,
    current: document.querySelectorAll(".atlas-walk-current").length,
    edges: document.querySelectorAll(".atlas-walk-edge").length,
    dimmedRouteNodes: [...document.querySelectorAll(".atlas-walk-path.atlas-dimmed")].map((node) => ({
      opacity: getComputedStyle(node).opacity,
      paintDimmed: node.querySelectorAll(".atlas-paint-part.atlas-dimmed").length,
    })),
    markerRefs: [...document.querySelectorAll("path.atlas-walk-edge")]
      .flatMap((path) => [path.getAttribute("marker-start"), path.getAttribute("marker-end")])
      .filter(Boolean),
    caption: document.querySelector(".walkthrough-caption").textContent,
  }));
  check("human stepping advances and highlights the traversed edge",
    highlighted.counter.startsWith("2") && highlighted.current > 0 && highlighted.edges > 0
      && highlighted.dimmedRouteNodes.every(({ opacity, paintDimmed }) => (
        Math.abs(Number.parseFloat(opacity) - 0.62) < 0.01 && paintDimmed === 0
      ))
      && highlighted.markerRefs.every((reference) => reference.includes("atlas-walkthrough")),
    JSON.stringify(highlighted));

  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.querySelector(".walkthrough-counter").textContent.startsWith("3"), { timeout: 5000 });
  check("arrow keys drive the walkthrough", true, "advanced to step 3");

  // --- patching -----------------------------------------------------------
  const beforePatch = await page.evaluate(() => document.querySelector("#source").value);
  const ambiguousPatch = await call("apply_patch", {
    operations: [
      { type: "replace_line", line: 1, text: "  subgraph Edge" },
      { type: "insert_after_line", line: 1, text: "  %% duplicate target" },
    ],
    description: "ambiguous same-line operations",
  });
  check("apply_patch rejects ambiguous same-line operations",
    ambiguousPatch.text.startsWith("ERROR") && await page.evaluate((source) => document.querySelector("#source").value === source, beforePatch),
    ambiguousPatch.text.split("\n")[0].slice(0, 80));

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

  const humanRevision = `${sourceBeforeReject}\n%% human note after agent patch`;
  await page.$eval("#source", (textarea, source) => {
    textarea.value = source;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, humanRevision);
  await page.click("#render");
  await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Diagram ready");
  const protectedUndo = await call("undo_last_change");
  const sourceAfterProtectedUndo = await page.evaluate(() => document.querySelector("#source").value);
  check("undo refuses to overwrite a newer human edit",
    protectedUndo.text.startsWith("ERROR") && sourceAfterProtectedUndo === humanRevision,
    protectedUndo.text.split("\n")[0].slice(0, 90));

  await page.$eval("#source", (textarea, source) => {
    textarea.value = source;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, sourceBeforeReject);
  await page.click("#render");
  await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Diagram ready");
  const undone = await call("undo_last_change");
  const sourceAfterUndo = await page.evaluate(() => document.querySelector("#source").value);
  check("undo_last_change restores the previous source",
    !undone.text.startsWith("ERROR") && sourceAfterUndo.trim() === beforePatch.trim(),
    undone.text.split("\n")[0].slice(0, 80));

  await call("apply_patch", {
    operations: [{ type: "replace_text", find: "PaymentService --> FraudScorer", text: "PaymentService --> FraudScorer\n  PaymentService --> RiskArchive[Risk Archive]" }],
    description: "add risk archive for scoped undo",
  });
  const flowId = imported.find((entry) => entry.title === "Checkout Request Flow")?.id;
  await call("open_diagram", { diagramId: flowId });
  const crossDiagramUndo = await call("undo_last_change");
  const flowSourceAfterUndo = await page.evaluate(() => document.querySelector("#source").value);
  check("undo history is scoped to the active diagram",
    crossDiagramUndo.text.startsWith("ERROR") && flowSourceAfterUndo.startsWith("sequenceDiagram"),
    crossDiagramUndo.text.split("\n")[0].slice(0, 90));
  await call("open_diagram", { diagramId: topologyId });
  const scopedUndo = await call("undo_last_change");
  check("returning to the patched diagram can undo its own change",
    !scopedUndo.text.startsWith("ERROR") && await page.evaluate((source) => document.querySelector("#source").value.trim() === source.trim(), beforePatch),
    scopedUndo.text.split("\n")[0].slice(0, 90));

  // --- AI-style function calls against public interaction families -------
  await page.$eval("#source", (textarea, markdown) => {
    textarea.value = markdown;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, agentFixtureMarkdown);
  await page.waitForFunction(() => document.querySelectorAll("#block-picker option").length === 4);
  const agentLibrary = payloadOf((await call("list_diagrams", { limit: 20 })).text);
  const agentFixtures = agentLibrary?.diagrams?.filter(({ origin }) => origin === "pasted-markdown") ?? [];
  check("agent can catalogue a multi-diagram interaction workspace through list_diagrams",
    Object.values(agentFixtureTitles).every((title) => agentFixtures.some((entry) => entry.title === title)),
    `${agentFixtures.length} agent fixtures listed`);

  const agentScenarios = [
    { title: agentFixtureTitles["sequence-core"], query: "Payment Service", nodeId: "Payment", expectedNodes: 6 },
    { title: agentFixtureTitles["class-core"], query: "Owner", nodeId: "Owner", expectedNodes: 3 },
    { title: agentFixtureTitles["state-core"], query: "Awaiting payment", nodeId: "AwaitingPayment", expectedNodes: 8 },
    { title: agentFixtureTitles["architecture-core"], query: "API", nodeId: "api", expectedNodes: 3 },
  ];
  const agentScenarioResults = [];
  for (const scenario of agentScenarios) {
    const diagramId = agentFixtures.find(({ title }) => title === scenario.title)?.id;
    const openedByAgent = payloadOf((await call("open_diagram", { diagramId })).text);
    const searchedByAgent = payloadOf((await call("search_graph", { query: scenario.query, limit: 5 })).text);
    const selectedByAgent = payloadOf((await call("get_neighborhood", {
      nodeId: scenario.nodeId,
      direction: "both",
      depth: 1,
      limit: 12,
    })).text);
    agentScenarioResults.push({
      ...scenario,
      nodeCount: openedByAgent?.nodeCount,
      firstResult: searchedByAgent?.results?.[0]?.id,
      selected: selectedByAgent?.root?.id,
    });
  }
  check("agent function calls open, search, and select every corrected diagram family",
    agentScenarioResults.every(({ expectedNodes, nodeCount, firstResult, selected, nodeId }) => (
      nodeCount === expectedNodes && firstResult === nodeId && selected === nodeId
    )),
    agentScenarioResults.map(({ title, nodeCount, firstResult, selected }) => `${title}:${nodeCount}/${firstResult}/${selected}`).join(" | "));

  const architectureVisual = await page.evaluate(() => {
    const service = document.querySelector('#stage [data-graph-key="api"]');
    const selectedParts = [...service.querySelectorAll(".atlas-paint-part.atlas-selected")];
    return {
      selectedParts: selectedParts.map((part) => ({ tag: part.localName, width: part.getAttribute("width"), height: part.getAttribute("height") })),
      selectedIconDetails: service.querySelectorAll("line.atlas-selected, path.atlas-selected, circle.atlas-selected, polygon.atlas-selected, polyline.atlas-selected").length,
    };
  });
  check("agent-selected architecture service highlights only its tile boundary",
    architectureVisual.selectedParts.length === 1
      && architectureVisual.selectedParts[0].tag === "rect"
      && architectureVisual.selectedParts[0].width === "80"
      && architectureVisual.selectedParts[0].height === "80"
      && architectureVisual.selectedIconDetails === 0,
    JSON.stringify(architectureVisual));

  const classFixtureId = agentFixtures.find(({ title }) => title === agentFixtureTitles["class-core"])?.id;
  await call("open_diagram", { diagramId: classFixtureId });
  await call("get_neighborhood", { nodeId: "Owner", direction: "outgoing", depth: 1, limit: 5 });
  const classVisual = await page.evaluate(() => {
    const path = document.querySelector('#stage path.relation[data-id^="id_Owner_Dog_"]');
    return {
      lineWidth: getComputedStyle(path).strokeWidth,
      originalLineWidth: path.style.getPropertyValue("--atlas-original-stroke-width"),
      markerStart: path.getAttribute("marker-start"),
    };
  });
  check("agent-selected class aggregation keeps its diamond marker at the original scale",
    classVisual.lineWidth === classVisual.originalLineWidth && classVisual.markerStart?.includes("atlas-outgoing"),
    JSON.stringify(classVisual));

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

  const activity = await page.evaluate(() => ({
    entries: document.querySelectorAll(".agent-activity-item").length,
    floatingPanel: Boolean(document.querySelector("aside.agent-activity")),
    footerText: document.querySelector(".canvas-footer")?.textContent || "",
    latestAction: document.querySelector("#latest-agent-action")?.textContent || "",
  }));
  await page.click("#agent-activity-trigger");
  const activityDialog = await page.evaluate(() => ({
    open: document.querySelector("#agent-activity-dialog")?.open,
    entries: document.querySelectorAll("#agent-activity-dialog .agent-activity-item").length,
  }));
  check("latest agent action opens the complete activity dialog from the bottom bar",
    activity.entries > 8
      && !activity.floatingPanel
      && activity.latestAction === "get_neighborhood"
      && !activity.footerText.includes("Adaptive layout")
      && !activity.footerText.includes("Rendered on this device")
      && activityDialog.open
      && activityDialog.entries === activity.entries,
    `${activity.entries} entries · latest=${activity.latestAction} · dialog=${activityDialog.open}`);
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
