// Capture spoken lines during realtime talk for the messenger window.
//
// Realtime-ar does not put turns into ChatWidget.getState().chatHistory.
// Pet lines briefly appear as `.bcw-rt-bubble` nodes; user speech usually has
// no bubble and is only written to an internal history array as
// { sender: "user"|"bot", text, timestamp }.
//
// We keep this cheap: a 300ms bubble poll, plus an Array.push tap that only
// inspects objects with sender === "user"|"bot" (primitives and Three.js
// pushes bail out in one typeof check). No document-wide MutationObservers.
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
  if (!text) return false;
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
  let changed = false;
  for (const el of document.querySelectorAll(BOT_BUBBLE_SEL)) {
    if (upsertBubble(el, "bot")) changed = true;
  }
  for (const el of document.querySelectorAll(USER_BUBBLE_SEL)) {
    if (upsertBubble(el, "user")) changed = true;
  }
  if (changed) scheduleNotify();
}

function ingestHistoryItems(items) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const who = String(item.sender ?? "").toLowerCase();
    if (who !== "user" && who !== "bot") continue;
    const text = cleanText(item.text);
    if (!text) continue;
    pushCapturedTurn({
      sender: who,
      text,
      timestamp: Number(item.timestamp) || Date.now(),
    });
  }
}

/** Ultra-cheap: only objects with sender user|bot and a string text field. */
function historyTapPush(...items) {
  if (tapping) {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const who = item.sender;
      if (who !== "user" && who !== "bot") continue;
      if (typeof item.text !== "string") continue;
      if (item.bubbleId != null) continue;
      const text = cleanText(item.text);
      if (!text) continue;
      pushCapturedTurn({
        sender: who,
        text,
        timestamp: Number(item.timestamp) || Date.now(),
      });
    }
  }
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
  scan();
  pollTimer = setInterval(scan, POLL_MS);
}

export function stopChatCapture() {
  tapping = false;
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
  if (!cleaned) return;
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
}
