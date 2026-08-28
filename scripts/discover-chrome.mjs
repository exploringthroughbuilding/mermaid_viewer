import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const installedFallbacks = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

/**
 * Resolve a Chrome binary without hard-coding anyone's home directory: prefer
 * the newest Chrome for Testing under the puppeteer cache, then a system install.
 */
export function discoverChrome() {
  const cache = join(homedir(), ".cache", "puppeteer", "chrome");
  if (existsSync(cache)) {
    const builds = readdirSync(cache).sort().reverse();
    for (const build of builds) {
      const candidates = [
        join(cache, build, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        join(cache, build, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        join(cache, build, "chrome-linux64", "chrome"),
        join(cache, build, "chrome-win64", "chrome.exe"),
      ];
      const found = candidates.find((candidate) => existsSync(candidate));
      if (found) return found;
    }
  }
  const installed = installedFallbacks.find((candidate) => existsSync(candidate));
  if (installed) return installed;
  throw new Error("No Chrome binary found. Set CHROME_PATH to a Chrome executable.");
}
