// Instant, on-device memory rules for the things a child is most likely to
// say and clearly want kept: their name, phone number, birthday, age,
// favourites, and anything after "please remember…". These run on each turn
// while talking, without a server round-trip, and save at once. The fuller
// summary at the end of a session (Gemini) catches what the rules miss.
import { normalizeKey, normalizeValue } from "./memory-keys.js";

const TH_PARTICLES =
  "(?:ครับ|ค่ะ|คะ|ค๊ะ|นะ|น้า|จ้า|จ้ะ|จ๊ะ|เอง|ล่ะ|หละ|เลย|อ่ะ|อะ|ฮะ|ฮับ)";
const TH_FIRST = "(?:ผม|ฉัน|ชั้น|หนู|เรา|ดิฉัน|กระผม|ข้า|เค้า|กู)";
const TH_MONTH =
  "(?:มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|มกรา|กุมภา|มีนา|เมษา|พฤษภา|มิถุนา|กรกฎา|สิงหา|กันยา|ตุลา|พฤศจิกา|ธันวา|ม\\.ค\\.|ก\\.พ\\.|มี\\.ค\\.|เม\\.ย\\.|พ\\.ค\\.|มิ\\.ย\\.|ก\\.ค\\.|ส\\.ค\\.|ก\\.ย\\.|ต\\.ค\\.|พ\\.ย\\.|ธ\\.ค\\.)";
const EN_MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/** Thai words a child uses for a fact, mapped to the shared keys. */
const TH_KEYS = [
  ["ชื่อเล่น", "nickname"],
  ["ชื่อ", "name"],
  ["วันเกิด", "birthday"],
  ["เบอร์โทรศัพท์", "phone"],
  ["เบอร์โทร", "phone"],
  ["เบอร์", "phone"],
  ["โทรศัพท์", "phone"],
  ["อายุ", "age"],
  ["อาหารที่ชอบ", "favorite_food"],
  ["ของกินที่ชอบ", "favorite_food"],
  ["สีที่ชอบ", "favorite_color"],
  ["วิชาที่ชอบ", "favorite_subject"],
  ["สัตว์ที่ชอบ", "favorite_animal"],
  ["เกมที่ชอบ", "favorite_game"],
  ["เพลงที่ชอบ", "favorite_song"],
  ["ที่ที่ชอบ", "favorite_place"],
  ["กีฬาที่ชอบ", "favorite_sport"],
  ["กีฬาโปรด", "favorite_sport"],
  ["งานอดิเรก", "hobby"],
  ["สัตว์เลี้ยง", "pet"],
  ["โรงเรียน", "school"],
  ["ครอบครัว", "family"],
  ["เพื่อนสนิท", "friend"],
  ["ความฝัน", "dream"],
];
const EN_KEYS = [
  ["nickname", "nickname"],
  ["name", "name"],
  ["birthday", "birthday"],
  ["phone number", "phone"],
  ["phone", "phone"],
  ["number", "phone"],
  ["age", "age"],
  ["favorite food", "favorite_food"],
  ["favourite food", "favorite_food"],
  ["favorite color", "favorite_color"],
  ["favourite colour", "favorite_color"],
  ["favorite subject", "favorite_subject"],
  ["favourite subject", "favorite_subject"],
  ["favorite animal", "favorite_animal"],
  ["favourite animal", "favorite_animal"],
  ["favorite game", "favorite_game"],
  ["favourite game", "favorite_game"],
  ["favorite song", "favorite_song"],
  ["favourite song", "favorite_song"],
  ["favorite place", "favorite_place"],
  ["favourite place", "favorite_place"],
  ["favorite sport", "favorite_sport"],
  ["favourite sport", "favorite_sport"],
  ["hobby", "hobby"],
  ["pet", "pet"],
  ["school", "school"],
  ["family", "family"],
  ["best friend", "friend"],
  ["dream", "dream"],
];

const trimValue = (value) =>
  normalizeValue(
    String(value ?? "")
      .replace(new RegExp(`\\s*${TH_PARTICLES}+\\s*$`, "u"), "")
      .replace(
        /\s*(?:มาก ๆ|มากๆ|มากเลย|มากที่สุด|ที่สุด|สุด ๆ|สุดๆ|จังเลย|จัง|มาก)\s*$/u,
        "",
      )
      .replace(new RegExp(`\\s*${TH_PARTICLES}+\\s*$`, "u"), "")
      .replace(/[\s.,!?;:。]+$/u, "")
      .replace(/^[\s.,!?;:。]+/u, ""),
  );

const clean = (text) =>
  String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();

function push(found, key, value) {
  const v = trimValue(value);
  const k = normalizeKey(key);
  if (!k || !v) return;
  if (found.some((f) => f.key === k)) return;
  found.push({ key: k, value: v });
}

function thaiValue(rest) {
  // Up to the next clause opener, punctuation, or a trailing polite particle.
  // Particles only at the end so values like ว่ายน้ำ stay intact.
  const m = String(rest ?? "").match(
    new RegExp(
      `^\\s*(?:ว่า(?=\\s)|คือ|ชื่อ|เป็น|:)?\\s*(.+?)(?:\\s+(?:และ|แล้ว|กับ|ส่วน)\\s|[,.!?;]|\\s*${TH_PARTICLES}\\s*$|$)`,
      "u",
    ),
  );
  return m ? m[1] : "";
}

/** Sports kids commonly name (Thai + English). */
const SPORT_WORD =
  "(?:ฟุตบอล|ฟุตซอล|บอล|บาส(?:เกตบอล)?|วอลเลย์(?:บอล)?|วอลเล่ย์(?:บอล)?|เทนนิส|แบดมินตัน|ปิงปอง|เทเบิลเทนนิส|ว่ายน้ำ|วิ่ง|กรีฑา|มวย|ยูโด|เทควันโด|ยิมนาสติก|กอล์ฟ|รักบี้|ฮอกกี้|คริกเก็ต|สเก็ต|สกี|จักรยาน|โยคะ|แฮนด์บอล|ซอฟท์บอล|เบสบอล|volleyball|football|soccer|basketball|tennis|badminton|swimming|running|boxing|golf|rugby|hockey|cricket|skate|yoga|futsal)";

function looksLikeSport(value) {
  const v = String(value ?? "").trim();
  if (!v) return false;
  if (/^กีฬา/.test(v)) return true;
  return new RegExp(SPORT_WORD, "iu").test(v);
}

function matchName(text, found) {
  let m = text.match(
    new RegExp(
      `(?:^|\\s|${TH_FIRST})\\s*ชื่อ(?:เล่น)?(?:ว่า)?\\s*(?!อะไร|ไร|ของ|เธอ|แก|คุณ|นาย|มัน|เค้า)(.{1,30}?)(?:\\s*${TH_PARTICLES}|\\s|[,.!?]|$)`,
      "u",
    ),
  );
  if (m && trimValue(m[1])) {
    const isNickname = /ชื่อเล่น/.test(m[0]);
    push(found, isNickname ? "nickname" : "name", m[1]);
  }
  m = text.match(
    /เรียก(?:ผม|ฉัน|ชั้น|หนู|เรา)ว่า\s*(.{1,30}?)(?:\s*(?:ก็ได้|นะ|ครับ|ค่ะ)|[,.!?]|$)/u,
  );
  if (m) push(found, "nickname", m[1]);
  m = text.match(
    /\b(?:my name(?:'s| is)|(?:you can |please )?call me)\s+([A-Za-z][\w'-]{0,29})/i,
  );
  if (m) push(found, /call me/i.test(m[0]) ? "nickname" : "name", m[1]);
  m = text.match(/\bI(?:'m| am)\s+([A-Z][a-z'-]{1,29})(?=$|[\s,.!?])/);
  if (
    m &&
    !/^(?:Ok|Okay|Fine|Good|Great|Happy|Sad|Tired|Hungry|Bored|Sorry|Sure|Here|Home|Back|Ready|Done|Not)$/i.test(
      m[1],
    )
  )
    push(found, "name", m[1]);
}

function matchPhone(text, found) {
  const m = text.match(/(?:\+66|0)[\s-]?\d(?:[\s-]?\d){7,8}\b/);
  if (!m) return;
  let digits = m[0].replace(/[\s-]/g, "");
  if (digits.startsWith("+66")) digits = "0" + digits.slice(3);
  if (digits.length >= 9 && digits.length <= 10) push(found, "phone", digits);
}

function matchBirthday(text, found) {
  let m = text.match(
    new RegExp(
      `(?:วันเกิด|เกิดวันที่|เกิดเมื่อ|เกิดตอน)[^\\d]{0,20}(\\d{1,2}\\s*${TH_MONTH}(?:\\s*(?:ปี\\s*)?\\d{2,4})?)`,
      "u",
    ),
  );
  if (m) return push(found, "birthday", m[1]);
  m = text.match(
    new RegExp(
      `(?:birthday(?:'s| is|:)?|born on|born)\\s*(?:is\\s*|on\\s*|the\\s*)*((?:\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${EN_MONTH}|${EN_MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?)(?:,?\\s*\\d{4})?)`,
      "i",
    ),
  );
  if (m) push(found, "birthday", m[1]);
}

function matchAge(text, found) {
  let m = text.match(/อายุ\s*(\d{1,2})\s*(?:ขวบ|ปี)?/u);
  if (m) return push(found, "age", m[1]);
  m = text.match(/\b(\d{1,2})\s*(?:years?|yrs?)\s*old\b/i);
  if (m) push(found, "age", m[1]);
}

function matchFavorites(text, found) {
  for (const [word, key] of TH_KEYS) {
    if (
      key === "name" ||
      key === "nickname" ||
      key === "phone" ||
      key === "birthday" ||
      key === "age"
    )
      continue;
    const m = text.match(
      new RegExp(
        `${word}(?:ของ${TH_FIRST})?\\s*(?:คือ|ชื่อ|ว่า|เป็น|:)?\\s*(.+)`,
        "u",
      ),
    );
    if (m) push(found, key, thaiValue(m[1]));
  }
  let m = text.match(/ชอบสี\s*(.+)/u);
  if (m) push(found, "favorite_color", thaiValue(m[1]));
  m = text.match(/ชอบวิชา\s*(.+)/u);
  if (m) push(found, "favorite_subject", thaiValue(m[1]));
  m = text.match(/ชอบกีฬา\s*(.+)/u);
  if (m) push(found, "favorite_sport", thaiValue(m[1]));
  m = text.match(
    new RegExp(`(?:ชอบ(?:ดู|เล่น)?|เล่น)\\s*(${SPORT_WORD})`, "iu"),
  );
  if (m) push(found, "favorite_sport", thaiValue(m[1]));
  m = text.match(/ชอบเล่น\s*(.+)/u);
  if (m) {
    const value = thaiValue(m[1]);
    push(
      found,
      looksLikeSport(value) ? "favorite_sport" : "favorite_game",
      value,
    );
  }
  m = text.match(/ชอบ(?:กิน|ทาน)\s*(.+)/u);
  if (m) push(found, "favorite_food", thaiValue(m[1]));
  // Bare "ชอบ…" — route by what follows; never dump unknown topics into food.
  m = text.match(/ชอบ\s*(.+)/u);
  if (m) {
    const value = thaiValue(m[1]);
    if (
      value &&
      !/^(สี|วิชา|กีฬา|เล่น|กิน|ทาน|ดู|ฟัง|ไป|มา|ที่|คน|เพื่อน|มาก|จัง|ที่สุด|เลย)/u.test(
        value,
      )
    ) {
      if (looksLikeSport(value)) push(found, "favorite_sport", value);
      else if (
        /^(พิซซ่า|pizza|ไอติม|ไอศกรีม|ข้าว|ก๋วยเตี๋ยว|ซูชิ|แฮมเบอร์เกอร์|ขนม|ไก่|ปลา|เนื้อ|ผลไม้|ชา|กาแฟ|นม|ช็อกโกแลต|เค้ก|ของหวาน)/iu.test(
          value,
        )
      )
        push(found, "favorite_food", value);
    }
  }
  for (const [words, key] of EN_KEYS) {
    if (["name", "nickname", "phone", "birthday", "age"].includes(key))
      continue;
    const r = new RegExp(
      `\\bmy ${words}(?:'s| is|:)\\s+(.+?)(?:[,.!?;]|\\s+(?:and|but)\\s|$)`,
      "i",
    );
    const m2 = text.match(r);
    if (m2) push(found, key, m2[1]);
  }
  m = text.match(
    /\bI (?:love|like) (?:eating|to eat)\s+(.+?)(?:[,.!?;]|\s+(?:and|but)\s|$)/i,
  );
  if (m) push(found, "favorite_food", m[1]);
  m = text.match(
    /\bI (?:love|like) (?:playing|to play)\s+(.+?)(?:[,.!?;]|\s+(?:and|but)\s|$)/i,
  );
  if (m) {
    const value = m[1];
    push(
      found,
      looksLikeSport(value) ? "favorite_sport" : "favorite_game",
      value,
    );
  }
  m = text.match(
    /\b(?:my )?favorite sport(?:'s| is|:)\s+(.+?)(?:[,.!?;]|\s+(?:and|but)\s|$)/i,
  );
  if (m) push(found, "favorite_sport", m[1]);
}

/** Text after "please remember…" / "ช่วยจำหน่อยว่า…", or "" when absent. */
export function rememberRequest(text) {
  let m = text.match(
    /(?:ช่วย)?จำ(?:ไว้)?(?:ให้)?(?:หน่อย|ด้วย|ที|นะ|เลย)?(?:ว่า|:)?\s*(.+)/u,
  );
  if (m && /(?:ช่วยจำ|จำไว้|จำให้|จำหน่อย|จำด้วย|จำนะ|จำที|จำว่า)/u.test(text))
    return clean(m[1]);
  m = text.match(
    /\b(?:please\s+)?(?:remember|memorize|memorise|don't forget|do not forget)(?:\s+(?:that|this))?[:,]?\s+(.+)/i,
  );
  return m ? clean(m[1]) : "";
}

/** Facts stated inside a remember request that no other rule caught. */
function matchRequested(request, found, { noteIndex }) {
  if (!request) return;
  let m = request.match(
    new RegExp(
      `^(.{1,30}?)(?:ของ${TH_FIRST})?\\s*(?:คือ|วันที่|เป็น|ชื่อ|ว่า|:)\\s*(.+)$`,
      "u",
    ),
  );
  if (m) {
    const word = clean(m[1]);
    const mapped = TH_KEYS.find(([w]) => word.includes(w));
    if (mapped) return push(found, mapped[1], thaiValue(m[2]));
  }
  m = request.match(/^my (.{1,30}?)(?:'s| is|:)\s+(.+)$/i);
  if (m) {
    const word = clean(m[1]).toLowerCase();
    const mapped = EN_KEYS.find(([w]) => word.includes(w));
    return push(found, mapped ? mapped[1] : word, m[2]);
  }
  if (!found.length) push(found, `note_${noteIndex}`, request);
}

/**
 * Facts in one user turn as [{ key, value }]. `noteIndex` numbers free-text
 * "remember this" notes so they never overwrite each other.
 */
export function extractMemories(rawText, { noteIndex = 1 } = {}) {
  const text = clean(rawText);
  if (!text) return [];
  const found = [];
  matchName(text, found);
  matchPhone(text, found);
  matchBirthday(text, found);
  matchAge(text, found);
  matchFavorites(text, found);
  const request = rememberRequest(text);
  if (request) {
    const before = found.length;
    matchName(request, found);
    matchPhone(request, found);
    matchBirthday(request, found);
    matchAge(request, found);
    matchFavorites(request, found);
    if (found.length === before) matchRequested(request, found, { noteIndex });
  }
  return found;
}
