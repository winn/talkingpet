// One pointer owns a stroke. A second pointer cancels that stroke and starts
// navigation; lifting one finger never silently starts painting again.
export function attachSurfaceGestures(element, callbacks) {
  const pointers = new Map();
  let mode = null;
  let previous = null;
  let stroke = null;
  const accepts =
    callbacks.acceptsEvent || ((event) => event.target === element);
  const metrics = () => {
    const p = [...pointers.values()].slice(0, 2);
    return {
      x: p.reduce((n, v) => n + v.clientX, 0) / p.length,
      y: p.reduce((n, v) => n + v.clientY, 0) / p.length,
      distance:
        p.length === 2
          ? Math.max(
              1,
              Math.hypot(
                p[1].clientX - p[0].clientX,
                p[1].clientY - p[0].clientY,
              ),
            )
          : 1,
      count: p.length,
    };
  };
  const onDown = (event) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pointers.set(event.pointerId, event);
    element.setPointerCapture(event.pointerId);
    if (pointers.size === 1) {
      mode = callbacks.shouldNavigate(event) ? "navigate" : "paint";
      stroke = {
        pointerType: event.pointerType || "mouse",
        startedAt: Date.now(),
        travel: 0,
      };
      if (mode === "paint") callbacks.start(event);
      else callbacks.navigateStart?.(event);
    } else {
      if (mode === "paint") callbacks.cancel();
      mode = "navigate";
      if (stroke) stroke.travel = Infinity;
    }
    previous = metrics();
  };
  const onMove = (event) => {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pointers.set(event.pointerId, event);
    const next = metrics();
    if (mode === "paint") callbacks.move(event);
    else if (previous && previous.count === next.count) {
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      if (stroke) stroke.travel += Math.hypot(dx, dy);
      callbacks.navigate({
        dx,
        dy,
        ratio: next.distance / previous.distance,
        x: next.x,
        y: next.y,
        count: next.count,
        pointerType: stroke?.pointerType || event.pointerType || "mouse",
      });
    }
    previous = next;
  };
  const onEnd = (event) => {
    if (!pointers.has(event.pointerId)) return;
    event.stopImmediatePropagation();
    const ending = mode;
    const summary = stroke
      ? {
          pointerType: stroke.pointerType,
          travel: stroke.travel,
          durationMs: Date.now() - stroke.startedAt,
          type: event.type,
        }
      : null;
    if (mode === "paint") {
      if (event.type === "pointerup") callbacks.end(event);
      else callbacks.cancel();
    }
    pointers.delete(event.pointerId);
    if (element.hasPointerCapture(event.pointerId))
      element.releasePointerCapture(event.pointerId);
    mode = pointers.size ? "navigate" : null;
    previous = pointers.size ? metrics() : null;
    if (!pointers.size) {
      stroke = null;
      if (ending === "navigate" && summary && event.type === "pointerup")
        callbacks.navigateEnd?.(summary);
    }
  };
  element.addEventListener("pointerdown", onDown, true);
  element.addEventListener("pointermove", onMove, true);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    element.addEventListener(type, onEnd, true);
  element.addEventListener("contextmenu", (event) => event.preventDefault());
  return {
    cancel() {
      if (mode === "paint") callbacks.cancel();
      pointers.clear();
      mode = null;
      previous = null;
      stroke = null;
    },
  };
}
