// The chat window: the talk as text, messenger style, with a box to type to
// the pet and a button that turns the log into permanent memories and clears
// it. main.js owns the data (the widget's public store plus typed messages)
// and the actions; this file owns the panel.
import { localizeText, t } from "./i18n.js";
import { historyItemText } from "./memories.js";

const $ = (selector) => document.querySelector(selector);
const USER = new Set(["user", "me", "human", "friend", "child"]);
let hooks = { onSend: async () => {}, onExtract: async () => {} };
let bound = false;
let lastCount = -1;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * One ordered list of turns for the current session: the widget's store
 * items plus messages typed here. A typed message that the widget later
 * echoes into its store (same text, same side) is shown once.
 */
export function mergeTurns(storeItems = [], typedTurns = [], since = 0) {
  const turns = [];
  const seen = new Set();
  const add = (item, local) => {
    if (!item || typeof item !== "object") return;
    const timestamp = Number(item.timestamp ?? item.time ?? 0);
    if (since && timestamp && timestamp < since) return;
    const text = historyItemText(item);
    if (!text) return;
    const who = String(item.sender ?? item.role ?? "").toLowerCase();
    const role = USER.has(who) ? "user" : "pet";
    const key = `${role}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    turns.push({ role, text, timestamp, local });
  };
  for (const item of Array.isArray(storeItems) ? storeItems : [])
    add(item, false);
  for (const item of Array.isArray(typedTurns) ? typedTurns : [])
    add(item, true);
  return turns.sort((a, b) => a.timestamp - b.timestamp);
}

export function isChatLogOpen() {
  const panel = $("#chatLogPanel");
  return Boolean(panel) && !panel.hidden;
}

export function renderChatLog(turns) {
  const list = $("#chatLogList");
  const empty = $("#chatLogEmpty");
  if (!list) return;
  empty.hidden = turns.length > 0;
  const html = turns
    .map(
      (turn) =>
        `<li class="chat-bubble ${turn.role === "user" ? "chat-bubble-user" : "chat-bubble-pet"}">${escapeHtml(turn.text)}</li>`,
    )
    .join("");
  if (list.dataset.pmHtml === html) return;
  const nearBottom =
    list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.dataset.pmHtml = html;
  list.innerHTML = html;
  if (turns.length !== lastCount && (nearBottom || turns.length > lastCount))
    list.scrollTop = list.scrollHeight;
  lastCount = turns.length;
}

export function openChatLog({ petName = "" } = {}) {
  const panel = $("#chatLogPanel");
  if (!panel) return;
  if (petName)
    localizeText($("#chatLogTitle"), "Chat with {name}", { name: petName });
  else localizeText($("#chatLogTitle"), "Chat");
  panel.hidden = false;
  lastCount = -1;
  const list = $("#chatLogList");
  list.scrollTop = list.scrollHeight;
  $("#chatLogInput").focus({ preventScroll: true });
}

export function closeChatLog() {
  const panel = $("#chatLogPanel");
  if (panel) panel.hidden = true;
}

export function initChatLog(options = {}) {
  hooks = { ...hooks, ...options };
  if (bound || !$("#chatLogPanel")) return;
  bound = true;
  $("#chatLogForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#chatLogInput");
    const text = input.value.trim();
    if (!text) return input.focus();
    input.value = "";
    await hooks.onSend(text);
    input.focus({ preventScroll: true });
  });
  $("#chatExtractBtn").addEventListener("click", async () => {
    const button = $("#chatExtractBtn");
    button.disabled = true;
    try {
      await hooks.onExtract();
    } finally {
      button.disabled = false;
    }
  });
  $("#closeChatLogBtn").addEventListener("click", closeChatLog);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isChatLogOpen()) closeChatLog();
  });
}

export const chatLogText = (key, params) => t(key, params);
