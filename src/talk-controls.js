// Talk-mode controls layered over the hosted chat widget.
//
// The widget renders the pet with Three.js and exposes its scene objects on
// window.WebAvatar. Nothing here reads or changes the widget's source: the
// pet's group is rotated, moved and scaled directly, and moves are started
// through the widget's public playAnimation / setEmotion calls. Every call is
// guarded so a widget update that removes those globals only hides the
// controls while chat keeps working.
import { attachSurfaceGestures } from "./surface-gestures.js";
import {
  attachHoverRub,
  notePettingMotion,
  notePettingTap,
  unlockPetSounds,
} from "./pet-sounds.js";
import { t } from "./i18n.js";

export const TALK_ACTIONS = [
  { id: "Waving", label: "Wave", icon: "👋" },
  { id: "Sawasdee", label: "Sawasdee", icon: "🙏" },
  { id: "Jump", label: "Jump", icon: "🐾" },
  { id: "Spin", label: "Spin", icon: "🌀" },
  { id: "Clapping", label: "Clap", icon: "👏" },
  { id: "Yay", label: "Yay", icon: "🎉" },
  { id: "Excited_dance", label: "Dance", icon: "💃" },
  { id: "laugh", label: "Laugh", icon: "😆" },
  { id: "Think_hard", label: "Think", icon: "🤔" },
  { id: "LookAround", label: "Look around", icon: "👀" },
  { id: "Sleepy", label: "Sleepy", icon: "😴" },
  { id: "Relax", label: "Relax", icon: "🛋️" },
];

export const TALK_FACES = [
  { id: "happy", label: "Happy", icon: "😊" },
  { id: "surprised", label: "Surprised", icon: "😮" },
  { id: "sad", label: "Sad", icon: "😢" },
  { id: "angry", label: "Angry", icon: "😠" },
  { id: "relaxed", label: "Relaxed", icon: "😌" },
  { id: "neutral", label: "Calm face", icon: "😐" },
];

export const POSE_LIMITS = {
  minScale: 0.5,
  maxScale: 2.2,
  maxOffset: 1.6,
  turnsPerDrag: 1,
  sizeStep: 1.25,
};

// Reads the widget's public surface. Returns null when it is not available.
export function getAvatarApi(win = globalThis.window) {
  const avatar = win?.WebAvatar;
  const group = avatar?.avatarGroup;
  if (!group?.rotation || !group.position || !group.scale) return null;
  const chat = win.ChatWidget;
  return {
    group,
    isAr: () => Boolean(avatar.isARMode),
    playAnimation:
      typeof chat?.playAnimation === "function"
        ? (name) => chat.playAnimation(name)
        : null,
    setEmotion:
      typeof avatar.setEmotion === "function"
        ? (name) => avatar.setEmotion(name, 1)
        : null,
  };
}

export function pickRandomTalkItem(items, random = Math.random) {
  if (!items?.length) return null;
  return items[Math.floor(random() * items.length)] || null;
}

/** On a pet rub, randomly play a move, a face, or both via the widget API. */
export function triggerRandomPetReaction(
  api,
  { random = Math.random, actions = TALK_ACTIONS, faces = TALK_FACES } = {},
) {
  if (!api) return { move: null, face: null };
  const wantMove = random() < 0.75;
  const wantFace = random() < 0.75;
  let move = null;
  let face = null;
  if (wantMove || !wantFace) {
    const action = pickRandomTalkItem(actions, random);
    if (action && api.playAnimation) {
      try {
        api.playAnimation(action.id);
        move = action.id;
      } catch (err) {
        console.warn("[PaintMomo] playAnimation failed:", err);
      }
    }
  }
  if (wantFace || !wantMove) {
    const emotion = pickRandomTalkItem(faces, random);
    if (emotion && api.setEmotion) {
      try {
        api.setEmotion(emotion.id);
        face = emotion.id;
      } catch (err) {
        console.warn("[PaintMomo] setEmotion failed:", err);
      }
    }
  }
  return { move, face };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createPoseController(group, limits = POSE_LIMITS) {
  const base = {
    rotationY: group.rotation.y,
    x: group.position.x,
    y: group.position.y,
    scale: group.scale.x || 1,
  };
  return {
    turnRadians(radians) {
      group.rotation.y += radians;
    },
    move(dx, dy) {
      group.position.x = clamp(
        group.position.x + dx,
        base.x - limits.maxOffset,
        base.x + limits.maxOffset,
      );
      group.position.y = clamp(
        group.position.y + dy,
        base.y - limits.maxOffset,
        base.y + limits.maxOffset,
      );
    },
    zoom(ratio) {
      const next = clamp(
        group.scale.x * ratio,
        limits.minScale,
        limits.maxScale,
      );
      group.scale.set(next, next, next);
    },
    reset() {
      group.rotation.y = base.rotationY;
      group.position.x = base.x;
      group.position.y = base.y;
      group.scale.set(base.scale, base.scale, base.scale);
    },
  };
}

// Press on the pet and drag to spin it: one drag across the screen is one
// full turn. A pinch or the wheel changes its size. Double tap resets.
// Touch/pen drags also count as petting (sound + reaction). Mouse drag only
// spins — mouse petting is hover via attachHoverRub.
export function attachPoseGestures(canvas, pose, options = {}) {
  const isAr = options.isAr || (() => false);
  const onRub = options.onRub || (() => {});
  const onPat = options.onPat || (() => {});
  const onPointerDown = options.onPointerDown || (() => {});
  canvas.style.touchAction = "none";
  canvas.style.cursor = "grab";
  const isTouchy = (type) => type === "touch" || type === "pen";
  const gestures = attachSurfaceGestures(canvas, {
    shouldNavigate: () => true,
    acceptsEvent: (event) =>
      event.target === canvas ||
      (canvas.contains(event.target) && event.target.tagName === "CANVAS"),
    start() {},
    move() {},
    end() {},
    cancel() {},
    navigateStart(event) {
      onPointerDown(event);
    },
    navigate({ dx, dy, ratio, count, pointerType }) {
      if (isAr()) return;
      const width = Math.max(1, canvas.clientWidth || canvas.width);
      pose.turnRadians((dx / width) * POSE_LIMITS.turnsPerDrag * Math.PI * 2);
      if (count >= 2) pose.zoom(ratio);
      else if (isTouchy(pointerType)) onRub(Math.hypot(dx || 0, dy || 0));
    },
    navigateEnd({ travel, durationMs, pointerType }) {
      if (isAr() || !isTouchy(pointerType)) return;
      // Quick tap / short stroke = a pat when there was almost no drag.
      if (travel < 24 && durationMs < 500) onPat();
    },
  });
  const onWheel = (event) => {
    if (isAr()) return;
    event.preventDefault();
    pose.zoom(Math.exp(-event.deltaY * 0.0015));
  };
  const onDouble = (event) => {
    event.preventDefault();
    pose.reset();
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDouble);
  return {
    detach() {
      gestures.cancel();
      canvas.style.cursor = "";
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDouble);
    },
  };
}

function chip(item, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "talk-chip";
  button.dataset.action = item.id;
  const label = t(item.label);
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = `<span aria-hidden="true">${item.icon}</span>`;
  button.addEventListener("click", () => onClick(item));
  return button;
}

export function renderActionTray(tray, api, pose) {
  tray.replaceChildren();
  const row = (items, handler) => {
    const section = document.createElement("div");
    section.className = "talk-tray-row";
    for (const item of items) section.append(chip(item, handler));
    return section;
  };
  const view = row(
    [
      { id: "bigger", label: "Bigger", icon: "➕" },
      { id: "smaller", label: "Smaller", icon: "➖" },
      { id: "reset-view", label: "Reset view", icon: "🎯" },
    ],
    (item) => {
      if (item.id === "bigger") pose.zoom(POSE_LIMITS.sizeStep);
      else if (item.id === "smaller") pose.zoom(1 / POSE_LIMITS.sizeStep);
      else pose.reset();
    },
  );
  tray.append(view);
  if (api.playAnimation) {
    tray.append(
      row(TALK_ACTIONS, (item) => {
        try {
          api.playAnimation(item.id);
        } catch (err) {
          console.warn("[PaintMomo] playAnimation failed:", err);
        }
      }),
    );
  }
  if (api.setEmotion) {
    tray.append(
      row(TALK_FACES, (item) => {
        try {
          api.setEmotion(item.id);
        } catch (err) {
          console.warn("[PaintMomo] setEmotion failed:", err);
        }
      }),
    );
  }
  tray.hidden = !tray.childElementCount;
}

const mounted = new WeakSet();

// Idempotent: safe to call every time the widget's DOM changes.
// Prefer `surface` (the host container) for gestures: the widget canvas often
// ignores pointer input, so the container receives the mouse.
// Rubbing plays a sound and randomly triggers a move and/or face.
export function mountTalkControls({
  canvas,
  surface,
  tray,
  hint,
  win,
  getPetType,
}) {
  if (!canvas || mounted.has(canvas)) return null;
  const api = getAvatarApi(win);
  if (!api) return null;
  mounted.add(canvas);
  const pose = createPoseController(api.group);
  const gestureSurface = surface || canvas;
  const petType = () =>
    typeof getPetType === "function" ? getPetType() : getPetType;
  const react = () => triggerRandomPetReaction(api);
  const petOpts = () => ({ react });
  const gestures = attachPoseGestures(gestureSurface, pose, {
    isAr: api.isAr,
    onPointerDown: () => unlockPetSounds(),
    onRub: (distance) => notePettingMotion(distance, petType(), petOpts()),
    onPat: () => notePettingTap(petType(), petOpts()),
  });
  const rub = attachHoverRub(gestureSurface, {
    isEnabled: () => !api.isAr(),
    onRub: (distance) => notePettingMotion(distance, petType(), petOpts()),
  });
  if (tray) renderActionTray(tray, api, pose);
  if (hint) hint.hidden = false;
  return {
    canvas,
    pose,
    destroy() {
      gestures.detach();
      rub.detach();
      mounted.delete(canvas);
      if (tray) {
        tray.replaceChildren();
        tray.hidden = true;
      }
      if (hint) hint.hidden = true;
    },
  };
}
