// Per-pet choice of which MCP servers to use, and when to call each one.
import { listMcpServers } from "./botnoi-client.js";
import { openAccountSheet } from "./account.js";
import { savePet } from "./pet-db.js";
import { t } from "./i18n.js";

function $(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setMessage(message) {
  const box = $("#petMcpMessage");
  if (!box) return;
  box.hidden = !message;
  box.textContent = message ?? "";
}

let onSaved = null;
let currentPet = null;
let bound = false;

function bind() {
  if (bound) return;
  bound = true;
  $("#petMcpCancel")?.addEventListener("click", close);
  $("#petMcpModal")?.addEventListener("click", (event) => {
    if (event.target === $("#petMcpModal")) close();
  });
  $("#petMcpList")?.addEventListener("change", (event) => {
    const box = event.target.closest('input[type="checkbox"]');
    if (!box) return;
    const when = box.closest(".pet-mcp-item")?.querySelector(".pet-mcp-when");
    if (when) when.disabled = !box.checked;
  });
  $("#petMcpSave")?.addEventListener("click", save);
}

function close() {
  $("#petMcpModal")?.classList.add("hidden");
  currentPet = null;
  onSaved = null;
}

export async function openPetMcp(pet, hooks = {}) {
  bind();
  currentPet = pet;
  onSaved = hooks.onSaved || null;
  const name = $("#petMcpName");
  if (name) name.textContent = pet?.name || "";
  setMessage(null);
  const list = $("#petMcpList");
  const modal = $("#petMcpModal");
  if (!list || !modal) return;
  list.innerHTML = `<p class="packs-hint">${escapeHtml(t("Loading…"))}</p>`;
  modal.classList.remove("hidden");
  let servers = [];
  try {
    servers = await listMcpServers();
  } catch (err) {
    list.innerHTML = `<p class="packs-hint">${escapeHtml(err instanceof Error ? err.message : t("Could not load MCP servers."))}</p>`;
    return;
  }
  if (!servers.length) {
    list.innerHTML = `<p class="packs-hint">${escapeHtml(t("No MCP servers yet. Add one in your account first."))}</p><button type="button" class="secondary" id="petMcpAdd">${escapeHtml(t("MCP tools"))}</button>`;
    $("#petMcpAdd")?.addEventListener("click", () => {
      close();
      openAccountSheet("mcp");
    });
    return;
  }
  const chosen = new Map(
    (Array.isArray(pet?.mcpLinks) ? pet.mcpLinks : []).map((link) => [
      link.serverId,
      link.when || "",
    ]),
  );
  list.innerHTML = servers
    .map((server) => {
      const when = chosen.get(server.id) || "";
      const checked = chosen.has(server.id);
      return `
      <label class="pet-mcp-item">
        <span class="pet-mcp-check">
          <input type="checkbox" data-id="${escapeHtml(server.id)}" ${checked ? "checked" : ""} />
          <span>
            <strong>${escapeHtml(server.name)}</strong>
            <small>${escapeHtml(server.description || t("No description yet."))}${
              server.parameter_hint ? ` · ${escapeHtml(server.parameter_hint)}` : ""
            }</small>
          </span>
        </span>
        <input
          class="pet-mcp-when"
          type="text"
          maxlength="300"
          data-id="${escapeHtml(server.id)}"
          placeholder="${escapeHtml(t("When should this pet call it?"))}"
          value="${escapeHtml(when)}"
          ${checked ? "" : "disabled"}
        />
      </label>`;
    })
    .join("");
}

async function save() {
  if (!currentPet) return;
  const items = [...document.querySelectorAll("#petMcpList .pet-mcp-item")];
  const mcpLinks = [];
  for (const item of items) {
    const box = item.querySelector('input[type="checkbox"]');
    if (!box?.checked) continue;
    const when = item.querySelector(".pet-mcp-when")?.value.trim() || "";
    const name = item.querySelector("strong")?.textContent || "this tool";
    if (!when) {
      setMessage(t("Say when {name} should call this tool.", { name }));
      item.querySelector(".pet-mcp-when")?.focus();
      return;
    }
    mcpLinks.push({ serverId: box.dataset.id, when });
  }
  const button = $("#petMcpSave");
  if (button) button.disabled = true;
  try {
    const saved = await savePet({ ...currentPet, mcpLinks });
    onSaved?.(saved);
    close();
  } catch (err) {
    setMessage(err instanceof Error ? err.message : t("Could not save."));
  } finally {
    if (button) button.disabled = false;
  }
}
