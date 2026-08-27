// Graph Index panel: flat or grouped node list with search and sorting. The
// list is rebuilt only when its inputs change; selection just toggles a class.
export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

const comparators = {
  "label-asc": (a, b) => a.label.localeCompare(b.label),
  "label-desc": (a, b) => b.label.localeCompare(a.label),
  "connections-desc": (a, b) => b.connections - a.connections || a.label.localeCompare(b.label),
  "connections-asc": (a, b) => a.connections - b.connections || a.label.localeCompare(b.label),
};

function nodeItem({ key, label, connections }, selectedKey) {
  return `<button type="button" data-node-key="${escapeHTML(key)}" class="node-index-item${key === selectedKey ? " active" : ""}"><span>${escapeHTML(label)}</span><small>${connections}</small></button>`;
}

export function createIndexPanel({ container }) {
  let selectedKey = null;

  return {
    render(graph, { query = "", grouped = false, sort = "label-asc", collapsed = new Set(), selected = null, emptyMessage }) {
      selectedKey = selected;
      const needle = query.trim().toLocaleLowerCase();
      const compare = comparators[sort] || comparators["label-asc"];
      const matches = (node) => !needle || `${node.label} ${node.key} ${node.groupLabel || ""}`.toLocaleLowerCase().includes(needle);
      const visible = [...graph.nodes.values()].filter(matches);

      if (!visible.length) {
        container.className = "node-list empty-state";
        container.textContent = graph.nodes.size ? "No items match that search." : emptyMessage;
        return;
      }
      if (!grouped) {
        container.className = "node-list";
        container.innerHTML = visible.sort(compare).map((node) => nodeItem(node, selectedKey)).join("");
        return;
      }
      container.className = "node-list grouped";
      container.innerHTML = graph.groups.map((group) => {
        const nodes = group.nodes.filter(matches).sort(compare);
        if (!nodes.length) return "";
        const expanded = !collapsed.has(group.key);
        return `
          <section class="node-index-group" data-group-key="${escapeHTML(group.key)}">
            <header>
              <button type="button" class="group-heading-button" data-group-toggle="${escapeHTML(group.key)}" aria-expanded="${expanded}" title="${escapeHTML(group.label)}">
                <span><i aria-hidden="true"></i>${escapeHTML(group.label)}</span><small>${nodes.length}</small>
              </button>
            </header>
            <div class="group-items"${expanded ? "" : " hidden"}>${nodes.map((node) => nodeItem(node, selectedKey)).join("")}</div>
          </section>`;
      }).join("");
    },
    setActive(key) {
      if (key === selectedKey) return;
      if (selectedKey != null) container.querySelector(`[data-node-key="${CSS.escape(selectedKey)}"]`)?.classList.remove("active");
      selectedKey = key;
      if (key != null) container.querySelector(`[data-node-key="${CSS.escape(key)}"]`)?.classList.add("active");
    },
  };
}
