// Capture what the pet says during realtime talk.
//
// Realtime-ar does not put bot lines into ChatWidget.getState().chatHistory.
// Lines go to an internal usageTracker.history (and optionally a short-lived
// .bcw-rt-bubble that may sit outside #chatWidgetContainer, or nowhere if
// bubbles are disabled). We:
//   1. force-watch the whole document for speech bubbles
//   2. tap Array.push for {sender, text, timestamp} widget history writes
// so the messenger window stays in sync either way.
import { historyItemText } from "./memories.js";

const BUBBLE_SEL = ".bcw-rt-bubble, .bcw-floating-bubble, .bcw-float-bot";

let turns = [];
let bubbleSeq = 0;
let observer = null;
let tapping = false;
let onChange = null;
const bubbleIds = new WeakMap();
const nativePush = Array.prototype.push;

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function notify() {
  try {
    onChange?.();
  } catch {}
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
  if (!(el instanceof Element)) return;
  const text = cleanText(el.textContent);
  if (!text) return;
  const id = bubbleId(el);
  const existing = turns.find((turn) => turn.bubbleId === id);
  if (existing) {
    if (existing.text === text) return;
    existing.text = text;
    existing.timestamp = Date.now();
    notify();
    return;
  }
  nativePush.call(turns, {
    sender: "bot",
    text,
    timestamp: Date.now(),
    bubbleId: id,
  });
  notify();
}

function scan(root = document) {
  if (!root?.querySelectorAll) return;
  for (const el of root.querySelectorAll(BUBBLE_SEL)) upsertBubble(el);
}

function onMutations(mutations) {
  for (const mutation of mutations) {
    if (mutation.type === "characterData") {
      const el = mutation.target?.parentElement?.closest?.(BUBBLE_SEL);
      if (el) upsertBubble(el);
      continue;
    }
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.(BUBBLE_SEL)) upsertBubble(node);
      else
        node
          .querySelectorAll?.(BUBBLE_SEL)
          ?.forEach((el) => upsertBubble(el));
    }
    if (
      mutation.type === "attributes" &&
      mutation.target instanceof Element &&
      mutation.target.matches?.(BUBBLE_SEL)
    )
      upsertBubble(mutation.target);
  }
}

function looksLikeWidgetTurn(item) {
  if (!item || typeof item !== "object") return false;
  if (item.bubbleId != null || item.local) return false;
  const who = String(item.sender ?? item.role ?? "").toLowerCase();
  if (who !== "user" && who !== "bot") return false;
  const text = historyItemText(item);
  if (!text) return false;
  const stamp = Number(item.timestamp ?? item.time ?? 0);
  if (stamp && Math.abs(Date.now() - stamp) > 5 * 60 * 1000) return false;
  return true;
}

function historyTapPush(...items) {
  if (tapping) {
    for (const item of items) {
      if (!looksLikeWidgetTurn(item)) continue;
      const who = String(item.sender ?? item.role ?? "").toLowerCase();
      const text = historyItemText(item);
      const stamp = Number(item.timestamp ?? item.time ?? Date.now());
      pushCapturedTurn({ sender: who, text, timestamp: stamp || Date.now() });
    }
  }
  return nativePush.apply(this, items);
}

function installHistoryTap() {
  if (Array.prototype.push === historyTapPush) return;
  Array.prototype.push = historyTapPush;
}

function uninstallHistoryTap() {
  if (Array.prototype.push === historyTapPush)
    Array.prototype.push = nativePush;
}

/** Start watching for realtime pet (and user) lines. */
export function startChatCapture(_root, { onCapture } = {}) {
  stopChatCapture();
  onChange = typeof onCapture === "function" ? onCapture : null;
  tapping = true;
  installHistoryTap();
  scan(document);
  observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class"],
  });
}

export function stopChatCapture() {
  tapping = false;
  uninstallHistoryTap();
  observer?.disconnect();
  observer = null;
  onChange = null;
}

/** Turns captured from bubbles / history taps / manual pushes. */
export function getCapturedTurns() {
  return turns.map(({ sender, text, timestamp }) => ({
    sender,
    text,
    timestamp,
  }));
}

export function clearCapturedTurns() {
  turns = [];
}

/** Record a turn that did not come from a bubble (typed echo, callbacks). */
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
  notify();
}

/** Re-scan the document in case an observer gap missed a bubble. */
export function refreshChatCapture() {
  scan(document);
}
