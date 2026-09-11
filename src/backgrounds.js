// Add future room images here; saved pets store only the stable ID.
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
export function applyBackdrop(element, color, id) {
  const background = BACKGROUNDS.find((background) => background.id === id);
  element.style.backgroundColor = color;
  element.style.backgroundImage = background
    ? `url("${background.url}")`
    : "none";
}
