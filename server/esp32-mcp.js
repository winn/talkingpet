// MCP tools for the ESP32-S3 kit REST API.
// Docs: temperature, humidity, LDR, LEDs 15/16/17, buzzer, and the onboard RGB.
import { env } from "./env.js";

const PROTOCOL_VERSION = "2025-03-26";
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_BASE = "https://shipping-nickel-erik-ons.trycloudflare.com";
const LED_PINS = [15, 16, 17];
const STATES = ["on", "off", "toggle"];
const COLORS = ["red", "green", "blue", "yellow", "purple", "cyan", "white", "off"];

export function kitBase() {
  return (env("ESP32_BASE_URL", DEFAULT_BASE) || DEFAULT_BASE).replace(/\/+$/, "");
}

export const KIT_TOOLS = [
  {
    name: "get_kit_status",
    description:
      "Read the ESP32-S3 kit: temperature, humidity, light level, LED states, buzzer, and the onboard RGB color. Use when asked how the kit is, how warm or bright it is, or whether a light or the buzzer is on.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "set_led",
    description:
      "Turn an LED on the ESP32-S3 kit on, off, or toggle it. Pins are 15, 16, and 17. Use when asked to switch a light or LED.",
    inputSchema: {
      type: "object",
      properties: {
        pin: { type: "integer", description: "LED pin: 15, 16, or 17", enum: LED_PINS },
        state: {
          type: "string",
          description: "on, off, or toggle. Omit to toggle.",
          enum: STATES,
        },
      },
      required: ["pin"],
    },
  },
  {
    name: "set_buzzer",
    description:
      "Turn the kit buzzer on, off, or toggle it. Use when asked to beep, alarm, or silence the buzzer.",
    inputSchema: {
      type: "object",
      properties: {
        state: {
          type: "string",
          description: "on, off, or toggle. Omit to toggle.",
          enum: STATES,
        },
      },
      required: [],
    },
  },
  {
    name: "set_rgb",
    description:
      "Set the onboard RGB LED color, or turn it on or off. Give r/g/b (0-255), a hex color, a named color (red, green, blue, yellow, purple, cyan, white, off), or state on/off/toggle.",
    inputSchema: {
      type: "object",
      properties: {
        r: { type: "integer", description: "Red 0-255. Send with g and b." },
        g: { type: "integer", description: "Green 0-255. Send with r and b." },
        b: { type: "integer", description: "Blue 0-255. Send with r and g." },
        hex: { type: "string", description: "Hex color, with or without #, such as FF00FF" },
        color: { type: "string", description: "Named color", enum: COLORS },
        state: { type: "string", description: "on, off, or toggle", enum: STATES },
      },
      required: [],
    },
  },
];

export async function handleRpc(message, { fetchImpl = fetch } = {}) {
  if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") {
    return rpcError(message?.id ?? null, -32600, "Invalid Request");
  }
  const { id, method, params } = message;
  if (id === undefined || id === null) return null;
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "esp32-s3-kit", version: "1.0.0" },
        instructions:
          "Tools for one ESP32-S3 kit: get_kit_status, set_led, set_buzzer, set_rgb.",
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: KIT_TOOLS });
    case "tools/call":
      return rpcResult(id, await callTool(params?.name, params?.arguments || {}, fetchImpl));
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

async function callTool(name, args, fetchImpl) {
  try {
    if (name === "get_kit_status") return text(formatStatus(await kitGet("/api/status", fetchImpl)));
    if (name === "set_led") return text(formatLed(await kitGet(ledPath(args), fetchImpl)));
    if (name === "set_buzzer") return text(formatBuzzer(await kitGet(buzzerPath(args), fetchImpl)));
    if (name === "set_rgb") return text(formatRgb(await kitGet(rgbPath(args), fetchImpl)));
    return text(`Unknown tool: ${name}`, true);
  } catch (err) {
    return text(err instanceof Error ? err.message : "The kit request failed.", true);
  }
}

export function ledPath(args) {
  const pin = Number(args?.pin);
  if (!LED_PINS.includes(pin)) throw new Error("pin must be 15, 16, or 17.");
  return `/api/led?pin=${pin}&state=${stateOf(args?.state)}`;
}

export function buzzerPath(args) {
  return `/api/buzzer?state=${stateOf(args?.state)}`;
}

export function rgbPath(args) {
  const params = new URLSearchParams();
  const hasChannel = ["r", "g", "b"].some((key) => args?.[key] != null && args[key] !== "");
  if (hasChannel) {
    for (const key of ["r", "g", "b"]) params.set(key, String(channel(args?.[key], key)));
  } else if (args?.hex) {
    const hex = String(args.hex).trim().replace(/^#/, "");
    if (!/^[0-9A-Fa-f]{6}$/.test(hex)) throw new Error("hex must be 6 hex digits, such as FF00FF.");
    params.set("hex", hex.toUpperCase());
  } else if (args?.color) {
    const color = String(args.color).trim().toLowerCase();
    if (!COLORS.includes(color)) throw new Error(`color must be one of ${COLORS.join(", ")}.`);
    params.set("color", color);
  } else if (args?.state) {
    params.set("state", stateOf(args.state));
  } else {
    throw new Error("Provide r, g, and b, or hex, or color, or state.");
  }
  return `/api/rgb?${params}`;
}

function stateOf(value) {
  if (value == null || value === "") return "toggle";
  const state = String(value).trim().toLowerCase();
  if (!STATES.includes(state)) throw new Error("state must be on, off, or toggle.");
  return state;
}

function channel(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(`${name} must be an integer from 0 to 255.`);
  return n;
}

async function kitGet(path, fetchImpl) {
  const url = `${kitBase()}${path}`;
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error(`Could not reach the ESP32 kit at ${kitBase()}.`);
  }
  const raw = await res.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw: raw.slice(0, 300) };
    }
  }
  if (!res.ok) throw new Error(`Kit returned ${res.status}.`);
  return data;
}

function formatStatus(data) {
  const rgb = data?.rgb || {};
  return [
    `Temperature ${num(data?.temperature)}°C, humidity ${num(data?.humidity)}%, light ${num(data?.ldr)}.`,
    `LED 15 ${onOff(data?.led_15)}, LED 16 ${onOff(data?.led_16)}, LED 17 ${onOff(data?.led_17)}.`,
    `Buzzer ${onOff(data?.buzzer)}. RGB ${onOff(rgb.state)}${rgb.hex ? ` ${rgb.hex}` : ""}.`,
  ].join(" ");
}

function formatLed(data) {
  return `LED ${data?.pin} is ${onOff(data?.state)}.`;
}

function formatBuzzer(data) {
  return `Buzzer is ${onOff(data?.buzzer)}.`;
}

function formatRgb(data) {
  return `RGB is ${onOff(data?.state)}${data?.hex ? ` ${data.hex}` : ""}.`;
}

function onOff(value) {
  return value ? "on" : "off";
}

function num(value) {
  return value == null || value === "" ? "unknown" : value;
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
