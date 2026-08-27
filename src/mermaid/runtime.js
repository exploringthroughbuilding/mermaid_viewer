import mermaid from "mermaid";
import elkLayouts from "@mermaid-js/layout-elk";
import tidyTreeLayouts from "@mermaid-js/layout-tidy-tree";
import zenuml from "@mermaid-js/mermaid-zenuml";

mermaid.registerLayoutLoaders(elkLayouts);
mermaid.registerLayoutLoaders(tidyTreeLayouts);
await mermaid.registerExternalDiagrams([zenuml]);

let renderQueue = Promise.resolve();

const fontFamily = "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif";

// Categorical scales drive timelines, mindmaps, journeys, pies and git
// branches; each set keeps the same hue order so switching themes is calm.
const lightScale = ["#d6e4fb", "#e5dcff", "#cdeee0", "#fbe3c2", "#f9d4d4", "#cfe9f3", "#e3ecc6", "#f5e6b8", "#dbe1f2", "#ecd8f0", "#f8d9c7", "#d4ecd9"];
const darkScale = ["#2f4a70", "#4a3d78", "#22534a", "#5c4426", "#5e3232", "#28506a", "#465a2a", "#5c5626", "#33405e", "#553562", "#5e3f2e", "#2e5a44"];
const lightSeries = "#235ea7,#dc684f,#3e9a7a,#c48a1f,#7655b5,#1d8a9a,#c2498b,#6f8f2a,#8a6d3b,#4b6cb7";
const darkSeries = "#7fb0ed,#f08a73,#66c3a2,#f0c060,#b39bff,#5fc4d9,#e88bb0,#a5d46a,#d9a97e,#8fa8f5";

const scaleVariables = (scale, labelColor) => Object.fromEntries(scale.flatMap((color, index) => [
  [`cScale${index}`, color],
  [`cScaleLabel${index}`, labelColor],
  [`pie${index + 1}`, color],
]));

const gitVariables = (colors, labelColor) => Object.fromEntries(colors.flatMap((color, index) => [
  [`git${index}`, color],
  [`gitBranchLabel${index}`, labelColor],
]));

const lightVariables = {
  background: "#f7f8fa",
  primaryColor: "#eef4ff",
  primaryTextColor: "#172033",
  primaryBorderColor: "#59749b",
  secondaryColor: "#f1edff",
  tertiaryColor: "#e9f7f2",
  lineColor: "#8997ab",
  textColor: "#172033",
  titleColor: "#172033",
  clusterBkg: "#f3f5f8",
  clusterBorder: "#aab5c4",
  edgeLabelBackground: "#eef1f6",
  noteBkgColor: "#fff5cc",
  noteTextColor: "#4a3f12",
  noteBorderColor: "#d9c26a",
  actorLineColor: "#aab5c4",
  signalColor: "#4a5a70",
  signalTextColor: "#172033",
  activationBkgColor: "#dfe8f7",
  activationBorderColor: "#59749b",
  sequenceNumberColor: "#ffffff",
  labelBoxBkgColor: "#eef4ff",
  labelBoxBorderColor: "#59749b",
  sectionBkgColor: "#eef2f7",
  altSectionBkgColor: "#ffffff",
  sectionBkgColor2: "#e4ebf5",
  excludeBkgColor: "#eef1f5",
  taskBkgColor: "#d6e4fb",
  taskBorderColor: "#59749b",
  taskTextColor: "#172033",
  taskTextLightColor: "#172033",
  taskTextOutsideColor: "#172033",
  taskTextDarkColor: "#172033",
  activeTaskBkgColor: "#b9d2f7",
  activeTaskBorderColor: "#235ea7",
  doneTaskBkgColor: "#e2e7ee",
  doneTaskBorderColor: "#9aa6b6",
  critBkgColor: "#f7c3ba",
  critBorderColor: "#c2493a",
  todayLineColor: "#dc684f",
  gridColor: "#cdd5df",
  attributeBackgroundColorOdd: "#ffffff",
  attributeBackgroundColorEven: "#f1f4f8",
  pieStrokeColor: "#ffffff",
  pieOuterStrokeColor: "#aab5c4",
  pieTitleTextColor: "#172033",
  pieSectionTextColor: "#172033",
  pieLegendTextColor: "#172033",
  commitLabelColor: "#172033",
  commitLabelBackground: "#eef1f6",
  tagLabelColor: "#172033",
  tagLabelBackground: "#fff5cc",
  tagLabelBorder: "#d9c26a",
  archEdgeColor: "#8997ab",
  archEdgeArrowColor: "#8997ab",
  archGroupBorderColor: "#59749b",
  quadrant1Fill: "#eef4ff",
  quadrant2Fill: "#f1edff",
  quadrant3Fill: "#e9f7f2",
  quadrant4Fill: "#fdf1e6",
  quadrantPointFill: "#235ea7",
  xyChart: { backgroundColor: "#f7f8fa", plotColorPalette: lightSeries },
  ...scaleVariables(lightScale, "#172033"),
  ...gitVariables(["#235ea7", "#7655b5", "#25866a", "#be7a21", "#c2493a", "#1a8a9a", "#7a7a2a", "#8a3a6a"], "#ffffff"),
  fontFamily,
};

const darkVariables = {
  darkMode: true,
  background: "#151b23",
  primaryColor: "#253348",
  primaryTextColor: "#e7edf6",
  primaryBorderColor: "#7187a5",
  secondaryColor: "#332c4d",
  tertiaryColor: "#20403a",
  lineColor: "#9aabc2",
  textColor: "#e7edf6",
  titleColor: "#e7edf6",
  clusterBkg: "#1c2531",
  clusterBorder: "#59677a",
  edgeLabelBackground: "#1f2a38",
  noteBkgColor: "#3d3826",
  noteTextColor: "#f3e7b5",
  noteBorderColor: "#8a7d45",
  actorLineColor: "#59677a",
  signalColor: "#c5d0de",
  signalTextColor: "#e7edf6",
  activationBkgColor: "#3a4a63",
  activationBorderColor: "#7187a5",
  sequenceNumberColor: "#11161d",
  labelBoxBkgColor: "#1f2a38",
  labelBoxBorderColor: "#59677a",
  sectionBkgColor: "#1f2a38",
  altSectionBkgColor: "#151b23",
  sectionBkgColor2: "#253348",
  excludeBkgColor: "#1a212b",
  taskBkgColor: "#2f4a70",
  taskBorderColor: "#7187a5",
  taskTextColor: "#e7edf6",
  taskTextLightColor: "#e7edf6",
  taskTextOutsideColor: "#c5d0de",
  taskTextDarkColor: "#e7edf6",
  activeTaskBkgColor: "#2c5a8f",
  activeTaskBorderColor: "#8fc2ff",
  doneTaskBkgColor: "#3a4656",
  doneTaskBorderColor: "#59677a",
  critBkgColor: "#7a2e2e",
  critBorderColor: "#e08a8a",
  todayLineColor: "#f08a73",
  gridColor: "#3a4656",
  attributeBackgroundColorOdd: "#1f2a38",
  attributeBackgroundColorEven: "#253348",
  pieStrokeColor: "#11161d",
  pieOuterStrokeColor: "#59677a",
  pieTitleTextColor: "#e7edf6",
  pieSectionTextColor: "#e7edf6",
  pieLegendTextColor: "#e7edf6",
  commitLabelColor: "#e7edf6",
  commitLabelBackground: "#2c3644",
  tagLabelColor: "#f3e7b5",
  tagLabelBackground: "#3d3826",
  tagLabelBorder: "#8a7d45",
  archEdgeColor: "#9aabc2",
  archEdgeArrowColor: "#9aabc2",
  archGroupBorderColor: "#7187a5",
  quadrant1Fill: "#1f2a38",
  quadrant2Fill: "#22303f",
  quadrant3Fill: "#243541",
  quadrant4Fill: "#2a3446",
  quadrantPointFill: "#7fb0ed",
  xyChart: { backgroundColor: "#151b23", plotColorPalette: darkSeries },
  ...scaleVariables(darkScale, "#e7edf6"),
  ...gitVariables(["#7fb0ed", "#b39bff", "#66c3a2", "#f0c060", "#f08a73", "#5fc4d9", "#d6d66a", "#e88bb0"], "#11161d"),
  fontFamily,
};

export function configureMermaid(theme = "light") {
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
    themeVariables: theme === "dark" ? darkVariables : lightVariables,
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
