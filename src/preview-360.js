import { t } from "./i18n.js";
/**
 * ─── 360 Preview Camera & Zoom Configuration ───
 * You can manually tweak these values here to adjust the 360 preview:
 *
 * - `zoomFactor`: Camera zoom / framing tightener.
 *   - Higher values (e.g. 1.4 - 1.6) zoom in CLOSER (makes pet larger).
 *   - Lower values (e.g. 1.0 - 1.1) zoom OUT (makes pet smaller).
 * - `pitchAngleDeg`: Downward pitch angle of camera in degrees (e.g. 10° - 15°).
 * - `targetResolution`: Resolution (px) of the square captured frames (e.g. 512).
 * - `cameraDistance`: Direct distance override in meters. If set to a number (e.g. 1.3),
 *   it directly overrides automatic distance calculation. Default is null (auto-calculated).
 */
export const PREVIEW_360_CONFIG = {
  zoomFactor: 0.9, // Zoom in to fill ~90-95% of the square card
  pitchAngleDeg: 12, // Natural downward view angle
  targetResolution: 512, // 1:1 square aspect for preview cards
  cameraDistance: null, // Set to e.g. 1.3 to hardcode exact camera distance
};

export function calculateRotationAngles(steps = 18) {
  const stepSize = 360 / steps;
  return Array.from({ length: steps }, (_, i) => i * stepSize);
}

export async function capture360Frames(
  renderer,
  scene,
  camera,
  vrm,
  steps = 18,
  options = {},
) {
  if (!renderer || !scene || !camera || !vrm) return [];
  const angles = calculateRotationAngles(steps);
  const frames = [];

  const config = { ...PREVIEW_360_CONFIG, ...options };

  const originalPos = camera.position.clone();
  const originalRot = vrm.scene.rotation.y;
  const originalQuaternion = camera.quaternion.clone();
  const originalAspect = camera.aspect;

  const THREE =
    (typeof window !== "undefined" && window.THREE) || globalThis.THREE;
  if (!THREE) {
    console.warn("[preview-360] THREE not found, skipping 360 preview capture");
    return [];
  }

  const originalSize = new THREE.Vector2();
  if (typeof renderer.getSize === "function") {
    renderer.getSize(originalSize);
  }

  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  try {
    // Temporarily switch renderer and camera to square 1:1 so preview cards fit edge-to-edge
    const targetRes = config.targetResolution || 512;
    if (typeof renderer.setSize === "function") {
      renderer.setSize(targetRes, targetRes, false);
    }
    camera.aspect = 1.0;
    camera.updateProjectionMatrix();

    const fovRad = (camera.fov * Math.PI) / 180;
    const tanHalfFov = Math.tan(fovRad / 2);

    let distance;
    if (
      typeof config.cameraDistance === "number" &&
      config.cameraDistance > 0
    ) {
      distance = config.cameraDistance;
    } else {
      // Frame based on vertical height and depth
      const maxDim = Math.max(size.y, size.x, size.z * 0.85);
      const fitDistance = maxDim / (2 * tanHalfFov);
      const zoom = config.zoomFactor > 0 ? config.zoomFactor : 1.4;
      distance = fitDistance / zoom;
    }

    // Set slight downward angle
    const pitchRad = (config.pitchAngleDeg * Math.PI) / 180;
    const pitchHeight = center.y + distance * Math.sin(pitchRad);
    const horizontalDist = distance * Math.cos(pitchRad);

    camera.position.set(0, pitchHeight, horizontalDist);
    camera.lookAt(center.x, center.y, center.z);

    for (const deg of angles) {
      vrm.scene.rotation.y = (deg * Math.PI) / 180;
      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL("image/webp", 0.85);
      frames.push(dataUrl);
    }
  } finally {
    // Restore original position, rotation, renderer buffer size, and camera aspect
    vrm.scene.rotation.y = originalRot;
    camera.position.copy(originalPos);
    camera.quaternion.copy(originalQuaternion);
    if (
      originalSize.x > 0 &&
      originalSize.y > 0 &&
      typeof renderer.setSize === "function"
    ) {
      renderer.setSize(originalSize.x, originalSize.y, false);
    }
    camera.aspect = originalAspect;
    camera.updateProjectionMatrix();
  }
  return frames;
}

export function mount360Rotator(containerEl, frames, options = {}) {
  if (!containerEl || !frames || frames.length === 0)
    return { destroy: () => {} };
  const initialIndex =
    options.initialIndex !== undefined ? options.initialIndex : 1; // Default to 2nd frame (20 deg)

  containerEl.innerHTML = "";
  containerEl.style.touchAction = "pan-y";

  const img = document.createElement("img");
  img.src = frames[initialIndex] || frames[0];
  img.className =
    "w-full h-full object-contain pointer-events-none transition-transform duration-75";
  img.alt = t("360 Preview");
  img.dataset.i18nAlt = "360 Preview";
  img.draggable = false;
  containerEl.appendChild(img);

  let currentIndex = initialIndex;
  let startX = 0;
  let isDragging = false;
  let activePointer = null;
  const sensitivity = options.sensitivity || 12; // Pixels per frame rotation

  const updateFrame = (index) => {
    currentIndex = ((index % frames.length) + frames.length) % frames.length;
    img.src = frames[currentIndex];
  };

  const onPointerDown = (e) => {
    if (!e.isPrimary || e.button !== 0 || activePointer !== null) return;
    e.preventDefault();
    activePointer = e.pointerId;
    isDragging = true;
    startX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    containerEl.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!isDragging || e.pointerId !== activePointer) return;
    e.preventDefault();
    const currentX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const deltaX = currentX - startX;
    if (Math.abs(deltaX) >= sensitivity) {
      const stepDelta = Math.trunc(deltaX / sensitivity);
      // Natural drag direction: dragging right moves frame index forward
      updateFrame(currentIndex + stepDelta);
      startX += stepDelta * sensitivity;
    }
  };

  const onPointerUp = (e) => {
    if (e.pointerId !== activePointer) return;
    isDragging = false;
    activePointer = null;
    if (containerEl.hasPointerCapture?.(e.pointerId))
      containerEl.releasePointerCapture(e.pointerId);
  };

  containerEl.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  containerEl.addEventListener("pointercancel", onPointerUp);
  containerEl.addEventListener("lostpointercapture", onPointerUp);

  return {
    updateFrames: (newFrames) => {
      frames = newFrames;
      updateFrame(1);
    },
    destroy: () => {
      containerEl.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      containerEl.removeEventListener("pointercancel", onPointerUp);
      containerEl.removeEventListener("lostpointercapture", onPointerUp);
    },
  };
}
