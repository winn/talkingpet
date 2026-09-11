// Talk-mode Settings button, layered into the hosted chat widget's control
// column in the slot its AR toggle used to occupy. It opens a small panel with
// the English / Thai switch; the existing document-level language controls
// (see i18n.js) handle the actual switch, so this file only owns the markup
// and open/close state. Nothing here reads or changes the widget's source.
import { applyTranslations } from "./i18n.js";

export const SETTINGS_WRAP_ID = "talkSettingsWrap";
export const SETTINGS_BUTTON_ID = "talkSettingsBtn";
export const SETTINGS_PANEL_ID = "talkSettingsPanel";

const GEAR_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19.4 13a7.6 7.6 0 0 0 .1-1 7.6 7.6 0 0 0-.1-1l2.1-1.6a.5.5 0 0 0 .1-.7l-2-3.4a.5.5 0 0 0-.6-.2l-2.5 1a7.3 7.3 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.5.5l-.4 2.6a7.3 7.3 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.4a.5.5 0 0 0 .1.7L4.6 11a7.6 7.6 0 0 0-.1 1 7.6 7.6 0 0 0 .1 1l-2.1 1.6a.5.5 0 0 0-.1.7l2 3.4a.5.5 0 0 0 .6.2l2.5-1a7.3 7.3 0 0 0 1.7 1l.4 2.6a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5l.4-2.6a7.3 7.3 0 0 0 1.7-1l2.5 1a.5.5 0 0 0 .6-.2l2-3.4a.5.5 0 0 0-.1-.7L19.4 13zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>`;

function buildWrap(doc) {
  const wrap = doc.createElement("div");
  wrap.id = SETTINGS_WRAP_ID;
  wrap.innerHTML = `
    <div id="${SETTINGS_PANEL_ID}" class="talk-settings-panel" role="dialog"
      aria-label="Settings" data-i18n-aria-label="Settings" hidden>
      <span class="talk-settings-label" data-i18n="Language">Language</span>
      <div class="language-switch" role="group" aria-label="Language"
        data-i18n-aria-label="Language">
        <button type="button" data-language="en" lang="en" aria-pressed="true">English</button
        ><button type="button" data-language="th" lang="th" aria-pressed="false">ไทย</button>
      </div>
    </div>
    <button type="button" id="${SETTINGS_BUTTON_ID}"
      class="bcw-rt-btn bcw-rt-btn-secondary talk-settings-button"
      aria-label="Settings" data-i18n-aria-label="Settings"
      aria-haspopup="dialog" aria-expanded="false">${GEAR_ICON}</button>`;
  return wrap;
}

/**
 * Ensure the Settings button is mounted inside `container` (the chat widget
 * container). Prefers the widget's own control column so the button lines up
 * with volume and call; falls back to the container itself until the widget
 * renders its controls. Safe to call on every DOM mutation: it only creates
 * the wrap once and only moves it when its home changes.
 */
export function mountTalkSettings(container, doc = container?.ownerDocument) {
  if (!container || !doc) return null;
  let wrap = container.querySelector(`#${SETTINGS_WRAP_ID}`);
  const fresh = !wrap;
  if (fresh) {
    wrap = buildWrap(doc);
    wireWrap(wrap, doc);
  }
  const controls = container.querySelector("#bcw-rt-controls");
  const home = controls || container;
  if (wrap.parentElement !== home) {
    const call = controls?.querySelector("#bcw-rt-call-btn-wrap");
    if (call) controls.insertBefore(wrap, call);
    else home.appendChild(wrap);
  }
  wrap.classList.toggle("talk-settings-floating", !controls);
  // Translate once attached so the current language's toggle reads pressed.
  if (fresh) applyTranslations(wrap);
  return wrap;
}

export function setTalkSettingsOpen(wrap, open) {
  const button = wrap?.querySelector(`#${SETTINGS_BUTTON_ID}`);
  const panel = wrap?.querySelector(`#${SETTINGS_PANEL_ID}`);
  if (!button || !panel) return;
  panel.hidden = !open;
  button.setAttribute("aria-expanded", String(Boolean(open)));
}

export function isTalkSettingsOpen(wrap) {
  const panel = wrap?.querySelector(`#${SETTINGS_PANEL_ID}`);
  return Boolean(panel) && !panel.hidden;
}

let activeWrap = null;
const documentsWired = new WeakSet();

function wireWrap(wrap, doc) {
  activeWrap = wrap;
  const button = wrap.querySelector(`#${SETTINGS_BUTTON_ID}`);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    setTalkSettingsOpen(wrap, !isTalkSettingsOpen(wrap));
  });
  // Picking a language is handled by i18n's document click listener; here we
  // only close the panel afterwards so the pet is uncovered again.
  wrap.addEventListener("click", (event) => {
    if (event.target.closest("[data-language]"))
      setTalkSettingsOpen(wrap, false);
  });
  // Outside-click and Escape are wired once per document and act on whichever
  // wrap is current, so widget re-renders never stack up listeners.
  if (documentsWired.has(doc)) return;
  documentsWired.add(doc);
  doc.addEventListener("pointerdown", (event) => {
    if (isTalkSettingsOpen(activeWrap) && !activeWrap.contains(event.target))
      setTalkSettingsOpen(activeWrap, false);
  });
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isTalkSettingsOpen(activeWrap)) {
      setTalkSettingsOpen(activeWrap, false);
      activeWrap
        .querySelector(`#${SETTINGS_BUTTON_ID}`)
        ?.focus({ preventScroll: true });
    }
  });
}
