// Screen-space geometry helpers used to tie rendered edges to nodes when the
// SVG carries no endpoint metadata, and to keep viewport moves minimal.

export function screenBox(element) {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
    cx: rect.left + rect.width / 2,
    cy: rect.top + rect.height / 2,
  };
}

export function unionBoxes(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return undefined;
  const left = Math.min(...valid.map((box) => box.left));
  const top = Math.min(...valid.map((box) => box.top));
  const right = Math.max(...valid.map((box) => box.right));
  const bottom = Math.max(...valid.map((box) => box.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

export function boxArea(box) {
  return box ? Math.max(0, box.width) * Math.max(0, box.height) : 0;
}

function toScreen(element, x, y) {
  const matrix = element.getScreenCTM?.();
  if (!matrix) return { x, y };
  return { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
}

// Start / end / midpoint of a line-like element in screen coordinates.
export function pathEndpoints(element) {
  const tag = element.tagName.toLowerCase();
  try {
    if (tag === "line") {
      const start = toScreen(element, element.x1.baseVal.value, element.y1.baseVal.value);
      const end = toScreen(element, element.x2.baseVal.value, element.y2.baseVal.value);
      return { start, end, middle: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } };
    }
    if ((tag === "polyline" || tag === "polygon") && element.points?.numberOfItems) {
      const first = element.points.getItem(0);
      const last = element.points.getItem(element.points.numberOfItems - 1);
      const start = toScreen(element, first.x, first.y);
      const end = toScreen(element, last.x, last.y);
      return { start, end, middle: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } };
    }
    if (typeof element.getTotalLength === "function") {
      const length = element.getTotalLength();
      const first = element.getPointAtLength(0);
      const last = element.getPointAtLength(length);
      const mid = element.getPointAtLength(length / 2);
      return { start: toScreen(element, first.x, first.y), end: toScreen(element, last.x, last.y), middle: toScreen(element, mid.x, mid.y) };
    }
  } catch {
    // Detached or non-rendered geometry falls back to the bounding box below.
  }
  const box = screenBox(element);
  return { start: { x: box.left, y: box.top }, end: { x: box.right, y: box.bottom }, middle: { x: box.cx, y: box.cy } };
}

function distanceToBox(point, box) {
  const dx = Math.max(box.left - point.x, 0, point.x - box.right);
  const dy = Math.max(box.top - point.y, 0, point.y - box.bottom);
  return Math.hypot(dx, dy);
}

// Uniform grid over screen boxes so endpoint lookups stay cheap on big graphs.
export function createBoxIndex(entries, cellSize = 240) {
  const cells = new Map();
  const cellKey = (x, y) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
  entries.forEach((entry) => {
    const { box } = entry;
    for (let x = Math.floor(box.left / cellSize); x <= Math.floor(box.right / cellSize); x += 1) {
      for (let y = Math.floor(box.top / cellSize); y <= Math.floor(box.bottom / cellSize); y += 1) {
        const key = `${x},${y}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(entry);
      }
    }
  });

  const candidates = (point, radius) => {
    const found = new Set();
    for (let x = Math.floor((point.x - radius) / cellSize); x <= Math.floor((point.x + radius) / cellSize); x += 1) {
      for (let y = Math.floor((point.y - radius) / cellSize); y <= Math.floor((point.y + radius) / cellSize); y += 1) {
        cells.get(`${x},${y}`)?.forEach((entry) => found.add(entry));
      }
    }
    return [...found];
  };

  return {
    // Smallest box containing the point (expanded by `tolerance`).
    locate(point, tolerance = 0) {
      let best;
      candidates(point, tolerance).forEach((entry) => {
        const { box } = entry;
        if (point.x < box.left - tolerance || point.x > box.right + tolerance || point.y < box.top - tolerance || point.y > box.bottom + tolerance) return;
        if (!best || boxArea(box) < boxArea(best.box)) best = entry;
      });
      return best;
    },
    // Closest box within `maxDistance`. The "column" metric only measures the
    // horizontal offset, which is how sequence lifelines relate to messages.
    nearest(point, maxDistance, metric = "box") {
      let best;
      let bestDistance = Infinity;
      const pool = metric === "column" ? entries : candidates(point, maxDistance);
      pool.forEach((entry) => {
        const distance = metric === "column" ? Math.abs(point.x - entry.box.cx) : distanceToBox(point, entry.box);
        if (distance < bestDistance) {
          best = entry;
          bestDistance = distance;
        }
      });
      return bestDistance <= maxDistance ? best : undefined;
    },
  };
}
