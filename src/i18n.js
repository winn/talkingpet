import { TH } from "./locales/th.js";

const STORAGE_KEY = "paintmomo.language";
let language = "en";
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "th" || stored === "en") {
    language = stored;
  } else if (
    typeof navigator !== "undefined" &&
    navigator.language &&
    navigator.language.toLowerCase().startsWith("th")
  ) {
    language = "th";
  }
} catch {}

export function getLanguage() {
  return language;
}
export function t(key, params = {}) {
  const template = language === "th" ? TH[key] || key : key;
  return template.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
}
export function localizeText(element, key, params = {}) {
  element.dataset.i18n = key;
  element.dataset.i18nParams = JSON.stringify(params);
  element.textContent = t(key, params);
}
export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(
      element.dataset.i18n,
      JSON.parse(element.dataset.i18nParams || "{}"),
    );
  });
  for (const attribute of ["aria-label", "title", "alt", "placeholder"]) {
    root.querySelectorAll(`[data-i18n-${attribute}]`).forEach((element) => {
      element.setAttribute(
        attribute,
        t(element.getAttribute(`data-i18n-${attribute}`)),
      );
    });
  }
  document.documentElement.lang = language;
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.language === language),
    );
  });
}
export function setLanguage(next) {
  if (!["en", "th"].includes(next) || next === language) return;
  language = next;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {}
  applyTranslations();
  window.dispatchEvent(
    new CustomEvent("languagechange", { detail: { language } }),
  );
}
let controlsInitialized = false;
export function initLanguageControls() {
  if (!controlsInitialized && typeof document !== "undefined") {
    controlsInitialized = true;
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-language]");
      if (button) setLanguage(button.dataset.language);
    });
  }
  applyTranslations();
}
