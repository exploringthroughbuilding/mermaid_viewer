const maxEntries = 40;
const entries = [];
let panel = null;
let listElement = null;
let collapsed = false;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function syncTheme() {
  if (!panel) return;
  panel.dataset.theme = document.querySelector(".app-root")?.dataset.theme || "light";
}

window.addEventListener("atlas-theme-change", syncTheme);

function ensurePanel() {
  if (panel) return panel;
  panel = document.createElement("aside");
  panel.className = "agent-activity";
  panel.setAttribute("aria-label", "Agent activity");
  panel.innerHTML = `
    <header class="agent-activity-head">
      <span class="agent-activity-dot" aria-hidden="true"></span>
      <p>Agent activity</p>
      <span class="agent-activity-count">0</span>
      <button type="button" class="agent-activity-toggle" aria-expanded="true" aria-label="Collapse agent activity">–</button>
    </header>
    <ol class="agent-activity-list" aria-live="polite"></ol>`;
  document.body.append(panel);
  syncTheme();
  listElement = panel.querySelector(".agent-activity-list");
  panel.querySelector(".agent-activity-toggle").addEventListener("click", () => {
    collapsed = !collapsed;
    panel.classList.toggle("collapsed", collapsed);
    const toggle = panel.querySelector(".agent-activity-toggle");
    toggle.textContent = collapsed ? "+" : "–";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} agent activity`);
  });
  return panel;
}

function summarizeInput(input) {
  const parts = Object.entries(input || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? `${value.length} items` : String(value).slice(0, 34)}`);
  return parts.join(" · ");
}

function paint() {
  const view = ensurePanel();
  view.querySelector(".agent-activity-count").textContent = String(entries.length);
  listElement.innerHTML = entries
    .slice()
    .reverse()
    .map((entry) => `
      <li class="agent-activity-item ${entry.status}">
        <div class="agent-activity-row">
          <code>${escapeHTML(entry.name)}</code>
          <span class="agent-activity-time">${entry.duration != null ? `${entry.duration}ms` : "…"}</span>
        </div>
        ${entry.input ? `<p class="agent-activity-args">${escapeHTML(entry.input)}</p>` : ""}
        ${entry.detail ? `<p class="agent-activity-detail">${escapeHTML(entry.detail)}</p>` : ""}
      </li>`)
    .join("");
}

/**
 * Every tool call is shown to the human running the page. Agent actions that
 * change what someone is looking at should never be invisible to them.
 */
export function logToolCall(name, input) {
  ensurePanel();
  const entry = { name, input: summarizeInput(input), status: "running", detail: "", startedAt: performance.now(), duration: null };
  entries.push(entry);
  if (entries.length > maxEntries) entries.shift();
  paint();
  return {
    succeed(detail) {
      entry.status = "ok";
      entry.detail = detail || "";
      entry.duration = Math.round(performance.now() - entry.startedAt);
      paint();
    },
    fail(detail) {
      entry.status = "failed";
      entry.detail = detail || "";
      entry.duration = Math.round(performance.now() - entry.startedAt);
      paint();
    },
  };
}

export function announceReady(toolNames, mode) {
  ensurePanel();
  entries.push({
    name: `webmcp:${mode}`,
    input: `${toolNames.length} tools registered`,
    status: "ok",
    detail: toolNames.join(", "),
    duration: 0,
  });
  paint();
}

export function activityEntries() {
  return entries.slice();
}
