/**
 * Prevents mobile browser viewport zooming (pinch-to-zoom, gesture zoom,
 * trackpad ctrl-zoom) on the page itself, while preserving the internal
 * 2D canvas and 3D model pinch-to-zoom gestures.
 */
export function initPreventPageZoom(
  targetWindow = typeof window !== "undefined" ? window : null,
) {
  if (!targetWindow || !targetWindow.document) return;

  const doc = targetWindow.document;

  // 1. Prevent iOS Safari gesture events from scaling the browser viewport.
  // Custom 2D/3D pinch zoom is handled separately via Pointer Events on the canvases.
  const preventGesture = (e) => {
    e.preventDefault();
  };
  doc.addEventListener("gesturestart", preventGesture, { passive: false });
  doc.addEventListener("gesturechange", preventGesture, { passive: false });
  doc.addEventListener("gestureend", preventGesture, { passive: false });

  // 2. Prevent multi-touch pinch zoom on the webpage.
  // Single-touch scrolling (touches.length === 1) in scrollable panels remains enabled.
  doc.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches && e.touches.length > 1) {
        e.preventDefault();
      }
    },
    { passive: false },
  );

  // 3. Prevent trackpad / Ctrl + wheel zooming of the webpage.
  doc.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    },
    { passive: false },
  );
}
