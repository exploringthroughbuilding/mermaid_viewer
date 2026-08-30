const maxEntries = 40;
const entries = [];
let view = null;
let listElement = null;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function ensureView() {
  if (view?.trigger?.isConnected) return view;

  const trigger = document.querySelector("#agent-activity-trigger");
  const dialog = document.querySelector("#agent-activity-dialog");
  listElement = document.querySelector("#agent-activity-list");
  if (!trigger || !dialog || !listElement) return null;

  view = {
    trigger,
    dialog,
    count: document.querySelector("#agent-activity-count"),
    latestAction: document.querySelector("#latest-agent-action"),
    latestTime: document.querySelector("#latest-agent-time"),
  };
  trigger.addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();
  });
  return view;
}

function summarizeInput(input) {
  const parts = Object.entries(input || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? `${value.length} items` : String(value).slice(0, 34)}`);
  return parts.join(" · ");
}

function paint() {
  const activityView = ensureView();
  if (!activityView) return;

  const latest = entries.at(-1);
  activityView.count.textContent = `${entries.length} ${entries.length === 1 ? "action" : "actions"}`;
  activityView.trigger.disabled = entries.length === 0;
  activityView.trigger.classList.remove("idle", "running", "ok", "failed");
  activityView.trigger.classList.add(latest?.status || "idle");
  activityView.latestAction.textContent = latest?.name || "No actions yet";
  activityView.latestTime.textContent = latest ? (latest.duration != null ? `${latest.duration}ms` : "running") : "";
  activityView.trigger.setAttribute(
    "aria-label",
    latest ? `Open agent activity. Latest action: ${latest.name}, ${latest.status}.` : "Open agent activity. No agent actions yet.",
  );
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
  ensureView();
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
  ensureView();
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
