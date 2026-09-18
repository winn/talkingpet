// Tiny built-in MCP server (Streamable HTTP, stateless JSON responses) used
// to test the "connect an MCP server" flow end to end. Weather comes from
// Open-Meteo, which is free and needs no API key.
const PROTOCOL_VERSION = "2025-03-26";
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const DEMO_TOOLS = [
  {
    name: "get_weather",
    description:
      "Current weather and a 3-day forecast for a city anywhere in the world. Use for any question about weather, temperature, rain or what to wear.",
    inputSchema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "City name, e.g. Bangkok, Chiang Mai, Tokyo",
        },
      },
      required: ["city"],
    },
  },
  {
    name: "roll_dice",
    description:
      "Roll real dice. Use whenever the user wants a dice roll, a random number or to play a dice game.",
    inputSchema: {
      type: "object",
      properties: {
        sides: { type: "integer", description: "Sides per die (default 6)" },
        count: { type: "integer", description: "How many dice (default 1)" },
      },
      required: [],
    },
  },
  {
    name: "get_secret_word",
    description:
      "Returns today's secret word. The word cannot be guessed; always call this tool when the user asks for the secret word.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

const WEATHER_CODES = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "rime fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  80: "light showers",
  81: "showers",
  82: "violent showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with heavy hail",
};

const SECRET_WORDS = [
  "mango-rocket",
  "purple-noodle",
  "sleepy-volcano",
  "disco-turtle",
  "banana-wizard",
  "cosmic-dumpling",
  "tickle-monsoon",
];

/**
 * Handle one JSON-RPC message. Returns the response object, or null for
 * notifications (which get no reply).
 */
export async function handleRpc(message, { fetchImpl = fetch, log = console.log } = {}) {
  if (!message || typeof message !== "object" || message.jsonrpc !== "2.0")
    return rpcError(message?.id ?? null, -32600, "Invalid Request");
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;
  log(`[mcp-demo] ${method}${method === "tools/call" ? ` ${params?.name} ${JSON.stringify(params?.arguments ?? {})}` : ""}`);
  if (isNotification) return null;

  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "talkingmomo-demo", version: "1.0.0" },
        instructions:
          "Demo tools for Talking Momo pets: get_weather, roll_dice, get_secret_word.",
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: DEMO_TOOLS });
    case "tools/call":
      return rpcResult(id, await callTool(params?.name, params?.arguments || {}, fetchImpl));
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

async function callTool(name, args, fetchImpl) {
  try {
    if (name === "get_weather") return text(await weather(args.city, fetchImpl));
    if (name === "roll_dice") return text(rollDice(args.sides, args.count));
    if (name === "get_secret_word") return text(`The secret word is "${secretWord()}".`);
    return text(`Unknown tool: ${name}`, true);
  } catch (err) {
    return text(err instanceof Error ? err.message : "Tool failed.", true);
  }
}

async function weather(city, fetchImpl) {
  const query = String(city || "").trim();
  if (!query) throw new Error("city is required.");
  // Thai names only resolve when the search language is Thai.
  const language = /[฀-๿]/.test(query) ? "th" : "en";
  const geo = await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?count=1&language=${language}&name=${encodeURIComponent(query)}`,
    fetchImpl,
  );
  const place = geo?.results?.[0];
  if (!place) throw new Error(`Could not find a city called "${query}".`);
  const data = await getJson(
    "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${place.latitude}&longitude=${place.longitude}` +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      "&forecast_days=3&timezone=auto",
    fetchImpl,
  );
  const now = data.current;
  const lines = [
    `Weather for ${[place.name, place.country].filter(Boolean).join(", ")}:`,
    `Now: ${describe(now.weather_code)}, ${now.temperature_2m}°C (feels like ${now.apparent_temperature}°C), humidity ${now.relative_humidity_2m}%, wind ${now.wind_speed_10m} km/h.`,
  ];
  (data.daily?.time || []).forEach((day, i) => {
    lines.push(
      `${day}: ${describe(data.daily.weather_code[i])}, ${data.daily.temperature_2m_min[i]}–${data.daily.temperature_2m_max[i]}°C, rain chance ${data.daily.precipitation_probability_max[i] ?? 0}%.`,
    );
  });
  return lines.join("\n");
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Weather service error (${res.status}).`);
  return res.json();
}

function describe(code) {
  return WEATHER_CODES[code] || `weather code ${code}`;
}

function rollDice(sides, count) {
  const s = clamp(sides, 2, 1000, 6);
  const n = clamp(count, 1, 20, 1);
  const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * s));
  const total = rolls.reduce((a, b) => a + b, 0);
  return n === 1
    ? `Rolled a d${s}: ${rolls[0]}.`
    : `Rolled ${n}d${s}: ${rolls.join(", ")} (total ${total}).`;
}

export function secretWord(date = new Date()) {
  const day = Math.floor(date.getTime() / 86_400_000);
  return SECRET_WORDS[day % SECRET_WORDS.length];
}

function clamp(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function text(value, isError = false) {
  return { content: [{ type: "text", text: value }], isError };
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
