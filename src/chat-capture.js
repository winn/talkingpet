// Capture what the pet says during realtime talk.
//
// Realtime-ar does not put bot lines into ChatWidget.getState().chatHistory.
// Pet lines briefly appear as `.bcw-rt-bubble` nodes (often under
// #bcw-rt-bubble-container on the page, not inside our chat mount). A light
// poll is enough — no global Array hooks, no document-wide characterData
// observers (those made Talk feel slow).
const BUBBLE_SEL =
  "#bcw-rt-bubble-container .bcw-rt-bubble, .bcw-rt-bubble, .bcw-floating-bubble.bcw-float-bot";
const POLL_MS = 300;
const NOTIFY_MS = 200;

let turns = [];
let bubbleSeq = 0;
let pollTimer = null;
let onChange = null;
let notifyTimer = null;
let lastNotifyKey = "";
const bubbleIds = new WeakMap();

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

function upsertBubble(el) {
  if (!(el instanceof Element)) return false;
  const text = cleanText(el.textContent);
  if (!text) return false;
  const id = bubbleId(el);
  const existing = turns.find((turn) => turn.bubbleId === id);
  if (existing) {
    if (existing.text === text) return false;
    existing.text = text;
    existing.timestamp = Date.now();
    return true;
  }
  turns.push({
    sender: "bot",
    text,
    timestamp: Date.now(),
    bubbleId: id,
  });
  return true;
}

function scan() {
  let changed = false;
  for (const el of document.querySelectorAll(BUBBLE_SEL)) {
    if (upsertBubble(el)) changed = true;
  }
  if (changed) scheduleNotify();
}

/** Start a light poll for realtime pet speech bubbles. */
export function startChatCapture(_root, { onCapture } = {}) {
  stopChatCapture();
  onChange = typeof onCapture === "function" ? onCapture : null;
  lastNotifyKey = "";
  scan();
  pollTimer = setInterval(scan, POLL_MS);
}

export function stopChatCapture() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  clearTimeout(notifyTimer);
  notifyTimer = null;
  onChange = null;
}

/** Turns captured from bubbles / manual pushes. */
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
  turns.push({ sender: who, text: cleaned, timestamp });
  scheduleNotify();
}

/** Optional one-shot scan (e.g. when opening the chat panel). */
export function refreshChatCapture() {
  scan();
}
