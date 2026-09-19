import { getSession } from "./auth.js";

/** The line the pet should say, and an instruction that puts that line first. */
export function mcpPetReply({ result, error, ok, language = "en" } = {}) {
  const raw = String((ok ? result : error || result) || "")
    .replace(/\s+/g, " ")
    .trim();
  let chatText = raw;
  if (!chatText) {
    chatText = language === "th" ? "เครื่องมือไม่ตอบ" : "The tool returned nothing.";
  } else if (language === "th" && /Could not reach the ESP32 kit/i.test(raw)) {
    chatText = "เรียกเครื่องมือแล้ว แต่ยังต่อชุดอุปกรณ์ไม่ได้";
  } else if (language === "th" && /^Temperature /i.test(raw)) {
    chatText = raw
      .replace(/^Temperature\s+/i, "อุณหภูมิ ")
      .replace(/°C,\s*humidity\s+/i, " องศา ความชื้น ")
      .replace(/%,\s*light\s+/i, " เปอร์เซ็นต์ แสง ")
      .replace(/\.\s*LED 15 /i, " ไฟ 15 ")
      .replace(/,\s*LED 16 /i, " ไฟ 16 ")
      .replace(/,\s*LED 17 /i, " ไฟ 17 ")
      .replace(/\.\s*Buzzer /i, " ออด ")
      .replace(/\.\s*RGB /i, " ไฟสี ")
      .replace(/\bon\b/g, "เปิด")
      .replace(/\boff\b/g, "ปิด");
  }
  const instruction =
    language === "th"
      ? `ตอบด้วยประโยคนี้เท่านั้น ห้ามทักทาย ห้ามบอกว่าไม่รู้ ห้ามแต่งนิทาน: ${chatText}`
      : `Say only this sentence. Do not greet, do not say you do not know, and do not start a story: ${chatText}`;
  return { chatText, instruction };
}

/** Run the pet's linked MCP servers against one spoken or typed line. */
export async function usePetMcp(pet, text) {
  const session = await getSession();
  if (!session?.access_token) return { matched: false };
  const res = await fetch("/api/mcp/use", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      text,
      links: Array.isArray(pet?.mcpLinks) ? pet.mcpLinks : [],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.matched) {
    const err = new Error(data.error || "Could not use the tool.");
    err.code = data.code;
    throw err;
  }
  return data;
}
