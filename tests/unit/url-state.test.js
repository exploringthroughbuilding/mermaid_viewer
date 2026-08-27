import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode, buildShareUrl, decodeSharedSource, encodeShareHash, readLaunchOptions } from "../../src/viewer/url-state.js";

const source = "flowchart LR\n  A[Start] --> B{Valid?}\n  B -->|yes| C[(Store)]";

describe("share links", () => {
  it("round-trips source through a mermaid.live compatible pako hash", async () => {
    const hash = await encodeShareHash(source);
    expect(hash.startsWith("#pako:")).toBe(true);
    expect(await decodeSharedSource(hash)).toBe(source);
  });

  it("decodes base64 state and raw code hashes", async () => {
    const state = new TextEncoder().encode(JSON.stringify({ code: source, mermaid: "{}" }));
    expect(await decodeSharedSource(`#base64:${base64UrlEncode(state)}`)).toBe(source);
    expect(await decodeSharedSource(`#code:${base64UrlEncode(new TextEncoder().encode(source))}`)).toBe(source);
    expect(await decodeSharedSource("#something-else")).toBeUndefined();
    expect(await decodeSharedSource("")).toBeUndefined();
  });

  it("uses URL-safe base64 without padding", () => {
    const bytes = Uint8Array.from([251, 255, 191, 0, 1]);
    const encoded = base64UrlEncode(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect([...base64UrlDecode(encoded)]).toEqual([...bytes]);
  });

  it("builds a share URL that drops one-shot parameters and keeps the theme", async () => {
    const url = new URL(await buildShareUrl({ href: "http://localhost:5173/?src=/x.mmd&block=2&select=A&theme=light" }, source, { theme: "dark" }));
    expect(url.searchParams.get("src")).toBeNull();
    expect(url.searchParams.get("block")).toBeNull();
    expect(url.searchParams.get("theme")).toBe("dark");
    expect(await decodeSharedSource(url.hash)).toBe(source);
  });
});

describe("launch options", () => {
  it("reads and validates query parameters", () => {
    const options = readLaunchOptions({ search: "?src=https://example.com/a.md&block=3&theme=dark&select=API&example=x", hash: "#pako:abc" });
    expect(options).toEqual({ src: "https://example.com/a.md", example: "x", block: 3, theme: "dark", select: "API", hash: "#pako:abc" });
  });

  it("ignores invalid values", () => {
    const options = readLaunchOptions({ search: "?block=zero&theme=blue", hash: "" });
    expect(options.block).toBeUndefined();
    expect(options.theme).toBeUndefined();
    expect(options.src).toBeUndefined();
  });
});
