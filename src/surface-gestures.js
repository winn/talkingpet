// One pointer owns a stroke. A second pointer cancels that stroke and starts
// navigation; lifting one finger never silently starts painting again.
export function attachSurfaceGestures(element, callbacks) {
  const pointers = new Map();
  let mode = null;
  let previous = null;
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
    if (event.target !== element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pointers.set(event.pointerId, event);
    element.setPointerCapture(event.pointerId);
    if (pointers.size === 1) {
      mode = callbacks.shouldNavigate(event) ? "navigate" : "paint";
      if (mode === "paint") callbacks.start(event);
    } else {
      if (mode === "paint") callbacks.cancel();
      mode = "navigate";
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
    else if (previous && previous.count === next.count)
      callbacks.navigate({
        dx: next.x - previous.x,
        dy: next.y - previous.y,
        ratio: next.distance / previous.distance,
        x: next.x,
        y: next.y,
        count: next.count,
      });
    previous = next;
  };
  const onEnd = (event) => {
    if (!pointers.has(event.pointerId)) return;
    event.stopImmediatePropagation();
    if (mode === "paint") {
      if (event.type === "pointerup") callbacks.end(event);
      else callbacks.cancel();
    }
    pointers.delete(event.pointerId);
    if (element.hasPointerCapture(event.pointerId))
      element.releasePointerCapture(event.pointerId);
    mode = pointers.size ? "navigate" : null;
    previous = pointers.size ? metrics() : null;
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
    },
  };
}
