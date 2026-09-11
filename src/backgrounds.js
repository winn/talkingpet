// Add future room images here; saved pets store only the stable ID.
export const DEFAULT_BACKGROUND_ID = "indoor-house";

export const BACKGROUNDS = [
  {
    id: "indoor-house",
    label: "Sunny room",
    url: new URL("../assets/backgrounds/indoor_house.png", import.meta.url)
      .href,
  },
  {
    id: "flower",
    label: "Flower sky",
    url: new URL("../assets/backgrounds/BG_flower.png", import.meta.url).href,
  },
  {
    id: "magic",
    label: "Magic world",
    url: new URL("../assets/backgrounds/BG_magic.png", import.meta.url).href,
  },
  {
    id: "indoor-apartment",
    label: "Cozy apartment",
    url: new URL("../assets/backgrounds/indoor_apartment.png", import.meta.url)
      .href,
  },
  {
    id: "indoor-bedroom",
    label: "Dreamy bedroom",
    url: new URL("../assets/backgrounds/indoor_bedroom.png", import.meta.url)
      .href,
  },
  {
    id: "indoor-kitchen",
    label: "Sweet kitchen",
    url: new URL("../assets/backgrounds/indoor_kitchen.png", import.meta.url)
      .href,
  },
];
export function normalizeBackgroundId(id) {
  return BACKGROUNDS.some((background) => background.id === id) ? id : null;
}

/** Always resolve to a room image; solid color alone is no longer used on Talk. */
export function resolveBackgroundId(id, { fallback = DEFAULT_BACKGROUND_ID } = {}) {
  return normalizeBackgroundId(id) || fallback;
}

export function applyBackdrop(element, color, id) {
  const background = BACKGROUNDS.find((background) => background.id === id);
  element.style.backgroundColor = color;
  element.style.backgroundImage = background
    ? `url("${background.url}")`
    : "none";
}

/** Put the room on the widget's Three.js scene so WebGL does not clear to white. */
export function applyTalkSceneBackdrop(win, id, THREE) {
  const background = BACKGROUNDS.find((entry) => entry.id === id);
  const avatar = win?.WebAvatar;
  if (!background || !avatar || !THREE?.TextureLoader) return false;
  let scene = avatar.scene;
  if (!scene) {
    let node = avatar.avatarGroup;
    while (node) {
      if (node.isScene || node.type === "Scene") {
        scene = node;
        break;
      }
      node = node.parent;
    }
  }
  if (!scene) return false;
  const loader = new THREE.TextureLoader();
  loader.load(
    background.url,
    (texture) => {
      if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      scene.background = texture;
    },
    undefined,
    () => {},
  );
  return true;
}
