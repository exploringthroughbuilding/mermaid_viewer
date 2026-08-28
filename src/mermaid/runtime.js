import mermaid from "mermaid";
import elkLayouts from "@mermaid-js/layout-elk";
import tidyTreeLayouts from "@mermaid-js/layout-tidy-tree";
import zenuml from "@mermaid-js/mermaid-zenuml";

mermaid.registerLayoutLoaders(elkLayouts);
mermaid.registerLayoutLoaders(tidyTreeLayouts);
await mermaid.registerExternalDiagrams([zenuml]);

let renderQueue = Promise.resolve();

const darkThemeVariables = {
  darkMode: true,
  background: "#151b23",
  primaryColor: "#253348",
  primaryTextColor: "#e7edf6",
  primaryBorderColor: "#7187a5",
  secondaryColor: "#302b46",
  secondaryTextColor: "#e7edf6",
  secondaryBorderColor: "#776b9a",
  tertiaryColor: "#203b36",
  tertiaryTextColor: "#e7edf6",
  tertiaryBorderColor: "#4d8978",
  lineColor: "#8290a3",
  arrowheadColor: "#8290a3",
  textColor: "#e7edf6",
  nodeBkg: "#253348",
  nodeTextColor: "#e7edf6",
  nodeBorder: "#7187a5",
  clusterBkg: "#1c2531",
  clusterBorder: "#59677a",
  titleColor: "#e7edf6",
  edgeLabelBackground: "#302b46",
  noteBkgColor: "#3b3620",
  noteBorderColor: "#9d8750",
  noteTextColor: "#fff0b2",
  actorBkg: "#253348",
  actorBorder: "#7187a5",
  actorTextColor: "#e7edf6",
  labelBoxBkgColor: "#253348",
  labelBoxBorderColor: "#7187a5",
  labelTextColor: "#e7edf6",
  signalColor: "#e7edf6",
  signalTextColor: "#e7edf6",
  loopTextColor: "#e7edf6",
  activationBkgColor: "#302b46",
  activationBorderColor: "#776b9a",
  rectBkgColor: "#203b36",
  sectionBkgColor: "#203b36",
  sectionBkgColor2: "#253348",
  altSectionBkgColor: "#1c2531",
  excludeBkgColor: "#1c2531",
  taskBkgColor: "#253348",
  taskBorderColor: "#7187a5",
  activeTaskBkgColor: "#354863",
  activeTaskBorderColor: "#8aabd2",
  doneTaskBkgColor: "#3e4857",
  doneTaskBorderColor: "#718096",
  critBkgColor: "#6c302b",
  critBorderColor: "#e5786a",
  taskTextColor: "#e7edf6",
  taskTextLightColor: "#e7edf6",
  taskTextDarkColor: "#e7edf6",
  taskTextOutsideColor: "#e7edf6",
  taskTextClickableColor: "#a9ceff",
  gridColor: "#56657a",
  rowOdd: "#202833",
  rowEven: "#1c242e",
  stateBkg: "#253348",
  stateLabelColor: "#e7edf6",
  transitionColor: "#8290a3",
  transitionLabelColor: "#e7edf6",
  labelBackgroundColor: "#253348",
  compositeBackground: "#1c2531",
  compositeTitleBackground: "#253348",
  compositeBorder: "#7187a5",
  errorBkgColor: "#522c35",
  errorTextColor: "#ffd8de",
  requirementBackground: "#253348",
  requirementBorderColor: "#7187a5",
  requirementTextColor: "#e7edf6",
  relationColor: "#8290a3",
  relationLabelBackground: "#302b46",
  relationLabelColor: "#e7edf6",
  attributeBackgroundColorOdd: "#253348",
  attributeBackgroundColorEven: "#1f2a39",
  emUiFill: "#253348",
  emUiStroke: "#7187a5",
  emProcessorFill: "#3a2e52",
  emProcessorStroke: "#9b82c9",
  emReadModelFill: "#273c35",
  emReadModelStroke: "#70aa8d",
  emCommandFill: "#273c58",
  emCommandStroke: "#729ed1",
  emEventFill: "#553a29",
  emEventStroke: "#d29459",
  emSwimlaneBackgroundOdd: "#1c2531",
  emSwimlaneBackgroundStroke: "#3a4656",
  cScale0: "#345578",
  cScale1: "#523d78",
  cScale2: "#285e56",
  cScale3: "#6d394f",
  cScale4: "#596127",
  cScale5: "#365b74",
  cScale6: "#70455f",
  cScale7: "#2d6a61",
  cScale8: "#71482e",
  cScale9: "#494a7e",
  cScale10: "#526b3a",
  cScale11: "#6d3f6d",
  scaleLabelColor: "#e7edf6",
  xyChart: {
    backgroundColor: "#151b23",
    titleColor: "#e7edf6",
    dataLabelColor: "#e7edf6",
    legendTextColor: "#e7edf6",
    xAxisTitleColor: "#e7edf6",
    xAxisLabelColor: "#e7edf6",
    xAxisTickColor: "#e7edf6",
    xAxisLineColor: "#e7edf6",
    yAxisTitleColor: "#e7edf6",
    yAxisLabelColor: "#e7edf6",
    yAxisTickColor: "#e7edf6",
    yAxisLineColor: "#e7edf6",
    plotColorPalette: "#547da9,#8067ae,#3c897a,#9a5c3d,#7f8c42,#4f7796,#a25d7a,#a16d3d,#5a5da0,#6a8246",
  },
  cynefin: {
    boundaryColor: "#8290a3",
    arrowColor: "#8290a3",
    complexBg: "#1e4d32",
    complicatedBg: "#1f3f72",
    chaoticBg: "#6c331e",
    clearBg: "#5c430e",
    confusionBg: "#492668",
    textColor: "#e7edf6",
    labelColor: "#e7edf6",
  },
  fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif",
};

const lightThemeVariables = {
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
    themeVariables: theme === "dark" ? darkThemeVariables : lightThemeVariables,
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
