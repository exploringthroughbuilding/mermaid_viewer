// Opens the viewer from a URL and produces shareable links.
//
//   ?src=<url>            fetch Mermaid or Markdown from a URL (same-origin or CORS-enabled)
//   ?example=<id>         load a catalog example
//   ?block=<n>            pick the n-th fenced block of a Markdown import (1-based)
//   ?theme=dark|light     force the appearance
//   ?select=<node key>    select a node once rendered
//   #pako:<data>          mermaid.live compatible compressed source
//   #base64:<data>        mermaid.live compatible JSON state
//   #code:<data>          base64url-encoded raw source

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function base64UrlEncode(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(text) {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function pipeThrough(bytes, stream) {
  const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

export const deflate = (bytes) => pipeThrough(bytes, new CompressionStream("deflate"));
export const inflate = (bytes) => pipeThrough(bytes, new DecompressionStream("deflate"));

function codeFromState(text) {
  try {
    const state = JSON.parse(text);
    if (state && typeof state.code === "string") return state.code;
  } catch {
    // Not JSON: the payload is the raw diagram source.
  }
  return text;
}

export async function decodeSharedSource(hash) {
  const match = String(hash || "").match(/^#(pako|base64|code):(.+)$/);
  if (!match) return undefined;
  const [, format, payload] = match;
  const bytes = base64UrlDecode(payload);
  const text = format === "pako" ? textDecoder.decode(await inflate(bytes)) : textDecoder.decode(bytes);
  return format === "code" ? text : codeFromState(text);
}

export async function encodeShareHash(code) {
  const state = JSON.stringify({ code, mermaid: JSON.stringify({ theme: "default" }), autoSync: true, updateDiagram: true });
  return `#pako:${base64UrlEncode(await deflate(textEncoder.encode(state)))}`;
}

export function readLaunchOptions(location = window.location) {
  const params = new URLSearchParams(location.search);
  const block = Number.parseInt(params.get("block") || "", 10);
  return {
    src: params.get("src") || undefined,
    example: params.get("example") || undefined,
    block: Number.isFinite(block) && block > 0 ? block : undefined,
    theme: ["dark", "light"].includes(params.get("theme")) ? params.get("theme") : undefined,
    select: params.get("select") || undefined,
    hash: location.hash || "",
  };
}

export async function buildShareUrl(location, code, { theme } = {}) {
  const url = new URL(location.href);
  ["src", "example", "block", "select"].forEach((key) => url.searchParams.delete(key));
  if (theme) url.searchParams.set("theme", theme);
  else url.searchParams.delete("theme");
  url.hash = await encodeShareHash(code);
  return url.toString();
}

export async function fetchSource(src) {
  const response = await fetch(src, { credentials: "omit" });
  if (!response.ok) throw new Error(`Could not load ${src} (${response.status})`);
  return response.text();
}
