export const PROMPT_CHOICES = {
  gender: [
    { id: "female", label: "Girl", emoji: "🌼", instruction: "a girl" },
    { id: "male", label: "Boy", emoji: "🍀", instruction: "a boy" },
  ],
  vibe: [
    {
      id: "playful",
      label: "Playful",
      emoji: "🎾",
      detail: "A bundle of happy energy",
      instruction: "playful and full of happy energy",
      greeting: "Ready, set, imagination!",
    },
    {
      id: "cozy",
      label: "Cozy",
      emoji: "☁️",
      detail: "Gentle, calm & kind",
      instruction: "gentle, calm, and kind",
      greeting: "Come get comfy with me.",
    },
    {
      id: "brave",
      label: "Adventurous",
      emoji: "🧭",
      detail: "Curious about everything",
      instruction: "brave and curious about new things",
      greeting: "Our next adventure starts here!",
    },
    {
      id: "silly",
      label: "Silly",
      emoji: "🪩",
      detail: "A wonderfully goofy buddy",
      instruction: "silly, friendly, and a little goofy",
      greeting: "Boop! My brain just did a cartwheel.",
    },
  ],
  activity: [
    {
      id: "stories",
      label: "Make up stories",
      emoji: "📖",
      instruction: "help me invent a story, taking turns one idea at a time",
      example:
        "Let’s make a story together. Does it begin in a cloud castle or a tiny forest?",
    },
    {
      id: "discover",
      label: "Discover things",
      emoji: "🔎",
      instruction: "help me explore interesting facts and ask what I think",
      example:
        "Let’s be curious! Would you like to explore the ocean or outer space?",
    },
    {
      id: "riddles",
      label: "Play guessing games",
      emoji: "🧩",
      instruction:
        "play guessing games with me and give hints before revealing answers",
      example:
        "Guess what I’m thinking of: it has whiskers and loves a sunny nap. Want another clue?",
    },
    {
      id: "cheer",
      label: "Cheer me on",
      emoji: "🌈",
      instruction:
        "encourage my creative ideas and help me choose a small next step",
      example: "Your ideas matter! What would you like to try making today?",
    },
  ],
  style: [
    {
      id: "short",
      label: "Short & sweet",
      emoji: "💬",
      instruction: "use short, easy sentences and ask one question at a time",
    },
    {
      id: "excited",
      label: "With excitement",
      emoji: "✨",
      instruction:
        "speak with friendly excitement, keep replies brief, and ask one question at a time",
    },
  ],
};
export const DEFAULT_RECIPE = {
  gender: "female",
  vibe: "playful",
  activity: "stories",
  style: "short",
  custom: "",
};
export function normalizeRecipe(recipe = {}) {
  const result = { ...DEFAULT_RECIPE };
  for (const key of Object.keys(PROMPT_CHOICES)) {
    if (PROMPT_CHOICES[key].some((choice) => choice.id === recipe[key]))
      result[key] = recipe[key];
  }
  result.custom = String(recipe.custom || "").slice(0, 300);
  return result;
}
const THAI_CHOICES = {
  female: { label: "เด็กผู้หญิง", instruction: "เด็กผู้หญิง" },
  male: { label: "เด็กผู้ชาย", instruction: "เด็กผู้ชาย" },
  playful: {
    label: "ร่าเริง",
    detail: "สดใส เต็มไปด้วยพลัง",
    instruction: "ร่าเริงและเต็มไปด้วยพลังสดใส",
    greeting: "พร้อมแล้ว มาใช้จินตนาการกัน!",
  },
  cozy: {
    label: "อบอุ่น",
    detail: "อ่อนโยน ใจเย็น ใจดี",
    instruction: "อ่อนโยน ใจเย็น และใจดี",
    greeting: "มานั่งสบาย ๆ ด้วยกันนะ",
  },
  brave: {
    label: "นักผจญภัย",
    detail: "ช่างสงสัย อยากรู้อยากเห็น",
    instruction: "กล้าลองและอยากรู้อยากเห็นสิ่งใหม่ ๆ",
    greeting: "การผจญภัยครั้งใหม่เริ่มตรงนี้เลย!",
  },
  silly: {
    label: "จอมขำ",
    detail: "เพื่อนขี้เล่น ชวนหัวเราะ",
    instruction: "ขี้เล่น เป็นมิตร และชอบทำอะไรตลก ๆ",
    greeting: "ปิ๊ง! เมื่อกี้ความคิดเราตีลังกาด้วยล่ะ!",
  },
  stories: {
    label: "แต่งนิทาน",
    instruction: "ช่วยฉันแต่งนิทาน โดยผลัดกันคิดทีละไอเดีย",
    example: "มาแต่งนิทานด้วยกันไหม? จะเริ่มที่ปราสาทบนเมฆหรือป่าเล็ก ๆ ดี?",
  },
  discover: {
    label: "ค้นพบสิ่งใหม่",
    instruction: "ช่วยฉันสำรวจเรื่องน่ารู้และถามว่าฉันคิดอย่างไร",
    example: "มาสำรวจกัน! อยากรู้เรื่องใต้ทะเลหรืออวกาศก่อนดี?",
  },
  riddles: {
    label: "เล่นเกมทายใจ",
    instruction: "เล่นเกมทายคำกับฉัน โดยให้คำใบ้ก่อนเฉลย",
    example:
      "ลองทายสิ เรานึกถึงใครอยู่: มีหนวดและชอบนอนอาบแดด อยากได้คำใบ้อีกไหม?",
  },
  cheer: {
    label: "ให้กำลังใจกัน",
    instruction:
      "ให้กำลังใจไอเดียสร้างสรรค์ของฉัน และช่วยเลือกก้าวเล็ก ๆ ที่จะลองทำต่อ",
    example: "ไอเดียของเรามีค่านะ! วันนี้อยากลองสร้างอะไรดี?",
  },
  short: {
    label: "สั้น ๆ เข้าใจง่าย",
    instruction: "ใช้ประโยคสั้น เข้าใจง่าย และถามทีละคำถาม",
  },
  excited: {
    label: "สนุกตื่นเต้น",
    instruction: "พูดอย่างเป็นมิตรและตื่นเต้น ตอบสั้น ๆ และถามทีละคำถาม",
  },
};
export function recipeChoice(recipe, key, language = "en") {
  const choice =
    PROMPT_CHOICES[key].find((choice) => choice.id === recipe[key]) ||
    PROMPT_CHOICES[key][0];
  return language === "th" ? { ...choice, ...THAI_CHOICES[choice.id] } : choice;
}
// The highlighted teaching preview and saved instructions share one recipe.
export function promptParts(name, type, recipe, language = "en") {
  const r = normalizeRecipe(recipe);
  const choice = (key) => ({
    text: recipeChoice(r, key, language).instruction,
    mark: true,
  });
  const petName = { text: name, mark: true };
  const lines =
    language === "th"
      ? [
          [
            "เธอชื่อ ",
            petName,
            ` เป็น${type === "minidog" ? "หมา" : "แมว"}ตัวจิ๋ว และเป็น`,
            choice("gender"),
          ],
          ["มีนิสัย", choice("vibe")],
          [
            "ช่วย",
            {
              ...choice("activity"),
              text: choice("activity").text.replace(/^ช่วย/, ""),
            },
          ],
          ["เวลาคุยกัน ", choice("style")],
        ]
      : [
          [
            "You are ",
            petName,
            `, a ${type === "minidog" ? "mini dog" : "mini cat"} and `,
            choice("gender"),
            ".",
          ],
          ["Be ", choice("vibe"), "."],
          ["Please ", choice("activity"), "."],
          ["When we talk, ", choice("style"), "."],
        ];
  if (r.custom.trim())
    lines.push([
      language === "th" ? "ไอเดียเพิ่มเติมของฉัน: " : "My extra idea: ",
      r.custom.trim(),
    ]);
  return lines.map((line) =>
    line.map((part) => (typeof part === "string" ? { text: part } : part)),
  );
}
export function buildPrompt(name, type, recipe, language = "en") {
  return promptParts(name, type, recipe, language)
    .map((line) => line.map((part) => part.text).join(""))
    .join(" ");
}
export function samplePrompt(name, recipe, language = "en") {
  const r = normalizeRecipe(recipe);
  return `${recipeChoice(r, "vibe", language).greeting} ${language === "th" ? "เราชื่อ" : "I’m "}${name}${r.style === "excited" ? "! ✨" : language === "th" ? "นะ" : "."} ${recipeChoice(r, "activity", language).example}`;
}
export function memoryInstructions(memories = [], language = "en") {
  const facts = (Array.isArray(memories) ? memories : [])
    .map((m) => (typeof m === "string" ? m : m?.content))
    .map((text) => String(text ?? "").trim())
    .filter(Boolean);
  const remind =
    language === "th"
      ? "ถ้าเพื่อนบอกให้จำอะไร ให้ตอบอย่างดีใจว่าจะจำไว้"
      : "If your friend asks you to remember something, say happily that you will.";
  if (!facts.length) return remind;
  const lines = facts.map((fact) => `- ${fact}`).join("\n");
  return language === "th"
    ? `สิ่งที่เธอจำได้เกี่ยวกับเพื่อนจากการคุยครั้งก่อน:\n${lines}\nนำมาใช้อย่างเป็นธรรมชาติเมื่อเข้ากับบทสนทนา ไม่ต้องพูดถึงทั้งหมดในครั้งเดียว ${remind}`
    : `Things you remember about your friend from earlier chats:\n${lines}\nBring them up naturally when they fit; do not list them all at once. ${remind}`;
}
export function buildChatGreeting(pet, language = "en", memories = []) {
  const personality = pet.promptRecipe
    ? buildPrompt(
        pet.name,
        pet.petType?.startsWith("minidog") ? "minidog" : "minicat",
        pet.promptRecipe,
        language,
      )
    : pet.personalityPrompt ||
      (language === "th"
        ? `เธอชื่อ ${pet.name} เป็นเพื่อนสัตว์เลี้ยงเสมือนจริงที่ร่าเริง`
        : `You are ${pet.name}, a cheerful virtual pet.`);
  const direction =
    language === "th"
      ? "ใช้คำง่าย ๆ สำหรับเด็กอายุ 8 ปีขึ้นไป เริ่มด้วยการแนะนำตัวอย่างอบอุ่นเป็นภาษาไทย"
      : "Use simple words for children aged 8 and up. Introduce yourself warmly in English.";
  return `${personality}\n\n${direction}\n\n${memoryInstructions(memories, language)}`;
}
export function normalizeBackground(color) {
  return /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#f7e8d9";
}
