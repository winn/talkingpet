// Capture the hosted widget's realtime speech bubbles into durable turns.
// In realtime-ar mode the pet's lines are shown as short-lived `.bcw-rt-bubble`
// nodes and written to an internal usage tracker — they never reach
// ChatWidget.getState().chatHistory — so the messenger window has to watch
// the DOM the widget already paints.
const BUBBLE_SEL = ".bcw-rt-bubble";

let turns = [];
let bubbleSeq = 0;
let observer = null;
let rootEl = null;
const bubbleIds = new WeakMap();

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function bubbleId(el) {
  let id = bubbleIds.get(el);
  if (!id) {
    id = `bubble-${++bubbleSeq}`;
    bubbleIds.set(el, id);
  }
  return id;
}

function upsertBubble(el, role = "pet") {
  if (!(el instanceof Element)) return;
  const text = cleanText(el.textContent);
  if (!text) return;
  const id = bubbleId(el);
  const existing = turns.find((turn) => turn.bubbleId === id);
  if (existing) {
    existing.text = text;
    existing.timestamp = Number(existing.timestamp) || Date.now();
    return;
  }
  turns.push({
    sender: role === "user" ? "user" : "bot",
    text,
    timestamp: Date.now(),
    bubbleId: id,
  });
}

function scan(root = rootEl) {
  if (!root) return;
  for (const el of root.querySelectorAll(BUBBLE_SEL)) upsertBubble(el, "pet");
}

function onMutations(mutations) {
  for (const mutation of mutations) {
    if (mutation.type === "characterData") {
      const el = mutation.target?.parentElement?.closest?.(BUBBLE_SEL);
      if (el) upsertBubble(el, "pet");
      continue;
    }
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.(BUBBLE_SEL)) upsertBubble(node, "pet");
      else node.querySelectorAll?.(BUBBLE_SEL)?.forEach((el) => upsertBubble(el, "pet"));
    }
    if (mutation.type === "attributes" && mutation.target instanceof Element) {
      if (mutation.target.matches?.(BUBBLE_SEL)) upsertBubble(mutation.target, "pet");
    }
  }
}

/** Start watching the talk surface for realtime pet bubbles. */
export function startChatCapture(root) {
  stopChatCapture();
  rootEl = root || null;
  if (!rootEl) return;
  scan(rootEl);
  observer = new MutationObserver(onMutations);
  observer.observe(rootEl, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class"],
  });
}

export function stopChatCapture() {
  observer?.disconnect();
  observer = null;
  rootEl = null;
}

/** Turns captured from realtime bubbles (and any manual pushes). */
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
export function pushCapturedTurn({ sender = "bot", text, timestamp = Date.now() }) {
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
}

/** Re-scan once (e.g. from the live tick) in case an observer gap missed a bubble. */
export function refreshChatCapture() {
  scan();
}
