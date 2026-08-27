// Pan / zoom state for the canvas. Programmatic moves are animated and keep
// the current zoom whenever the target already fits, so browsing neighbours
// never throws the user out to an overview.
const MIN_SCALE = 0.03;
const MAX_SCALE = 4;

export function createViewport({ viewport, stage, zoomOutput, getSensitivity }) {
  const state = { x: 0, y: 0, scale: 1 };
  let revision = 0;
  let animationTimer;

  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const apply = (animated = false) => {
    revision += 1;
    window.clearTimeout(animationTimer);
    if (animated && !reducedMotion()) {
      stage.style.transition = "transform 260ms cubic-bezier(.2, .7, .2, 1)";
      animationTimer = window.setTimeout(() => { stage.style.transition = "none"; }, 300);
    } else stage.style.transition = "none";
    stage.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
    zoomOutput.value = `${Math.round(state.scale * 100)}%`;
    zoomOutput.textContent = zoomOutput.value;
  };

  const viewportRect = () => viewport.getBoundingClientRect();

  // Converts screen boxes (from getBoundingClientRect) into stage coordinates.
  const toGraphBox = (box) => {
    const rect = viewportRect();
    return {
      left: (box.left - rect.left - state.x) / state.scale,
      right: (box.right - rect.left - state.x) / state.scale,
      top: (box.top - rect.top - state.y) / state.scale,
      bottom: (box.bottom - rect.top - state.y) / state.scale,
    };
  };

  const unionGraphBox = (elements) => {
    const boxes = elements.map((element) => toGraphBox(element.getBoundingClientRect()));
    if (!boxes.length) return undefined;
    return {
      left: Math.min(...boxes.map((box) => box.left)),
      right: Math.max(...boxes.map((box) => box.right)),
      top: Math.min(...boxes.map((box) => box.top)),
      bottom: Math.max(...boxes.map((box) => box.bottom)),
    };
  };

  const centerOn = (box, scale, animated) => {
    const rect = viewportRect();
    state.scale = scale;
    state.x = rect.width / 2 - ((box.left + box.right) / 2) * scale;
    state.y = rect.height / 2 - ((box.top + box.bottom) / 2) * scale;
    apply(animated);
  };

  const fitScaleFor = (box, margin) => {
    const rect = viewportRect();
    return Math.min((rect.width - margin) / Math.max(1, box.right - box.left), (rect.height - margin) / Math.max(1, box.bottom - box.top));
  };

  const setZoom = (nextScale, clientX, clientY, animated = false) => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    const rect = viewportRect();
    const pointX = clientX == null ? rect.width / 2 : clientX - rect.left;
    const pointY = clientY == null ? rect.height / 2 : clientY - rect.top;
    const graphX = (pointX - state.x) / state.scale;
    const graphY = (pointY - state.y) / state.scale;
    state.x = pointX - graphX * scale;
    state.y = pointY - graphY * scale;
    state.scale = scale;
    apply(animated);
  };

  const fit = (animated = false) => {
    const svg = stage.querySelector("svg");
    if (!svg) return;
    const viewBox = svg.viewBox.baseVal;
    const width = viewBox.width || svg.getBBox().width;
    const height = viewBox.height || svg.getBBox().height;
    const rect = viewportRect();
    const scale = Math.max(MIN_SCALE, Math.min((rect.width - 72) / width, (rect.height - 72) / height, 1.25));
    state.scale = scale;
    state.x = (rect.width - width * scale) / 2;
    state.y = (rect.height - height * scale) / 2;
    apply(animated);
  };

  // Explicit "zoom here": readable zoom, but never zoom out unless the node
  // cannot fit at the current scale.
  const zoomToElement = (element, animated = true) => {
    if (!element) return;
    const box = unionGraphBox([element]);
    let scale = Math.min(2.5, Math.max(0.9, state.scale));
    const fitScale = fitScaleFor(box, 160);
    if (scale > fitScale) scale = Math.max(0.2, fitScale);
    centerOn(box, scale, animated);
  };

  // Brings elements into view with the smallest possible change: no move when
  // visible, a pan when they fit, and a zoom-out only as a last resort.
  const reveal = (elements, animated = true) => {
    const box = unionGraphBox(elements.filter(Boolean));
    if (!box) return false;
    const rect = viewportRect();
    const margin = 28;
    const screen = {
      left: box.left * state.scale + state.x,
      right: box.right * state.scale + state.x,
      top: box.top * state.scale + state.y,
      bottom: box.bottom * state.scale + state.y,
    };
    if (screen.left >= margin && screen.top >= margin && screen.right <= rect.width - margin && screen.bottom <= rect.height - margin) return false;
    const fitScale = fitScaleFor(box, margin * 2);
    centerOn(box, fitScale >= state.scale ? state.scale : Math.max(0.2, fitScale), animated);
    return true;
  };

  let drag = null;
  let suppressClick = false;
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("[data-graph-key]")) return;
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: state.x, originY: state.y, moved: false };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("dragging");
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    drag.moved ||= Math.abs(dx) + Math.abs(dy) > 4;
    state.x = drag.originX + dx * getSensitivity().pan;
    state.y = drag.originY + dy * getSensitivity().pan;
    apply();
  });
  const endDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      event.preventDefault();
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
    viewport.releasePointerCapture(event.pointerId);
    viewport.classList.remove("dragging");
    drag = null;
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);
  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    const sensitivity = getSensitivity();
    if (sensitivity.device === "trackpad" && !event.ctrlKey) {
      state.x -= event.deltaX * sensitivity.pan;
      state.y -= event.deltaY * sensitivity.pan;
      apply();
      return;
    }
    setZoom(state.scale * Math.exp(-event.deltaY * 0.0015 * sensitivity.zoom), event.clientX, event.clientY);
  }, { passive: false });

  let gesture = null;
  viewport.addEventListener("gesturestart", (event) => {
    if (getSensitivity().device !== "trackpad") return;
    event.preventDefault();
    gesture = { initialScale: state.scale, clientX: event.clientX, clientY: event.clientY };
  }, { passive: false });
  viewport.addEventListener("gesturechange", (event) => {
    if (!gesture || getSensitivity().device !== "trackpad") return;
    event.preventDefault();
    const rawScale = Math.max(0.01, Number(event.scale) || 1);
    setZoom(
      gesture.initialScale * Math.pow(rawScale, getSensitivity().zoom),
      Number.isFinite(event.clientX) ? event.clientX : gesture.clientX,
      Number.isFinite(event.clientY) ? event.clientY : gesture.clientY,
    );
  }, { passive: false });
  const endGesture = () => { gesture = null; };
  viewport.addEventListener("gestureend", endGesture);
  viewport.addEventListener("gesturecancel", endGesture);

  return {
    state,
    get revision() { return revision; },
    apply,
    setZoom,
    fit,
    zoomToElement,
    reveal,
    consumeSuppressedClick() {
      const suppressed = suppressClick;
      suppressClick = false;
      return suppressed;
    },
  };
}
