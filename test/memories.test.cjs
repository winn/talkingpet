const test = require("node:test");
const assert = require("node:assert/strict");

test("transcripts normalise widget history items and {role,text} pairs", async () => {
  const { normalizeTranscript, MEMORY_LIMITS } =
    await import("../server/memories.js");
  const turns = normalizeTranscript([
    {
      sender: "user",
      text: "  My name is   John ",
      uiText: "ignored",
      timestamp: 1,
    },
    { sender: "bot", text: "Hi John!" },
    { role: "pet", text: "" },
    null,
    { role: "user", message: "I like green tea ice cream" },
    {
      sender: "bot",
      reply: { type: "text", text: "Yum!" },
      timestamp: 9,
    },
  ]);
  assert.deepEqual(turns, [
    { role: "user", text: "My name is John" },
    { role: "pet", text: "Hi John!" },
    { role: "user", text: "I like green tea ice cream" },
    { role: "pet", text: "Yum!" },
  ]);
  const long = normalizeTranscript(
    Array.from({ length: MEMORY_LIMITS.maxTurns + 5 }, (_, i) => ({
      role: "user",
      text: `t${i}`,
    })),
  );
  assert.equal(long.length, MEMORY_LIMITS.maxTurns);
  assert.equal(long[0].text, "t5");
  assert.deepEqual(normalizeTranscript("nope"), []);
});

test("merging keeps new keys and changed values within the limits", async () => {
  const { mergeMemories, MEMORY_LIMITS } =
    await import("../server/memories.js");
  const fresh = mergeMemories(
    [{ key: "name", value: "John" }],
    [
      { key: "Name", value: "john" },
      { key: "Birthday ", value: "  19 March " },
      { key: "birthday", value: "19 March" },
      { key: "favorite food", value: "green tea ice cream" },
      { key: "", value: "nothing" },
      { key: "age", value: "" },
    ],
  );
  assert.deepEqual(fresh, [
    { key: "birthday", value: "19 March" },
    { key: "favorite_food", value: "green tea ice cream" },
  ]);
  // A changed value for a known key is written; the same value is not.
  assert.deepEqual(
    mergeMemories(
      [{ key: "name", value: "John" }],
      [{ key: "name", value: "Johnny" }],
    ),
    [{ key: "name", value: "Johnny" }],
  );
  const many = mergeMemories(
    [],
    Array.from({ length: 20 }, (_, i) => ({ key: `fact_${i}`, value: "x" })),
  );
  assert.equal(many.length, MEMORY_LIMITS.maxPerSession);
  const full = mergeMemories(
    Array.from({ length: MEMORY_LIMITS.maxTotal }, (_, i) => ({
      key: `old_${i}`,
      value: "x",
    })),
    [
      { key: "new", value: "y" },
      { key: "old_1", value: "changed" },
    ],
  );
  assert.deepEqual(full, [{ key: "old_1", value: "changed" }]);
});

test("summarizeMemories asks Gemini with known facts and returns the merged result", async () => {
  const { summarizeMemories } = await import("../server/memories.js");
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, JSON.parse(init.body), init.headers]);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    memories: [
                      { key: "name", value: "John" },
                      { key: "favorite_food", value: "green tea ice cream" },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    };
  };
  const added = await summarizeMemories({
    apiKey: "k",
    petName: "Momo",
    language: "en",
    existing: [{ key: "name", value: "John" }],
    transcript: [
      { sender: "user", text: "I'm John and I love green tea ice cream" },
      { sender: "bot", text: "Yum!" },
    ],
    fetchImpl,
  });
  assert.deepEqual(added, [
    { key: "favorite_food", value: "green tea ice cream" },
  ]);
  assert.match(calls[0][0], /generativelanguage\.googleapis\.com/);
  assert.equal(calls[0][2]["x-goog-api-key"], "k");
  const prompt = calls[0][1].contents[0].parts[0].text;
  assert.match(prompt, /Known facts:\n- name: John/);
  assert.match(
    prompt,
    /Friend: I'm John and I love green tea ice cream\nMomo: Yum!/,
  );
  assert.equal(
    calls[0][1].generationConfig.responseMimeType,
    "application/json",
  );
  assert.equal(
    calls[0][1].generationConfig.responseSchema.properties.memories.items
      .required.length,
    2,
  );

  // Nothing from the friend means nothing to ask about.
  assert.deepEqual(
    await summarizeMemories({
      apiKey: "k",
      transcript: [{ sender: "bot", text: "Hello" }],
      fetchImpl,
    }),
    [],
  );
  assert.equal(calls.length, 1);

  const failing = (status) => async () => ({
    ok: false,
    status,
    text: async () => "boom",
  });
  await assert.rejects(
    summarizeMemories({
      apiKey: "k",
      transcript: [{ role: "user", text: "hi" }],
      fetchImpl: failing(403),
    }),
    /invalid_key/,
  );
  await assert.rejects(
    summarizeMemories({
      apiKey: "k",
      transcript: [{ role: "user", text: "hi" }],
      fetchImpl: failing(429),
    }),
    /rate_limited/,
  );
  await assert.rejects(
    summarizeMemories({
      apiKey: "k",
      transcript: [{ role: "user", text: "hi" }],
      fetchImpl: async () => {
        throw new Error("net");
      },
    }),
    /gemini_unreachable/,
  );
});

test("memory keys normalise to snake_case and get readable labels", async () => {
  const { normalizeKey, normalizeValue, keyLabel } =
    await import("../src/memory-keys.js");
  assert.equal(normalizeKey("  Favorite Food! "), "favorite_food");
  assert.equal(normalizeKey("วิชาโปรด"), "วิชาโปรด");
  assert.equal(normalizeKey("___"), "");
  assert.equal(normalizeKey("x".repeat(100)).length, 60);
  assert.equal(normalizeValue("  19   March  "), "19 March");
  assert.equal(keyLabel("favorite_food", "en"), "Favorite food");
  assert.equal(keyLabel("favorite_food", "th"), "อาหารโปรด");
  assert.equal(keyLabel("best_friend_name", "th"), "Best friend name");
  assert.equal(keyLabel("", "en"), "");
});

test("the browser reads only this session's turns from the widget's stored history", async () => {
  const { readWidgetHistory, transcriptSince, HISTORY_KEY_PREFIX } =
    await import("../src/memories.js");
  const backing = new Map([
    [
      `${HISTORY_KEY_PREFIX}abc`,
      JSON.stringify([
        { sender: "user", text: "old chat", timestamp: 100 },
        { sender: "user", text: "My name is John", timestamp: 500 },
        { sender: "bot", text: "Hi John!", uiText: "Hi John!", timestamp: 600 },
      ]),
    ],
    ["paintmomo.language", "en"],
    [`${HISTORY_KEY_PREFIX}broken`, "{not json"],
  ]);
  const storage = {
    get length() {
      return backing.size;
    },
    key: (i) => [...backing.keys()][i],
    getItem: (k) => backing.get(k) ?? null,
  };
  const items = readWidgetHistory(storage);
  assert.equal(items.length, 3);
  assert.deepEqual(transcriptSince(items, 400), [
    { role: "user", text: "My name is John" },
    { role: "pet", text: "Hi John!" },
  ]);
  assert.equal(transcriptSince(items).length, 3);
  assert.deepEqual(readWidgetHistory(null), []);
  // The live store and localStorage overlap; the same turn is not sent twice.
  const { readWidgetStoreHistory } = await import("../src/memories.js");
  const live = readWidgetStoreHistory({
    ChatWidget: { getState: () => ({ chatHistory: items.slice(1) }) },
  });
  assert.equal(live.length, 2);
  assert.equal(transcriptSince([...live, ...items], 400).length, 2);
  assert.deepEqual(readWidgetStoreHistory({}), []);
  assert.deepEqual(
    readWidgetStoreHistory({
      ChatWidget: {
        getState() {
          throw new Error("x");
        },
      },
    }),
    [],
  );
});

test("chat instructions carry the memories in the chosen language", async () => {
  const { buildChatGreeting, memoryInstructions } =
    await import("../src/prompt-builder.js");
  const pet = {
    name: "Momo",
    petType: "minicat",
    personalityPrompt: "Friendly.",
  };
  const memories = [
    { key: "name", value: "John" },
    { key: "favorite_food", value: "green tea ice cream" },
    "Legacy free-text fact.",
  ];
  const en = buildChatGreeting(pet, "en", memories);
  assert.match(
    en,
    /Things you remember about your friend from earlier chats:\n- name: John\n- favorite food: green tea ice cream\n- Legacy free-text fact\./,
  );
  assert.match(en, /say happily that you will/);
  const th = buildChatGreeting(pet, "th", memories);
  assert.match(
    th,
    /สิ่งที่เธอจำได้เกี่ยวกับเพื่อนจากการคุยครั้งก่อน:\n- name: John/,
  );
  assert.match(
    memoryInstructions([], "en"),
    /^If your friend asks you to remember something/,
  );
  assert.ok(
    !memoryInstructions([{ key: "name", value: "  " }], "en").includes(
      "Things you remember",
    ),
  );
});

test("on-device rules catch names, numbers, birthdays, favourites and remember requests", async () => {
  const { extractMemories, rememberRequest } =
    await import("../src/memory-rules.js");
  const pick = (text, opts) => extractMemories(text, opts);
  assert.deepEqual(pick("ผมชื่อวินน์ครับ"), [{ key: "name", value: "วินน์" }]);
  assert.deepEqual(pick("เบอร์โทร 0618201998"), [
    { key: "phone", value: "0618201998" },
  ]);
  assert.deepEqual(pick("ช่วยจำหน่อยว่าวันเกิดของชั้นวันที่ 19 มีนาคม"), [
    { key: "birthday", value: "19 มีนาคม" },
  ]);
  assert.deepEqual(pick("ฉันชื่อดาวนะ อายุ 8 ขวบ ชอบกินไอติมชาเขียว"), [
    { key: "name", value: "ดาว" },
    { key: "age", value: "8" },
    { key: "favorite_food", value: "ไอติมชาเขียว" },
  ]);
  assert.deepEqual(pick("ชอบวิชาวิทยาศาสตร์มากเลย"), [
    { key: "favorite_subject", value: "วิทยาศาสตร์" },
  ]);
  assert.deepEqual(pick("จำไว้นะว่าฉันมีหมาชื่อแม็กซ์", { noteIndex: 3 }), [
    { key: "note_3", value: "ฉันมีหมาชื่อแม็กซ์" },
  ]);
  assert.deepEqual(pick("ชื่ออะไรเหรอ"), []);
  assert.deepEqual(pick("I'm hungry"), []);
  assert.deepEqual(pick("my name is John and my birthday is March 19"), [
    { key: "name", value: "John" },
    { key: "birthday", value: "March 19" },
  ]);
  assert.deepEqual(pick("please remember my favorite subject is science"), [
    { key: "favorite_subject", value: "science" },
  ]);
  assert.deepEqual(pick("remember that I have a dog named Max"), [
    { key: "note_1", value: "I have a dog named Max" },
  ]);
  assert.deepEqual(pick("my phone number is 061-820-1998"), [
    { key: "phone", value: "0618201998" },
  ]);
  assert.deepEqual(pick("you can call me Win"), [
    { key: "nickname", value: "Win" },
  ]);
  assert.deepEqual(pick("I am 9 years old"), [{ key: "age", value: "9" }]);
  assert.equal(rememberRequest("ช่วยจำหน่อยว่าฉันกลัวผี"), "ฉันกลัวผี");
  assert.equal(rememberRequest("I remembered my homework"), "");
  assert.deepEqual(pick(""), []);
});
