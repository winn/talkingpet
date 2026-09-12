// The memory sheet: a small table of what the pets remember about their
// friend (key → value), opened from the Talk settings panel and from the
// account sheet. The owner can add a fact by hand, forget one, or forget all.
import {
  deleteAllMemories,
  deleteMemory,
  listMemories,
  saveMemory,
} from "./memories.js";
import { keyLabel, normalizeKey, normalizeValue } from "./memory-keys.js";
import { applyTranslations, getLanguage, localizeText, t } from "./i18n.js";

const $ = (selector) => document.querySelector(selector);
let memories = [];
let hooks = { notify: () => {} };
let bound = false;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function announce() {
  window.dispatchEvent(
    new CustomEvent("memorieschange", { detail: { memories: [...memories] } }),
  );
}

export function getMemories() {
  return [...memories];
}

/** A row saved elsewhere (live capture during a talk) joins the table. */
export function noteMemorySaved(row) {
  if (!row?.id) return;
  memories = [row, ...memories.filter((memory) => memory.key !== row.key)];
  renderMemoryTable();
}

export function renderMemoryTable() {
  const body = $("#memoryRows");
  const empty = $("#memoryEmpty");
  const forgetAll = $("#forgetAllBtn");
  if (!body) return;
  const language = getLanguage();
  empty.hidden = memories.length > 0;
  forgetAll.hidden = memories.length === 0;
  body.innerHTML = memories
    .map(
      (
        memory,
      ) => `<tr class="memory-row" data-memory-id="${escapeHtml(memory.id)}">
        <th scope="row">${escapeHtml(keyLabel(memory.key, language))}</th>
        <td>${escapeHtml(memory.value)}${
          memory.pet_name
            ? `<small>${escapeHtml(t("from {name}", { name: memory.pet_name }))}</small>`
            : ""
        }</td>
        <td class="memory-actions"><button type="button" class="text-button memory-forget" data-forget="${escapeHtml(
          memory.id,
        )}" aria-label="${escapeHtml(t("Forget this memory"))}">${escapeHtml(
          t("Forget"),
        )}</button></td>
      </tr>`,
    )
    .join("");
}

export async function refreshMemories() {
  try {
    memories = await listMemories();
  } catch {
    memories = [];
  }
  renderMemoryTable();
  return getMemories();
}

export function openMemorySheet({ petName = "" } = {}) {
  const modal = $("#memoryModal");
  if (!modal) return;
  const title = $("#memoryTitle");
  if (petName) localizeText(title, "What {name} remembers", { name: petName });
  else localizeText(title, "What your pets remember");
  $("#memoryKey").value = "";
  $("#memoryValue").value = "";
  modal.classList.remove("hidden");
  modal.classList.add("grid");
  refreshMemories();
}

export function closeMemorySheet() {
  const modal = $("#memoryModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("grid");
}

async function forgetOne(id) {
  const button = $(`[data-forget="${CSS.escape(id)}"]`);
  if (button) button.disabled = true;
  try {
    await deleteMemory(id);
    memories = memories.filter((memory) => memory.id !== id);
    renderMemoryTable();
    announce();
  } catch (err) {
    if (button) button.disabled = false;
    hooks.notify("Could not forget that. Please try again.");
    console.error("[TalkingMomo] forget memory failed:", err);
  }
}

async function forgetAll() {
  const button = $("#forgetAllBtn");
  button.disabled = true;
  try {
    await deleteAllMemories();
    memories = [];
    renderMemoryTable();
    announce();
  } catch (err) {
    hooks.notify("Could not forget that. Please try again.");
    console.error("[TalkingMomo] forget all memories failed:", err);
  } finally {
    button.disabled = false;
  }
}

async function addManual(event) {
  event.preventDefault();
  const keyInput = $("#memoryKey");
  const valueInput = $("#memoryValue");
  const key = normalizeKey(keyInput.value);
  const value = normalizeValue(valueInput.value);
  if (!key) return keyInput.focus();
  if (!value) return valueInput.focus();
  const submit = $("#memoryAddBtn");
  submit.disabled = true;
  try {
    const saved = await saveMemory({ key, value });
    memories = [
      saved,
      ...memories.filter((memory) => memory.key !== saved.key),
    ];
    renderMemoryTable();
    announce();
    keyInput.value = "";
    valueInput.value = "";
    keyInput.focus();
  } catch (err) {
    hooks.notify("Could not save that. Please try again.");
    console.error("[TalkingMomo] add memory failed:", err);
  } finally {
    submit.disabled = false;
  }
}

export function initMemoryPanel(options = {}) {
  hooks = { ...hooks, ...options };
  if (bound || !$("#memoryModal")) return;
  bound = true;
  $("#memoryRows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-forget]");
    if (button) forgetOne(button.dataset.forget);
  });
  $("#forgetAllBtn").addEventListener("click", forgetAll);
  $("#memoryAddForm").addEventListener("submit", addManual);
  $("#closeMemoryBtn").addEventListener("click", closeMemorySheet);
  $("#memoryModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeMemorySheet();
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !$("#memoryModal").classList.contains("hidden")
    )
      closeMemorySheet();
  });
  window.addEventListener("languagechange", () => {
    renderMemoryTable();
    applyTranslations($("#memoryModal"));
  });
}
