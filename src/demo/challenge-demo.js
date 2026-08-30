import readmeMarkdown from "../../README.md?raw";
import { parseMarkdownDiagrams } from "../webmcp/diagram-library.js";

const demoStart = "<!-- challenge-demo:start -->";
const demoEnd = "<!-- challenge-demo:end -->";
const startIndex = readmeMarkdown.indexOf(demoStart);
const endIndex = readmeMarkdown.indexOf(demoEnd);

if (startIndex < 0 || endIndex <= startIndex) {
  throw new Error("README.md must contain the bounded challenge demo markers.");
}

export const challengeDemoSourceName = "challenge-demo";
export const challengeDemoMarkdown = readmeMarkdown
  .slice(startIndex + demoStart.length, endIndex)
  .trim();
export const challengeDemoDiagrams = parseMarkdownDiagrams(challengeDemoMarkdown);
export const challengeDemoPrimary = challengeDemoDiagrams.find(({ title }) => title === "Service Topology")
  || challengeDemoDiagrams[0];
