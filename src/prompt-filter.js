/**
 * True for widget / app prompt text that must never appear in the chat
 * window or be sent to the memory summariser (e.g. "[Greeting Instruction]: …").
 */
export function isInternalPromptText(text) {
  const t = String(text ?? "").trim();
  if (!t) return true;
  if (/^\[Greeting Instruction\]/i.test(t)) return true;
  if (t.includes("[Greeting Instruction]")) return true;
  if (t.includes("Things you remember about your friend from earlier chats"))
    return true;
  if (t.includes("สิ่งที่เธอจำได้เกี่ยวกับเพื่อนจากการคุยครั้งก่อน"))
    return true;
  if (t.includes("If your friend asks you to remember something")) return true;
  if (t.includes("ถ้าเพื่อนบอกให้จำอะไร ให้ตอบอย่างดีใจว่าจะจำไว้"))
    return true;
  if (t.includes("Use simple words for children aged 8 and up")) return true;
  if (t.includes("ใช้คำง่าย ๆ สำหรับเด็กอายุ 8 ปีขึ้นไป")) return true;
  return false;
}
