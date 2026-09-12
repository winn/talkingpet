// Shared by the browser and the server: how a memory's key and value are
// cleaned and shown. Keys are short English snake_case labels ("birthday",
// "favorite_subject") so the same fact is updated rather than repeated;
// values are free text in whichever language the child used.
export const MEMORY_KEY_MAX = 60;
export const MEMORY_VALUE_MAX = 200;

export function normalizeKey(key) {
  return String(key ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MEMORY_KEY_MAX);
}

export function normalizeValue(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MEMORY_VALUE_MAX);
}

const LABELS = {
  name: ["Name", "ชื่อ"],
  nickname: ["Nickname", "ชื่อเล่น"],
  birthday: ["Birthday", "วันเกิด"],
  age: ["Age", "อายุ"],
  phone: ["Phone", "เบอร์โทร"],
  favorite_food: ["Favorite food", "อาหารโปรด"],
  favorite_color: ["Favorite color", "สีโปรด"],
  favorite_subject: ["Favorite subject", "วิชาโปรด"],
  favorite_animal: ["Favorite animal", "สัตว์โปรด"],
  favorite_game: ["Favorite game", "เกมโปรด"],
  favorite_song: ["Favorite song", "เพลงโปรด"],
  favorite_place: ["Favorite place", "ที่โปรด"],
  hobby: ["Hobby", "งานอดิเรก"],
  pet: ["Pet", "สัตว์เลี้ยง"],
  family: ["Family", "ครอบครัว"],
  school: ["School", "โรงเรียน"],
  friend: ["Friend", "เพื่อน"],
  dream: ["Dream", "ความฝัน"],
  dislike: ["Dislikes", "ไม่ชอบ"],
  note: ["Note", "โน้ต"],
};

/** Human label for a key: known keys are translated, others are tidied. */
export function keyLabel(key, language = "en") {
  const known = LABELS[key];
  if (known) return language === "th" ? known[1] : known[0];
  const words = String(key ?? "")
    .replace(/_/g, " ")
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}
