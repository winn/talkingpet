// Raycasting hits triangles, including invisible parts of facial image layers.
// Sample their alpha mask before treating a feature as a painting barrier.
const imagePixels = new WeakMap();
function pixelsFor(image) {
  if (!image) return null;
  if (image.data) return image;
  if (imagePixels.has(image)) return imagePixels.get(image);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  try {
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height);
    imagePixels.set(image, pixels);
    return pixels;
  } catch {
    // An unreadable external image must not expose its protected feature.
    imagePixels.set(image, null);
    return null;
  }
}
let _reusableUv = null;
function channelAt(texture, uv, channel) {
  const pixels = pixelsFor(texture.image);
  if (!pixels) return 1;
  let px = uv.x;
  let py = uv.y;
  if (texture.transformUv) {
    if (!_reusableUv) _reusableUv = uv.clone ? uv.clone() : { x: 0, y: 0 };
    _reusableUv.x = uv.x;
    _reusableUv.y = uv.y;
    if (texture.matrixAutoUpdate) texture.updateMatrix();
    const point = texture.transformUv(_reusableUv);
    if (point) {
      px = point.x;
      py = point.y;
    }
  }
  const x = Math.max(
    0,
    Math.min(pixels.width - 1, Math.floor(px * pixels.width)),
  );
  const y = Math.max(
    0,
    Math.min(pixels.height - 1, Math.floor(py * pixels.height)),
  );
  return pixels.data[(y * pixels.width + x) * 4 + channel] / 255;
}
export function isVisibleTexel(material, uv) {
  if (material.visible === false || material.opacity === 0) return false;
  if (!material.transparent && !material.alphaTest) return true;
  let alpha = material.opacity ?? 1;
  if (material.map) alpha *= channelAt(material.map, uv, 3);
  if (material.alphaMap) alpha *= channelAt(material.alphaMap, uv, 1);
  return alpha >= Math.max(material.alphaTest || 0, 0.01);
}
export function pickPaintIntersection(intersections, isPaintable) {
  for (const hit of intersections) {
    if (!hit.uv || !hit.object.visible) continue;
    const material = Array.isArray(hit.object.material)
      ? hit.object.material[hit.face?.materialIndex || 0]
      : hit.object.material;
    if (!material || !isVisibleTexel(material, hit.uv)) continue;
    return isPaintable(material.name) ? hit : null;
  }
  return null;
}
// Follow the pointer's path in screen space before projecting to the texture.
// This avoids sparse dots at fast speeds and straight lines across UV islands.
export function createProjectedStroke({
  project,
  start,
  move,
  finish,
  cancel,
  spacing = 2,
  maxSteps = 40,
}) {
  let previous = null;
  const sample = (event) => ({
    clientX: event.clientX,
    clientY: event.clientY,
  });
  return {
    start(event) {
      previous = sample(event);
      start(project(previous));
    },
    move(event) {
      const coalesced = event.getCoalescedEvents?.() || [];
      const events = coalesced.length ? [...coalesced, event] : [event];
      for (const nextEvent of events) {
        const next = sample(nextEvent);
        if (!previous) {
          previous = next;
          move(project(next));
          continue;
        }
        const distance = Math.hypot(
          next.clientX - previous.clientX,
          next.clientY - previous.clientY,
        );
        if (!distance) continue;
        const steps = Math.min(
          maxSteps,
          Math.max(1, Math.ceil(distance / spacing)),
        );
        for (let step = 1; step <= steps; step++) {
          const t = step / steps;
          move(
            project({
              clientX: previous.clientX + (next.clientX - previous.clientX) * t,
              clientY: previous.clientY + (next.clientY - previous.clientY) * t,
            }),
          );
        }
        previous = next;
      }
    },
    end(event) {
      if (previous) this.move(event);
      previous = null;
      finish();
    },
    cancel() {
      previous = null;
      cancel();
    },
  };
}
