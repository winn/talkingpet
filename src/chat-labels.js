import { t } from "./i18n.js";

// Translate only rendered controls observed in the hosted widget. Never inspect
// its source or translate conversation text, names, balances, or account data.
const LABELS = new Set([
  "Volume level",
  "Volume",
  "Contract",
  "Connect to AI",
  "Account and credit information",
  "Close",
  "Close account information",
  "Top up credits",
  "Log out",
  "Available credits",
  "Session rate",
]);
const originals = new WeakMap();
function translated(node, slot, current) {
  const state = originals.get(node) || {};
  const previous = state[slot];
  const key = previous?.output === current ? previous.key : current.trim();
  if (!LABELS.has(key)) return current;
  const output = current.replace(current.trim(), t(key));
  state[slot] = { key, output };
  originals.set(node, state);
  return output;
}
export function localizeChatControls(container) {
  for (const scope of container.querySelectorAll(
    "#bcw-rt-controls, #bcw-rt-credit-drawer",
  )) {
    for (const element of [scope, ...scope.querySelectorAll("*")]) {
      if (["SCRIPT", "STYLE", "SVG", "PATH"].includes(element.tagName))
        continue;
      for (const attribute of ["aria-label", "title", "placeholder"]) {
        const current = element.getAttribute(attribute);
        if (!current) continue;
        const next = translated(element, attribute, current);
        if (next !== current) element.setAttribute(attribute, next);
      }
      for (const node of element.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim())
          continue;
        const next = translated(node, "text", node.textContent);
        if (next !== node.textContent) node.textContent = next;
      }
    }
  }
}
