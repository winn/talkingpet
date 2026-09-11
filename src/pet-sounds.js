// Petting sounds from the admin SFX library (sfx_clips in Supabase).
// Rubbing the pet randomly plays a meow/purr (cat) or bark/pant (dog).
import { listActiveAudio } from "./auth.js";
import { normalizePetType } from "./pet-configs.js";

export const PET_SOUND_FAMILIES = {
  minicat: [
    { id: "meow", match: /meow|mew/ },
    { id: "purr", match: /purr/ },
  ],
  minidog: [
    { id: "bark", match: /bark|yip|whine|growl/ },
    { id: "pant", match: /pant|sniff/ },
  ],
};

const RUB_DISTANCE_PX = 90;
const COOLDOWN_MS = 1600;

let library = null;
let loadPromise = null;
let travelPx = 0;
let lastPlayedAt = 0;
let activeAudio = null;
let audioUnlocked = false;

/** Browsers block sound until a click/tap; call this from any user gesture. */
export function unlockPetSounds({ AudioCtor = globalThis.Audio } = {}) {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    const warm = new AudioCtor(
      "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwmHAAAAAAD/+1DEAAAGAAGn9AAAIwgJOTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    );
    warm.volume = 0.01;
    const play = warm.play?.();
    if (play?.catch) play.catch(() => {});
  } catch (_) {}
}

export function pickFamilyClips(clips, petType, familyId) {
  const kind = normalizePetType(petType);
  const family = (PET_SOUND_FAMILIES[kind] || PET_SOUND_FAMILIES.minicat).find(
    (f) => f.id === familyId,
  );
  if (!family) return [];
  return (clips || []).filter((clip) => family.match.test(String(clip.cue || "")));
}

export function pickRandomPetClip(clips, petType, random = Math.random) {
  const kind = normalizePetType(petType);
  const families = PET_SOUND_FAMILIES[kind] || PET_SOUND_FAMILIES.minicat;
  const pools = families
    .map((family) => pickFamilyClips(clips, kind, family.id))
    .filter((pool) => pool.length);
  if (!pools.length) return null;
  const pool = pools[Math.floor(random() * pools.length)];
  return pool[Math.floor(random() * pool.length)] || null;
}

export async function ensureSfxLibrary({ loader = listActiveAudio } = {}) {
  if (library) return library;
  if (!loadPromise) {
    loadPromise = loader("sfx")
      .then((rows) => {
        library = Array.isArray(rows) ? rows : [];
        return library;
      })
      .catch((err) => {
        loadPromise = null;
        console.warn("[PaintMomo] Could not load sound effects:", err);
        return [];
      });
  }
  return loadPromise;
}

/** Clears cached clips (tests and after admin library changes). */
export function resetSfxLibrary() {
  library = null;
  loadPromise = null;
  travelPx = 0;
  lastPlayedAt = 0;
  audioUnlocked = false;
  if (activeAudio) {
    try {
      activeAudio.pause();
    } catch (_) {}
    activeAudio = null;
  }
}

export function playClip(clip, { AudioCtor = globalThis.Audio } = {}) {
  if (!clip?.url || typeof AudioCtor !== "function") return null;
  unlockPetSounds({ AudioCtor });
  try {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    const audio = new AudioCtor(clip.url);
    audio.volume = 0.85;
    activeAudio = audio;
    const play = audio.play?.();
    if (play?.catch) play.catch(() => {});
    audio.addEventListener?.(
      "ended",
      () => {
        if (activeAudio === audio) activeAudio = null;
      },
      { once: true },
    );
    return audio;
  } catch (err) {
    console.warn("[PaintMomo] Could not play sound:", err);
    return null;
  }
}

export async function playRandomPetSound(
  petType,
  { random = Math.random, AudioCtor = globalThis.Audio } = {},
) {
  const clips = await ensureSfxLibrary();
  const clip = pickRandomPetClip(clips, petType, random);
  if (!clip) return null;
  lastPlayedAt = Date.now();
  return playClip(clip, { AudioCtor });
}

/** Accumulate rub distance; when enough stroking has happened, react. */
export function notePettingMotion(
  distancePx,
  petType,
  {
    now = Date.now(),
    rubDistance = RUB_DISTANCE_PX,
    cooldownMs = COOLDOWN_MS,
    play = playRandomPetSound,
    react = null,
  } = {},
) {
  const step = Math.abs(Number(distancePx) || 0);
  if (!step) return false;
  travelPx += step;
  if (travelPx < rubDistance) return false;
  travelPx = 0;
  return firePetReaction(petType, { now, cooldownMs, play, react });
}

/** One-shot pat (tap) that still respects the shared cooldown. */
export function notePettingTap(
  petType,
  {
    now = Date.now(),
    cooldownMs = COOLDOWN_MS,
    play = playRandomPetSound,
    react = null,
  } = {},
) {
  travelPx = 0;
  return firePetReaction(petType, { now, cooldownMs, play, react });
}

function firePetReaction(
  petType,
  { now, cooldownMs, play, react },
) {
  if (lastPlayedAt && now - lastPlayedAt < cooldownMs) return false;
  lastPlayedAt = now;
  const soundBusy = activeAudio && !activeAudio.paused && !activeAudio.ended;
  if (!soundBusy) play(petType);
  try {
    react?.(petType);
  } catch (err) {
    console.warn("[PaintMomo] Pet reaction failed:", err);
  }
  return true;
}

/**
 * Mouse rub without click-and-hold: pointer moves over the pet.
 * Mouse with a button held is ignored (that's drag/paint). Touch still counts
 * while the finger is moving on the surface.
 */
export function attachHoverRub(element, options = {}) {
  const onRub = options.onRub || (() => {});
  const isEnabled = options.isEnabled || (() => true);
  let last = null;

  const clear = () => {
    last = null;
  };
  const onMove = (event) => {
    if (!isEnabled()) {
      clear();
      return;
    }
    if (event.pointerType === "mouse" && event.buttons !== 0) {
      last = { x: event.clientX, y: event.clientY };
      return;
    }
    if (last) {
      const distance = Math.hypot(
        event.clientX - last.x,
        event.clientY - last.y,
      );
      if (distance) onRub(distance);
    }
    last = { x: event.clientX, y: event.clientY };
  };

  element.addEventListener("pointermove", onMove);
  element.addEventListener("pointerleave", clear);
  element.addEventListener("pointercancel", clear);
  return {
    detach() {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", clear);
      element.removeEventListener("pointercancel", clear);
      clear();
    },
  };
}
