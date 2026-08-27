import mermaid from "mermaid";
import elkLayouts from "@mermaid-js/layout-elk";
import tidyTreeLayouts from "@mermaid-js/layout-tidy-tree";
import zenuml from "@mermaid-js/mermaid-zenuml";

mermaid.registerLayoutLoaders(elkLayouts);
mermaid.registerLayoutLoaders(tidyTreeLayouts);
await mermaid.registerExternalDiagrams([zenuml]);

let renderQueue = Promise.resolve();

export function configureMermaid(theme = "light") {
  const dark = theme === "dark";
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    maxEdges: 20_000,
    maxTextSize: 5_000_000,
    deterministicIds: false,
    theme: "base",
    flowchart: {
      defaultRenderer: "elk",
      htmlLabels: true,
      useMaxWidth: false,
      curve: "basis",
      nodeSpacing: 48,
      rankSpacing: 72,
    },
    themeVariables: dark ? {
      background: "#151b23",
      primaryColor: "#253348",
      primaryTextColor: "#e7edf6",
      primaryBorderColor: "#7187a5",
      lineColor: "#8290a3",
      secondaryColor: "#302b46",
      tertiaryColor: "#203b36",
      clusterBkg: "#1c2531",
      clusterBorder: "#59677a",
      fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif",
    } : {
      background: "#f7f8fa",
      primaryColor: "#eef4ff",
      primaryTextColor: "#172033",
      primaryBorderColor: "#59749b",
      lineColor: "#8997ab",
      secondaryColor: "#f1edff",
      tertiaryColor: "#e9f7f2",
      clusterBkg: "#f3f5f8",
      clusterBorder: "#aab5c4",
      fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif",
    },
  });
}

export function parseMermaid(source) {
  return mermaid.parse(source);
}

export function renderMermaid(id, source) {
  const render = () => mermaid.render(id, source);
  const result = renderQueue.then(render, render);
  renderQueue = result.catch(() => undefined);
  return result;
}

export function registeredDiagramMetadata() {
  return mermaid.getRegisteredDiagramsMetadata();
}
