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
  ]);
  assert.deepEqual(turns, [
    { role: "user", text: "My name is John" },
    { role: "pet", text: "Hi John!" },
    { role: "user", text: "I like green tea ice cream" },
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

test("merging keeps only new, distinct facts within the limits", async () => {
  const { mergeMemories, MEMORY_LIMITS } =
    await import("../server/memories.js");
  const fresh = mergeMemories(
    ["My friend's name is John."],
    [
      "my friend's name is John",
      "  My friend was born on 19 March.  ",
      "My friend was born on 19 March.",
      "",
      "x".repeat(500),
    ],
  );
  assert.deepEqual(fresh, [
    "My friend was born on 19 March.",
    "x".repeat(MEMORY_LIMITS.maxChars),
  ]);
  const many = mergeMemories(
    [],
    Array.from({ length: 20 }, (_, i) => `fact ${i}`),
  );
  assert.equal(many.length, MEMORY_LIMITS.maxPerSession);
  const full = mergeMemories(
    Array.from({ length: MEMORY_LIMITS.maxTotal }, (_, i) => `old ${i}`),
    ["new"],
  );
  assert.deepEqual(full, []);
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
                      "My friend's name is John.",
                      "My friend likes green tea ice cream.",
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
    existing: ["My friend's name is John."],
    transcript: [
      { sender: "user", text: "I'm John and I love green tea ice cream" },
      { sender: "bot", text: "Yum!" },
    ],
    fetchImpl,
  });
  assert.deepEqual(added, ["My friend likes green tea ice cream."]);
  assert.match(calls[0][0], /generativelanguage\.googleapis\.com/);
  assert.equal(calls[0][2]["x-goog-api-key"], "k");
  const prompt = calls[0][1].contents[0].parts[0].text;
  assert.match(prompt, /Known facts:\n- My friend's name is John\./);
  assert.match(
    prompt,
    /Friend: I'm John and I love green tea ice cream\nMomo: Yum!/,
  );
  assert.equal(
    calls[0][1].generationConfig.responseMimeType,
    "application/json",
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
    { content: "My friend's name is John." },
    "My friend likes green tea ice cream.",
  ];
  const en = buildChatGreeting(pet, "en", memories);
  assert.match(
    en,
    /Things you remember about your friend from earlier chats:\n- My friend's name is John\.\n- My friend likes green tea ice cream\./,
  );
  assert.match(en, /say happily that you will/);
  const th = buildChatGreeting(pet, "th", memories);
  assert.match(
    th,
    /สิ่งที่เธอจำได้เกี่ยวกับเพื่อนจากการคุยครั้งก่อน:\n- My friend's name is John\./,
  );
  assert.match(
    memoryInstructions([], "en"),
    /^If your friend asks you to remember something/,
  );
  assert.ok(
    !memoryInstructions([{ content: "  " }], "en").includes(
      "Things you remember",
    ),
  );
});
