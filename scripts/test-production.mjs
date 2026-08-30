import { readFile, readdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";
import { preview } from "vite";
import { discoverChrome } from "./discover-chrome.mjs";

const server = await preview({ preview: { host: "127.0.0.1", port: 4176 }, logLevel: "error" });
let browser;

try {
  browser = await puppeteer.launch({ executablePath: discoverChrome(), headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:4176/debug", { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.location.pathname === "/", { timeout: 10_000 });

  const routeState = await page.evaluate(() => ({
    path: window.location.pathname,
    viewer: Boolean(document.querySelector(".app-root")),
    debugFixtures: document.querySelectorAll("[data-fixture-id]").length,
  }));
  if (routeState.path !== "/" || !routeState.viewer || routeState.debugFixtures) {
    throw new Error(`Production /debug route was not removed: ${JSON.stringify(routeState)}`);
  }

  const assetDirectory = new URL("../dist/assets/", import.meta.url);
  const javascriptAssets = (await readdir(assetDirectory)).filter((name) => name.endsWith(".js"));
  const productionJavaScript = (await Promise.all(
    javascriptAssets.map((name) => readFile(new URL(name, assetDirectory), "utf8")),
  )).join("\n");
  const leakedDebugMarkers = ["Legacy declaration", "Delivery decisions", "Expression EBNF"]
    .filter((marker) => productionJavaScript.includes(marker));
  if (leakedDebugMarkers.length) {
    throw new Error(`Development fixtures leaked into production: ${leakedDebugMarkers.join(", ")}`);
  }

  console.log(JSON.stringify({ routeState, javascriptAssets: javascriptAssets.length, leakedDebugMarkers }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())));
}
