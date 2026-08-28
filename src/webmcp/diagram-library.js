const storageKey = "mermaid-atlas-library:v1";
const fencedMermaid = /^([ \t]*)```+[ \t]*mermaid[^\n]*\n([\s\S]*?)^\1```+[ \t]*$/gim;
const headingLine = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

export function slugify(value, fallback = "diagram") {
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

/**
 * Fenced blocks are located by index rather than by line so that a ``` sequence
 * inside a diagram label cannot desynchronise the heading walk.
 */
function headingPathAt(markdown, offset) {
  const path = [];
  let cursor = 0;
  for (const line of markdown.slice(0, offset).split("\n")) {
    cursor += line.length + 1;
    const heading = headingLine.exec(line);
    if (!heading) continue;
    const depth = heading[1].length;
    path.length = Math.min(path.length, depth - 1);
    path[depth - 1] = heading[2].trim();
  }
  void cursor;
  return path.filter(Boolean);
}

function titleFromSource(source, index) {
  const declaration = source.split("\n").find((line) => line.trim() && !line.trim().startsWith("%%"));
  return `${declaration?.trim().slice(0, 40) || "Diagram"} ${index + 1}`;
}

/**
 * Extract every fenced `mermaid` block from Markdown, titled by the nearest
 * enclosing heading so an agent can list diagrams by the name a human wrote.
 */
export function parseMarkdownDiagrams(markdown) {
  const text = String(markdown ?? "");
  const diagrams = [];
  fencedMermaid.lastIndex = 0;
  for (let match = fencedMermaid.exec(text); match; match = fencedMermaid.exec(text)) {
    const source = match[2].replace(/[ \t]+$/gm, "").trim();
    if (!source) continue;
    const headingPath = headingPathAt(text, match.index);
    const index = diagrams.length;
    diagrams.push({
      title: headingPath.at(-1) || titleFromSource(source, index),
      headingPath,
      source,
      index,
    });
  }
  return diagrams;
}

export function hasMermaidBlocks(markdown) {
  fencedMermaid.lastIndex = 0;
  return fencedMermaid.test(String(markdown ?? ""));
}

function uniqueId(preferred, taken) {
  const base = slugify(preferred);
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function normalizeEntry(entry, taken) {
  const id = entry.id && !taken.has(entry.id) ? entry.id : uniqueId(entry.id || entry.title, taken);
  taken.add(id);
  return {
    id,
    title: String(entry.title || id),
    source: String(entry.source || ""),
    origin: entry.origin || "manual",
    headingPath: Array.isArray(entry.headingPath) ? entry.headingPath : [],
    updatedAt: entry.updatedAt || new Date().toISOString(),
  };
}

export function readLibrary() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    const taken = new Set();
    return parsed.filter((entry) => entry && entry.source).map((entry) => normalizeEntry(entry, taken));
  } catch {
    // A corrupt or unavailable store must never block rendering.
    return [];
  }
}

export function writeLibrary(entries) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(entries));
    return true;
  } catch {
    // Quota or private-mode failures degrade to an in-session library.
    return false;
  }
}

/**
 * Insert or replace one diagram. Matching an existing id updates in place so an
 * agent calling upsert twice does not fork the library.
 */
export function upsertDiagram(entries, { id, title, source, origin = "agent", headingPath = [] }) {
  const existingIndex = id ? entries.findIndex((entry) => entry.id === id) : -1;
  if (existingIndex >= 0) {
    const next = entries.slice();
    next[existingIndex] = {
      ...next[existingIndex],
      title: title || next[existingIndex].title,
      source,
      origin,
      updatedAt: new Date().toISOString(),
    };
    return { entries: next, id: next[existingIndex].id, created: false };
  }
  const taken = new Set(entries.map((entry) => entry.id));
  const created = normalizeEntry({ id, title: title || id, source, origin, headingPath }, taken);
  return { entries: [...entries, created], id: created.id, created: true };
}

export function importMarkdown(entries, markdown, { sourceName = "import" } = {}) {
  const taken = new Set(entries.map((entry) => entry.id));
  const imported = parseMarkdownDiagrams(markdown).map((diagram) => normalizeEntry({
    id: uniqueId(`${sourceName}-${diagram.title}`, taken),
    title: diagram.title,
    source: diagram.source,
    origin: sourceName,
    headingPath: diagram.headingPath,
  }, taken));
  return { entries: [...entries, ...imported], imported };
}
