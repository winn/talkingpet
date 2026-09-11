export const PET_CONFIGS = {
  minicat: {
    id: "minicat",
    label: "Mini Cat",
    widgetId: "tjiy59r8",
    voices: { female: "tjiy59r8", male: "nj5368d1" },
    baseModelUrl: "./assets/minicat/PaintAnimationFaceoldbodyCat96.vrm",
    guideUrl: "./assets/minicat/coloring-guide.png",
    previewUrl: "./assets/minicat/portrait.png",
  },
  minidog: {
    id: "minidog",
    label: "Mini Dog",
    widgetId: "pusjdwpg",
    voices: { female: "pusjdwpg", male: "a93cmh90" },
    baseModelUrl: "./assets/minidog/base.vrm",
    guideUrl: "./assets/minidog/coloring-guide.png",
    previewUrl: "./assets/minidog/portrait.png",
  },
};
export function normalizePetType(id = "minicat") {
  return String(id).startsWith("minidog") ? "minidog" : "minicat";
}
export function petGender(pet = {}) {
  return pet.gender === "male" ||
    (!pet.gender && String(pet.petType).endsWith("_m"))
    ? "male"
    : "female";
}
export function getPetConfig(id = "minicat", gender) {
  const config = PET_CONFIGS[normalizePetType(id)];
  const resolvedGender = gender || petGender({ petType: id });
  return {
    ...config,
    widgetId: config.voices[resolvedGender] || config.widgetId,
  };
}
