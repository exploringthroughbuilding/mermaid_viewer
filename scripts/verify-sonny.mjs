import { readFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

const sourcePath = process.argv[2] || "/Users/bhavya/Documents/macos-agent/docs/sonny-codebase-mermaid-diagrams.md";
const chromePath = process.env.CHROME_PATH
  || "/Users/bhavya/.cache/puppeteer/chrome/mac_arm-147.0.7727.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const server = await createServer({ server: { host: "127.0.0.1", port: 4174 } });
let browser;

try {
  await server.listen();
  browser = await puppeteer.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 600 });
  page.setDefaultTimeout(120_000);
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto("http://127.0.0.1:4174", { waitUntil: "networkidle0" });

  const panelSizing = await page.evaluate(() => ({
    indexHeight: document.querySelector(".index-panel").getBoundingClientRect().height,
    selectionHeight: document.querySelector(".inspector").getBoundingClientRect().height,
  }));
  if (panelSizing.selectionHeight <= panelSizing.indexHeight) {
    throw new Error(`Selection panel did not receive the larger share: ${JSON.stringify(panelSizing)}`);
  }

  const sourceResizerBounds = await page.$eval('.panel-resizer[data-resize="source"]', (resizer) => {
    const bounds = resizer.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  });
  await page.mouse.move(sourceResizerBounds.x, sourceResizerBounds.y);
  await page.mouse.down();
  await page.mouse.move(sourceResizerBounds.x, sourceResizerBounds.y + 30, { steps: 3 });
  await page.mouse.up();
  const resizedPanels = await page.evaluate(() => ({
    sourceHeight: document.querySelector(".source-panel").getBoundingClientRect().height,
    saved: JSON.parse(localStorage.getItem("mermaid-atlas-panel-sizes")),
  }));
  if (resizedPanels.sourceHeight < 255 || resizedPanels.saved.source < 255) {
    throw new Error(`Sidebar resizing did not persist: ${JSON.stringify(resizedPanels)}`);
  }

  const sidebarResizerBounds = await page.$eval("#sidebar-resizer", (resizer) => {
    const bounds = resizer.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  });
  await page.mouse.move(sidebarResizerBounds.x, sidebarResizerBounds.y);
  await page.mouse.down();
  await page.mouse.move(sidebarResizerBounds.x + 50, sidebarResizerBounds.y, { steps: 3 });
  await page.mouse.up();
  const resizedSidebar = await page.evaluate(() => ({
    width: document.querySelector(".rail").getBoundingClientRect().width,
    saved: JSON.parse(localStorage.getItem("mermaid-atlas-panel-sizes")),
  }));
  if (Math.abs(resizedSidebar.width - 410) > 2 || Math.abs(resizedSidebar.saved.sidebar - 410) > 2) {
    throw new Error(`Sidebar width resizing did not persist: ${JSON.stringify(resizedSidebar)}`);
  }

  await page.click("#open-settings");
  await page.waitForSelector("#settings-dialog[open]");
  await page.$eval("#zoom-sensitivity", (input) => {
    input.value = "2";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.$eval("#pan-sensitivity", (input) => {
    input.value = "1.5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const savedSensitivity = await page.evaluate(() => JSON.parse(localStorage.getItem("mermaid-atlas-interaction-settings")));
  if (savedSensitivity.zoom !== 2 || savedSensitivity.pan !== 1.5 || savedSensitivity.device !== "trackpad") {
    throw new Error(`Sensitivity did not persist: ${JSON.stringify(savedSensitivity)}`);
  }
  await page.click('#settings-dialog button[value="done"]');

  const source = await readFile(sourcePath, "utf8");
  await page.$eval("#source", (textarea, value) => {
    textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, source);
  const sourceLayout = await page.evaluate(() => {
    const panel = document.querySelector(".source-panel").getBoundingClientRect();
    const textarea = document.querySelector("#source");
    const editor = textarea.getBoundingClientRect();
    const renderButton = document.querySelector("#render").getBoundingClientRect();
    return {
      sourceScrollsInternally: textarea.scrollHeight > textarea.clientHeight,
      editorInsidePanel: editor.left >= panel.left && editor.right <= panel.right && editor.bottom <= panel.bottom,
      controlsInsidePanel: renderButton.bottom <= panel.bottom,
      editorHeight: editor.height,
    };
  });
  if (!sourceLayout.sourceScrollsInternally || !sourceLayout.editorInsidePanel
      || !sourceLayout.controlsInsidePanel) {
    throw new Error(`Source editor overflowed its panel: ${JSON.stringify(sourceLayout)}`);
  }
  await page.select("#block-picker", "1");
  await page.waitForFunction(() => ["Diagram ready", "Render failed"].includes(document.querySelector("#status")?.textContent));
  const status = await page.$eval("#status", (element) => element.textContent);
  if (status !== "Diagram ready") {
    const detail = await page.$eval("#canvas-empty", (element) => element.textContent.trim());
    throw new Error(`Browser render failed: ${detail}\n${browserErrors.join("\n")}`);
  }
  await page.waitForSelector("#stage g.node");

  const rendered = await page.evaluate(() => ({
    stats: document.querySelector("#graph-stats")?.textContent,
    nodes: document.querySelectorAll("#stage g.node").length,
    edges: document.querySelectorAll("#stage path.flowchart-link, #stage g.edgePath path").length,
    indexedItems: document.querySelectorAll("#node-list [data-node-key]").length,
    nodeSamples: [...document.querySelectorAll("#stage g.node")]
      .slice(0, 3)
      .map((node) => ({ id: node.id, data: { ...node.dataset } })),
    edgeSamples: [...document.querySelectorAll("#stage path.flowchart-link, #stage g.edgePath path")]
      .slice(0, 3)
      .map((path) => ({ id: path.id, className: path.getAttribute("class"), data: { ...path.dataset } })),
  }));

  const transformBeforeSelection = await page.$eval("#stage", (stage) => stage.style.transform);
  await page.click('#stage g.node[data-graph-key="AppDelegate"]');
  await page.waitForSelector("#selection-content .selected-node-name");
  const selection = await page.evaluate(() => ({
    text: document.querySelector("#selection-content")?.textContent.trim(),
    parents: document.querySelectorAll("#stage g.node.atlas-parent").length,
    children: document.querySelectorAll("#stage g.node.atlas-child").length,
    dimmedNodes: document.querySelectorAll("#stage g.node.atlas-dimmed").length,
    incomingEdges: document.querySelectorAll("#stage path.atlas-incoming").length,
    outgoingEdges: document.querySelectorAll("#stage path.atlas-outgoing").length,
    incomingMarker: document.querySelector("#stage path.atlas-incoming")?.getAttribute("marker-end"),
    outgoingMarker: document.querySelector("#stage path.atlas-outgoing")?.getAttribute("marker-end"),
    transformAfterSelection: document.querySelector("#stage")?.style.transform,
    inconsistentIncomingEdges: [...document.querySelectorAll('#stage path[data-id$="_AppDelegate_0"]')]
      .filter((path) => !path.classList.contains("atlas-incoming") || !path.getAttribute("marker-end")?.includes("atlas-incoming"))
      .length,
    inconsistentOutgoingEdges: [...document.querySelectorAll('#stage path[data-id^="L_AppDelegate_"]')]
      .filter((path) => !path.classList.contains("atlas-outgoing") || !path.getAttribute("marker-end")?.includes("atlas-outgoing"))
      .length,
  }));

  if (!rendered.nodes || !rendered.edges || !rendered.indexedItems || !selection.text
      || !selection.parents || !selection.children || !selection.dimmedNodes
      || !selection.incomingEdges || !selection.outgoingEdges
      || !selection.incomingMarker?.includes("atlas-incoming")
      || !selection.outgoingMarker?.includes("atlas-outgoing")
      || selection.inconsistentIncomingEdges || selection.inconsistentOutgoingEdges
      || selection.transformAfterSelection !== transformBeforeSelection) {
    throw new Error(`Incomplete interaction result: ${JSON.stringify({ rendered, selection })}`);
  }

  await page.click('#selection-content [data-zoom-key="AppDelegate"]');
  await page.waitForFunction(
    (previousTransform) => document.querySelector("#stage")?.style.transform !== previousTransform,
    {},
    transformBeforeSelection,
  );
  const explicitZoomVerified = await page.$eval(
    "#stage",
    (stage, previousTransform) => stage.style.transform !== previousTransform,
    transformBeforeSelection,
  );
  const zoomCenter = await page.evaluate(() => {
    const viewport = document.querySelector("#viewport").getBoundingClientRect();
    const node = document.querySelector('#stage g.node[data-graph-key="AppDelegate"]').getBoundingClientRect();
    return {
      horizontalDelta: Math.abs((node.left + node.width / 2) - (viewport.left + viewport.width / 2)),
      verticalDelta: Math.abs((node.top + node.height / 2) - (viewport.top + viewport.height / 2)),
    };
  });
  if (zoomCenter.horizontalDelta > 2 || zoomCenter.verticalDelta > 2) {
    throw new Error(`Explicit zoom did not center the node: ${JSON.stringify(zoomCenter)}`);
  }

  await page.click("#fit");
  const scaleBeforeWheel = await page.$eval("#stage", (stage) => Number(stage.style.transform.match(/scale\(([^)]+)\)/)?.[1]));
  await page.$eval("#viewport", (viewport) => {
    const bounds = viewport.getBoundingClientRect();
    viewport.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
      ctrlKey: true,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    }));
  });
  const scaleAfterWheel = await page.$eval("#stage", (stage) => Number(stage.style.transform.match(/scale\(([^)]+)\)/)?.[1]));
  const zoomRatio = scaleAfterWheel / scaleBeforeWheel;
  if (zoomRatio < 1.3) throw new Error(`Zoom sensitivity was not applied: ratio ${zoomRatio}`);

  await page.click("#fit");
  const scaleBeforeNativePinch = await page.$eval("#stage", (stage) => Number(stage.style.transform.match(/scale\(([^)]+)\)/)?.[1]));
  await page.$eval("#viewport", (viewport) => {
    const bounds = viewport.getBoundingClientRect();
    const dispatchGesture = (type, scale) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        scale: { value: scale },
        clientX: { value: bounds.left + bounds.width / 2 },
        clientY: { value: bounds.top + bounds.height / 2 },
      });
      viewport.dispatchEvent(event);
    };
    dispatchGesture("gesturestart", 1);
    dispatchGesture("gesturechange", 1.2);
    dispatchGesture("gestureend", 1.2);
  });
  const scaleAfterNativePinch = await page.$eval("#stage", (stage) => Number(stage.style.transform.match(/scale\(([^)]+)\)/)?.[1]));
  const nativePinchRatio = scaleAfterNativePinch / scaleBeforeNativePinch;
  if (Math.abs(nativePinchRatio - 1.44) > 0.02) {
    throw new Error(`Native pinch sensitivity was not applied: ratio ${nativePinchRatio}`);
  }

  const translationBeforeTrackpad = await page.$eval("#stage", (stage) => {
    const match = stage.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    return { x: Number(match?.[1]), y: Number(match?.[2]) };
  });
  await page.$eval("#viewport", (viewport) => {
    viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 20, deltaY: 10 }));
  });
  const translationAfterTrackpad = await page.$eval("#stage", (stage) => {
    const match = stage.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    return { x: Number(match?.[1]), y: Number(match?.[2]) };
  });
  const trackpadMovement = {
    x: translationAfterTrackpad.x - translationBeforeTrackpad.x,
    y: translationAfterTrackpad.y - translationBeforeTrackpad.y,
  };
  if (Math.abs(trackpadMovement.x + 30) > 1 || Math.abs(trackpadMovement.y + 15) > 1) {
    throw new Error(`Trackpad movement sensitivity was not applied: ${JSON.stringify(trackpadMovement)}`);
  }

  const viewportBounds = await page.$eval("#viewport", (viewport) => {
    const bounds = viewport.getBoundingClientRect();
    return { x: bounds.left, y: bounds.top };
  });
  const translationBeforeDrag = await page.$eval("#stage", (stage) => {
    const match = stage.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    return { x: Number(match?.[1]), y: Number(match?.[2]) };
  });
  await page.mouse.move(viewportBounds.x + 8, viewportBounds.y + 8);
  await page.mouse.down();
  await page.mouse.move(viewportBounds.x + 48, viewportBounds.y + 8, { steps: 4 });
  await page.mouse.up();
  const translationAfterDrag = await page.$eval("#stage", (stage) => {
    const match = stage.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    return { x: Number(match?.[1]), y: Number(match?.[2]) };
  });
  const panDistance = translationAfterDrag.x - translationBeforeDrag.x;
  if (Math.abs(panDistance - 60) > 2) throw new Error(`Pan sensitivity was not applied: distance ${panDistance}`);

  console.log(JSON.stringify({ sourcePath, panelSizing, resizedPanels, resizedSidebar, savedSensitivity, sourceLayout, rendered, selectionVerified: true, explicitZoomVerified, zoomCenter, zoomRatio, nativePinchRatio, trackpadMovement, panDistance }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
