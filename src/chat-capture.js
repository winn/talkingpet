// Capture spoken lines during realtime talk for the messenger window.
//
// Realtime-ar does not put turns into ChatWidget.getState().chatHistory.
// User/bot lines go to UsageTracker.history as { sender, text, timestamp }
// via addHistoryMessage. Pet lines also flash as `.bcw-rt-bubble` nodes.
//
// Capture paths (all kept cheap):
// 1) 300ms bubble poll
// 2) Array.prototype.push tap for { sender: user|bot, text }
// 3) Direct wrap of UsageTracker.history.push when the tracker appears
// 4) Fetch tap on webavatar telemetry history payloads
// 5) Full harvest of tracker/store history right before remember
import { isInternalPromptText } from "./prompt-filter.js";

const BOT_BUBBLE_SEL =
  "#bcw-rt-bubble-container .bcw-rt-bubble, .bcw-rt-bubble, .bcw-floating-bubble.bcw-float-bot";
const USER_BUBBLE_SEL =
  ".bcw-floating-bubble.bcw-float-user, #bcw-overlay-user";
const POLL_MS = 300;
const NOTIFY_MS = 200;

let turns = [];
let bubbleSeq = 0;
let pollTimer = null;
let onChange = null;
let notifyTimer = null;
let lastNotifyKey = "";
let tapping = false;
const bubbleIds = new WeakMap();
const nativePush = Array.prototype.push;
let nativeFetch = null;
let tappedHistoryArray = null;
let tappedHistoryPush = null;

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function scheduleNotify() {
  if (!onChange) return;
  const key = turns.map((t) => `${t.sender}:${t.text}`).join("|");
  if (key === lastNotifyKey) return;
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    lastNotifyKey = key;
    try {
      onChange();
    } catch {}
  }, NOTIFY_MS);
}

function bubbleId(el) {
  let id = bubbleIds.get(el);
  if (!id) {
    id = `bubble-${++bubbleSeq}`;
    bubbleIds.set(el, id);
  }
  return id;
}

function upsertBubble(el, role) {
  if (!(el instanceof Element)) return false;
  const text = cleanText(el.textContent);
  if (!text || isInternalPromptText(text)) return false;
  const id = bubbleId(el);
  const sender = role === "user" ? "user" : "bot";
  const existing = turns.find((turn) => turn.bubbleId === id);
  if (existing) {
    if (existing.text === text && existing.sender === sender) return false;
    existing.text = text;
    existing.sender = sender;
    existing.timestamp = Date.now();
    return true;
  }
  nativePush.call(turns, {
    sender,
    text,
    timestamp: Date.now(),
    bubbleId: id,
  });
  return true;
}

function scan() {
  if (typeof document === "undefined") return;
  let changed = false;
  for (const el of document.querySelectorAll(BOT_BUBBLE_SEL)) {
    if (upsertBubble(el, "bot")) changed = true;
  }
  for (const el of document.querySelectorAll(USER_BUBBLE_SEL)) {
    if (upsertBubble(el, "user")) changed = true;
  }
  if (changed) scheduleNotify();
  tapUsageTrackerHistory();
}

function itemText(item) {
  if (!item || typeof item !== "object") return "";
  return cleanText(
    item.text ??
      item.uiText ??
      item.message ??
      item.content ??
      item.utterance ??
      item.transcript ??
      item.asrText ??
      item.speech ??
      "",
  );
}

function itemSender(item) {
  const who = String(item?.sender ?? item?.role ?? "").toLowerCase();
  if (who === "user" || who === "me" || who === "human" || who === "friend")
    return "user";
  if (who === "bot" || who === "pet" || who === "assistant" || who === "model")
    return "bot";
  return "";
}

function ingestHistoryItems(items) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const sender = itemSender(item);
    const text = itemText(item);
    if (!sender || !text || isInternalPromptText(text)) continue;
    pushCapturedTurn({
      sender,
      text,
      timestamp: Number(item.timestamp ?? item.time) || Date.now(),
    });
  }
}

/** Ultra-cheap: objects with sender user|bot and a string speech field. */
function historyTapPush(...items) {
  if (tapping) ingestHistoryItems(items);
  return nativePush.apply(this, items);
}

function installHistoryTap() {
  if (Array.prototype.push !== historyTapPush)
    Array.prototype.push = historyTapPush;
}

function uninstallHistoryTap() {
  if (Array.prototype.push === historyTapPush)
    Array.prototype.push = nativePush;
}

function looksLikeTurnHistory(arr) {
  if (!Array.isArray(arr) || !arr.length) return false;
  let hits = 0;
  for (let i = Math.max(0, arr.length - 8); i < arr.length; i++) {
    const item = arr[i];
    if (itemSender(item) && itemText(item)) hits++;
  }
  return hits > 0;
}

function findUsageTracker(win = globalThis.window) {
  const cw = win?.ChatWidget;
  if (!cw || typeof cw !== "object") return null;
  if (cw.usageTracker && Array.isArray(cw.usageTracker.history))
    return cw.usageTracker;
  try {
    for (const key of Object.keys(cw)) {
      const value = cw[key];
      if (
        value &&
        typeof value === "object" &&
        Array.isArray(value.history) &&
        typeof value.addHistoryMessage === "function"
      )
        return value;
    }
  } catch {}
  return null;
}

function unwrapUsageTrackerHistory() {
  if (tappedHistoryArray && tappedHistoryPush) {
    try {
      tappedHistoryArray.push = tappedHistoryPush;
    } catch {}
  }
  tappedHistoryArray = null;
  tappedHistoryPush = null;
}

/** Wrap the live UsageTracker.history array so voice turns are never missed. */
function tapUsageTrackerHistory() {
  if (!tapping) return;
  const tracker = findUsageTracker();
  const history = tracker?.history;
  if (!Array.isArray(history)) return;
  if (history === tappedHistoryArray) return;
  unwrapUsageTrackerHistory();
  ingestHistoryItems(history);
  tappedHistoryArray = history;
  tappedHistoryPush = history.push.bind(history);
  history.push = function tappedTrackerPush(...items) {
    if (tapping) ingestHistoryItems(items);
    return tappedHistoryPush(...items);
  };
}

/**
 * Pull every history-like array we can find on the widget right before
 * summarise — covers turns the push taps missed.
 */
export function harvestWidgetHistories(win = globalThis.window) {
  const items = [];
  const seen = new Set();
  const take = (arr) => {
    if (!Array.isArray(arr) || seen.has(arr)) return;
    seen.add(arr);
    if (!looksLikeTurnHistory(arr) && arr !== findUsageTracker(win)?.history)
      return;
    for (const item of arr) {
      const sender = itemSender(item);
      const text = itemText(item);
      if (!sender || !text || isInternalPromptText(text)) continue;
      items.push({
        sender,
        text,
        timestamp: Number(item.timestamp ?? item.time) || Date.now(),
      });
    }
  };

  try {
    const state = win?.ChatWidget?.getState?.();
    take(state?.chatHistory);
    take(state?.history);
  } catch {}
  try {
    take(findUsageTracker(win)?.history);
  } catch {}
  try {
    const cw = win?.ChatWidget;
    if (cw && typeof cw === "object") {
      for (const key of Object.keys(cw)) {
        const value = cw[key];
        if (Array.isArray(value)) take(value);
        else if (value && typeof value === "object" && Array.isArray(value.history))
          take(value.history);
      }
    }
  } catch {}

  ingestHistoryItems(items);
  return items;
}

function installFetchTap() {
  if (nativeFetch || typeof fetch !== "function") return;
  nativeFetch = fetch.bind(globalThis);
  globalThis.fetch = function tappedFetch(input, init) {
    try {
      if (tapping) {
        const url = String(
          typeof input === "string" ? input : input?.url || "",
        );
        if (url.includes("webavatarTelemetryApi")) {
          const raw = init?.body;
          if (typeof raw === "string" && raw.includes('"history"')) {
            const data = JSON.parse(raw);
            ingestHistoryItems(data.history);
          }
        }
      }
    } catch {}
    return nativeFetch(input, init);
  };
}

function uninstallFetchTap() {
  if (nativeFetch) {
    globalThis.fetch = nativeFetch;
    nativeFetch = null;
  }
}

/** Start light capture of realtime speech (bubbles + history writes). */
export function startChatCapture(_root, { onCapture } = {}) {
  stopChatCapture();
  onChange = typeof onCapture === "function" ? onCapture : null;
  lastNotifyKey = "";
  tapping = true;
  installHistoryTap();
  installFetchTap();
  tapUsageTrackerHistory();
  scan();
  pollTimer = setInterval(scan, POLL_MS);
}

export function stopChatCapture() {
  tapping = false;
  unwrapUsageTrackerHistory();
  uninstallHistoryTap();
  uninstallFetchTap();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  clearTimeout(notifyTimer);
  notifyTimer = null;
  onChange = null;
}

/** Turns captured from bubbles / history / manual pushes. */
export function getCapturedTurns() {
  return turns.map(({ sender, text, timestamp }) => ({
    sender,
    text,
    timestamp,
  }));
}

export function clearCapturedTurns() {
  turns = [];
  lastNotifyKey = "";
}

/** Record a turn from another path (typed echo, onUserMessage). */
export function pushCapturedTurn({
  sender = "bot",
  text,
  timestamp = Date.now(),
}) {
  const cleaned = cleanText(text);
  if (!cleaned || isInternalPromptText(cleaned)) return;
  const who = String(sender).toLowerCase() === "user" ? "user" : "bot";
  const last = turns[turns.length - 1];
  if (
    last &&
    last.sender === who &&
    last.text === cleaned &&
    timestamp - last.timestamp < 2000
  )
    return;
  nativePush.call(turns, { sender: who, text: cleaned, timestamp });
  scheduleNotify();
}

/** Optional one-shot scan (e.g. when opening the chat panel). */
export function refreshChatCapture() {
  scan();
  harvestWidgetHistories();
}
