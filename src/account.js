import { openMemorySheet } from "./memory-panel.js";
import {
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  updateMcpServer,
} from "./botnoi-client.js";
import {
  AI_PROVIDERS,
  TALK_COST,
  adminCreateCoupons,
  adminDeleteAudio,
  adminGenerateMusic,
  adminGenerateSfx,
  adminKeyStatus,
  adminListAudio,
  adminPlanAudio,
  adminRemoveKey,
  adminSaveKey,
  adminTestKey,
  adminUpdateAudio,
  audioUrl,
  adminDeletePack,
  adminGrantPoints,
  adminListCoupons,
  adminListUsers,
  adminSavePack,
  adminSetAdmin,
  adminUpdateCoupon,
  fetchBillingStatus,
  fetchProfile,
  getSession,
  getSupabase,
  listPacks,
  money,
  normalizeCouponCode,
  onAuthChange,
  redeemCoupon,
  registerWithPassword,
  signInWithGoogle,
  signInWithPassword,
  signOut,
  spendPoints,
  startCheckout,
} from "./auth.js";
import { localizeText, t } from "./i18n.js";

/**
 * Sign-in screen, account sheet (points + packs), and the admin screen.
 * main.js owns the pet flows; this module only tells it when the signed-in
 * user changes.
 */

const $ = (selector) => document.querySelector(selector);

let profile = null;
let currentUserId = null;
let billing = { configured: false };
let hooks = {
  onSignedIn: () => {},
  onSignedOut: () => {},
  onAdminClosed: () => {},
  beforeSignOut: async () => {},
  notify: () => {},
};
let loginMode = "signin";
let adminTab = "users";
let adminUsers = [];
let adminPacks = [];
let adminCoupons = [];
let editingPackId = null;

const ADMIN_PATH = "/admin";

function wantsAdminRoute() {
  return window.location.pathname.replace(/\/+$/, "") === ADMIN_PATH;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function show(el) {
  el.classList.remove("hidden");
}
function hide(el) {
  el.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getProfile() {
  return profile;
}

export function isSignedIn() {
  return !!currentUserId;
}

export function showLogin() {
  const screen = $("#loginScreen");
  show(screen);
  screen.style.display = "grid";
}

export function hideLogin() {
  const screen = $("#loginScreen");
  hide(screen);
  screen.style.display = "none";
}

export async function refreshProfile() {
  try {
    profile = await fetchProfile();
  } catch {
    profile = profile ?? null;
  }
  renderPointsBadge();
  renderAccountSheet();
  return profile;
}

/**
 * Spend the points a chat costs. Opens the account sheet with a nudge when the
 * balance is too low. Resolves true when the chat may start.
 */
export async function spendForTalk() {
  if (!currentUserId) {
    showLogin();
    return false;
  }
  try {
    const result = await spendPoints(TALK_COST, "talk");
    if (profile) profile.points = result.points;
    renderPointsBadge();
    renderAccountSheet();
    if (result.ok) return true;
    openAccountSheet("low");
    return false;
  } catch (err) {
    hooks.notify("Could not check your points. Please try again.");
    console.error("[TalkingMomo] spend_points failed:", err);
    return false;
  }
}

export function openAccountSheet(notice = null) {
  const modal = $("#accountModal");
  const box = $("#accountNotice");
  if (notice === "low") {
    localizeText(box, "You need {n} point to talk to a pet. Get more points below.", {
      n: TALK_COST,
    });
    box.hidden = false;
  } else if (notice === "mcp") {
    localizeText(
      box,
      "Add an MCP server here. It will be attached the next time you talk to a pet.",
    );
    box.hidden = false;
  } else if (typeof notice === "string" && notice) {
    box.textContent = notice;
    box.hidden = false;
  } else {
    box.hidden = true;
    box.textContent = "";
  }
  renderAccountSheet();
  show(modal);
  modal.classList.add("grid");
  loadPacks();
  loadMcpServers();
  if (notice === "mcp") {
    requestAnimationFrame(() => {
      $("#mcpSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
      $("#mcpName")?.focus({ preventScroll: true });
    });
  }
}

export function closeAccountSheet() {
  const modal = $("#accountModal");
  hide(modal);
  modal.classList.remove("grid");
}

export async function initAccount(options = {}) {
  hooks = { ...hooks, ...options };
  bindLoginScreen();
  bindAccountSheet();
  bindAdminScreen();
  bindCouponForm();
  bindMcpForm();
  window.addEventListener("popstate", () => {
    if (wantsAdminRoute()) openAdmin();
    else if (!$("#adminScreen").classList.contains("hidden")) {
      closeAdmin({ keepUrl: true });
      hooks.onAdminClosed();
    }
  });
  fetchBillingStatus().then((status) => {
    billing = status || { configured: false };
    renderPackList();
  });

  const session = await getSession().catch(() => null);
  await applySession(session, { initial: true });

  onAuthChange(async (event, nextSession) => {
    if (event === "INITIAL_SESSION") return;
    if (event === "SIGNED_OUT") {
      await applySession(null);
      return;
    }
    if (nextSession) await applySession(nextSession);
  });

  handleCheckoutReturn();
}

async function applySession(session, { initial = false } = {}) {
  const nextId = session?.user?.id ?? null;
  if (nextId === currentUserId) {
    if (nextId && !initial) await refreshProfile();
    return;
  }
  currentUserId = nextId;
  if (!nextId) {
    profile = null;
    renderPointsBadge();
    closeAccountSheet();
    closeAdmin();
    showLogin();
    if (!initial) hooks.onSignedOut();
    return;
  }
  hideLogin();
  await refreshProfile();
  if (!initial) hooks.onSignedIn();
  if (wantsAdminRoute()) {
    if (profile?.isAdmin) openAdmin();
    else {
      window.history.replaceState(null, "", "/");
      hooks.notify("Admins only.");
    }
  }
}

// ---------------------------------------------------------------------------
// Sign-in screen
// ---------------------------------------------------------------------------

function setLoginMode(mode) {
  loginMode = mode;
  const register = mode === "register";
  localizeText($("#loginSubmitBtn span"), register ? "Create account" : "Sign in");
  localizeText($("#loginSwitchText"), register ? "Already have an account?" : "New here?");
  localizeText($("#loginModeBtn span"), register ? "Sign in" : "Create an account");
  localizeText($("#loginTitle span"), register ? "Make an account" : "Sign in to meet your pets");
  $("#loginPassword").autocomplete = register ? "new-password" : "current-password";
  $("#loginPassword").placeholder = register ? t("At least 8 characters") : "••••••••";
  setLoginError(null);
}

function setLoginError(message) {
  const box = $("#loginError");
  if (!message) {
    box.hidden = true;
    box.textContent = "";
    return;
  }
  box.hidden = false;
  box.textContent = message;
}

function setLoginBusy(busy) {
  $("#loginSubmitBtn").disabled = busy;
  $("#googleSignInBtn").disabled = busy;
  $("#loginModeBtn").disabled = busy;
}

function bindLoginScreen() {
  setLoginMode("signin");
  $("#loginModeBtn").addEventListener("click", () => {
    setLoginMode(loginMode === "signin" ? "register" : "signin");
    $("#loginEmail").focus();
  });

  $("#googleSignInBtn").addEventListener("click", async () => {
    setLoginError(null);
    setLoginBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : t("Google sign-in did not finish."));
      setLoginBusy(false);
    }
  });

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setLoginError(null);
    const email = $("#loginEmail").value.trim();
    const password = $("#loginPassword").value;
    if (!email || !password) return;
    setLoginBusy(true);
    try {
      if (loginMode === "register") {
        const { signedIn } = await registerWithPassword(email, password);
        if (!signedIn) {
          setLoginMode("signin");
          setLoginError(t("Check your email to confirm your account, then sign in."));
        }
      } else {
        await signInWithPassword(email, password);
      }
      $("#loginPassword").value = "";
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : t("Could not sign in."));
    } finally {
      setLoginBusy(false);
    }
  });
}

// ---------------------------------------------------------------------------
// Points badge + account sheet
// ---------------------------------------------------------------------------

function renderPointsBadge() {
  const value = $("#pointsValue");
  const initial = $("#accountInitial");
  const nav = $("#accountNav");
  if (!profile) {
    nav.hidden = true;
    return;
  }
  nav.hidden = false;
  value.textContent = profile.points.toLocaleString("en-US");
  initial.textContent = (profile.email.trim()[0] ?? "?").toUpperCase();
  $("#pointsBadge").classList.toggle("is-low", profile.points < TALK_COST);
}

function renderAccountSheet() {
  if (!profile) return;
  $("#accountEmail").textContent = profile.email;
  $("#accountAvatar").textContent = (profile.email.trim()[0] ?? "?").toUpperCase();
  $("#accountPoints").textContent = profile.points.toLocaleString("en-US");
  $("#openAdminBtn").hidden = !profile.isAdmin;
}

let packsCache = null;

async function loadPacks() {
  try {
    packsCache = (await listPacks()).filter((pack) => pack.active !== false);
  } catch {
    packsCache = [];
  }
  renderPackList();
}

function renderPackList() {
  const list = $("#packList");
  const hint = $("#packsHint");
  if (!list) return;
  const packs = packsCache ?? [];
  hint.hidden = billing.configured || packs.length === 0;
  if (packs.length === 0) {
    list.innerHTML = `<p class="packs-empty">${escapeHtml(t("No point packs yet."))}</p>`;
    return;
  }
  list.innerHTML = packs
    .map(
      (pack) => `<div class="pack-row" data-pack="${escapeHtml(pack.id)}">
        <div class="pack-info">
          <strong>${escapeHtml(pack.label)}${
            pack.badge ? `<span class="pack-badge">${escapeHtml(pack.badge)}</span>` : ""
          }</strong>
          <span>${escapeHtml(t("{n} points", { n: pack.points.toLocaleString("en-US") }))}</span>
        </div>
        <button type="button" class="primary buy-btn" ${billing.configured ? "" : "disabled"}>
          ${escapeHtml(billing.configured ? money(pack.price_cents, pack.currency) : t("Soon"))}
        </button>
      </div>`,
    )
    .join("");
}

function bindAccountSheet() {
  $("#pointsBadge").addEventListener("click", () => openAccountSheet());
  $("#accountBtn").addEventListener("click", () => openAccountSheet());
  $("#closeAccountBtn").addEventListener("click", closeAccountSheet);
  $("#accountMemoryBtn").addEventListener("click", () => openMemorySheet());
  $("#accountModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeAccountSheet();
  });
  $("#signOutBtn").addEventListener("click", async () => {
    $("#signOutBtn").disabled = true;
    try {
      // Flush chat → memory while the session token is still valid.
      try {
        await hooks.beforeSignOut();
      } catch (err) {
        console.warn("[TalkingMomo] beforeSignOut failed:", err);
      }
      await signOut();
    } finally {
      $("#signOutBtn").disabled = false;
    }
  });
  $("#openAdminBtn").addEventListener("click", () => {
    closeAccountSheet();
    openAdmin();
  });
  $("#packList").addEventListener("click", async (event) => {
    const button = event.target.closest(".buy-btn");
    if (!button) return;
    const packId = button.closest(".pack-row")?.dataset.pack;
    if (!packId) return;
    button.disabled = true;
    button.textContent = "…";
    try {
      window.location.href = await startCheckout(packId);
    } catch (err) {
      hooks.notify(err instanceof Error ? err.message : "Could not start checkout.");
      renderPackList();
    }
  });
}

/** After Stripe sends the browser back: confirm the purchase landed. */
function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const state = params.get("checkout");
  if (!state) return;
  const sessionId = params.get("session_id");
  params.delete("checkout");
  params.delete("session_id");
  const clean = `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", clean);

  if (state !== "success") {
    hooks.notify("Checkout was cancelled. Your points are unchanged.");
    return;
  }
  hooks.notify("Thanks! Adding your points…");
  waitForPurchase(sessionId);
}

async function waitForPurchase(sessionId, attempt = 0) {
  if (!currentUserId) {
    if (attempt < 20) setTimeout(() => waitForPurchase(sessionId, attempt + 1), 1000);
    return;
  }
  let credited = null;
  if (sessionId) {
    const { data } = await getSupabase()
      .from("point_ledger")
      .select("delta")
      .eq("ref", `stripe:${sessionId}`)
      .maybeSingle();
    credited = data?.delta ?? null;
  }
  if (credited !== null) {
    await refreshProfile();
    hooks.notify("{n} points added to your account!", { n: credited });
    return;
  }
  if (attempt < 10) {
    setTimeout(() => waitForPurchase(sessionId, attempt + 1), 1500);
    return;
  }
  await refreshProfile();
  hooks.notify("Payment received. Your points will appear in a moment.");
}

// ---------------------------------------------------------------------------
// Admin screen
// ---------------------------------------------------------------------------

export function openAdmin() {
  if (!profile?.isAdmin) return;
  const screen = $("#adminScreen");
  if (!wantsAdminRoute()) window.history.pushState(null, "", ADMIN_PATH);
  show(screen);
  screen.style.display = "flex";
  selectAdminTab(adminTab);
  loadAdminUsers();
  loadAdminPacks();
  loadAdminCoupons();
}

export function closeAdmin({ keepUrl = false } = {}) {
  const screen = $("#adminScreen");
  hide(screen);
  screen.style.display = "none";
  if (!keepUrl && wantsAdminRoute()) window.history.replaceState(null, "", "/");
}

function selectAdminTab(tab) {
  adminTab = tab;
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.adminTab === tab));
  });
  $("#adminUsersPanel").hidden = tab !== "users";
  $("#adminPacksPanel").hidden = tab !== "packs";
  $("#adminCouponsPanel").hidden = tab !== "coupons";
  $("#adminKeysPanel").hidden = tab !== "keys";
  $("#adminVoicePanel").hidden = tab !== "voice";
  $("#adminMusicPanel").hidden = tab !== "music";
  $("#adminSfxPanel").hidden = tab !== "sfx";
  if (tab === "keys") loadKeyCards();
  if (tab === "voice") loadAdminVoice();
  if (tab === "music" || tab === "sfx") loadAudio(tab);
}

function setAdminMessage(kind, message) {
  const error = $("#adminError");
  const note = $("#adminNote");
  error.hidden = kind !== "error" || !message;
  note.hidden = kind !== "note" || !message;
  if (kind === "error") error.textContent = message ?? "";
  if (kind === "note") note.textContent = message ?? "";
}

async function loadAdminUsers() {
  setAdminMessage("error", null);
  try {
    adminUsers = await adminListUsers();
  } catch (err) {
    adminUsers = [];
    setAdminMessage("error", err instanceof Error ? err.message : "Could not load users.");
  }
  renderAdminUsers();
}

function renderAdminUsers() {
  const list = $("#adminUserList");
  const query = $("#adminUserSearch").value.trim().toLowerCase();
  const rows = adminUsers.filter((user) => !query || (user.email ?? "").toLowerCase().includes(query));
  $("#adminUserCount").textContent = `${rows.length} / ${adminUsers.length}`;
  if (rows.length === 0) {
    list.innerHTML = `<p class="admin-empty">No users yet.</p>`;
    return;
  }
  list.innerHTML = rows
    .map((user) => {
      const created = new Date(user.created_at).toLocaleString();
      const self = user.user_id === currentUserId;
      return `<div class="admin-row" data-user="${escapeHtml(user.user_id)}">
        <div class="admin-row-main">
          <p class="admin-row-title">${escapeHtml(user.email || "No email")}${
            user.is_admin ? `<span class="admin-chip">admin</span>` : ""
          }${self ? `<span class="admin-chip is-you">you</span>` : ""}</p>
          <p class="admin-row-meta">${escapeHtml(created)} · ${user.pet_count} pets · bought ${user.purchased_points} · granted ${user.granted_points} · coupons ${user.coupon_points ?? 0}</p>
        </div>
        <div class="admin-row-points"><strong>${Number(user.points).toLocaleString("en-US")}</strong><span>points</span></div>
        <form class="grant-form">
          <input type="number" name="delta" step="1" placeholder="+10" aria-label="Points to add or remove for ${escapeHtml(user.email || "user")}" required />
          <input type="text" name="note" maxlength="120" placeholder="Note (optional)" aria-label="Note" />
          <button type="submit" class="primary">Give</button>
          <button type="button" class="secondary toggle-admin" ${self ? "disabled" : ""}>${user.is_admin ? "Remove admin" : "Make admin"}</button>
        </form>
      </div>`;
    })
    .join("");
}

async function loadAdminPacks() {
  try {
    adminPacks = await listPacks();
  } catch (err) {
    adminPacks = [];
    setAdminMessage("error", err instanceof Error ? err.message : "Could not load packs.");
  }
  renderAdminPacks();
}

function renderAdminPacks() {
  const list = $("#adminPackList");
  if (adminPacks.length === 0) {
    list.innerHTML = `<p class="admin-empty">No point packs yet. Add one above.</p>`;
    return;
  }
  list.innerHTML = adminPacks
    .map(
      (pack) => `<div class="admin-row" data-pack="${escapeHtml(pack.id)}">
        <div class="admin-row-main">
          <p class="admin-row-title">${escapeHtml(pack.label)}${
            pack.badge ? `<span class="admin-chip">${escapeHtml(pack.badge)}</span>` : ""
          }${pack.active === false ? `<span class="admin-chip is-off">hidden</span>` : ""}</p>
          <p class="admin-row-meta">${pack.points.toLocaleString("en-US")} points · ${escapeHtml(
            money(pack.price_cents, pack.currency),
          )} · sort ${pack.sort} · <code>${escapeHtml(pack.id)}</code></p>
        </div>
        <div class="admin-row-actions">
          <button type="button" class="secondary edit-pack">Edit</button>
          <button type="button" class="secondary toggle-pack">${pack.active === false ? "Show" : "Hide"}</button>
          <button type="button" class="secondary delete-pack">Delete</button>
        </div>
      </div>`,
    )
    .join("");
}

function fillPackForm(pack) {
  const form = $("#packForm");
  editingPackId = pack?.id ?? null;
  form.elements.label.value = pack?.label ?? "";
  form.elements.points.value = pack?.points ?? "";
  form.elements.price.value = pack ? (pack.price_cents / 100).toString() : "";
  form.elements.currency.value = pack?.currency ?? "usd";
  form.elements.badge.value = pack?.badge ?? "";
  form.elements.sort.value = pack?.sort ?? 99;
  form.elements.active.checked = pack ? pack.active !== false : true;
  $("#packFormTitle").textContent = pack ? `Edit ${pack.label}` : "New point pack";
  $("#packCancelBtn").hidden = !pack;
}

function slugId(label) {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return `pack_${base || "points"}_${Math.random().toString(36).slice(2, 6)}`;
}

function bindAdminScreen() {
  $("#adminBackBtn").addEventListener("click", () => {
    closeAdmin();
    hooks.onAdminClosed();
  });
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => selectAdminTab(button.dataset.adminTab));
  });
  $("#adminUserSearch").addEventListener("input", renderAdminUsers);
  $("#adminRefreshBtn").addEventListener("click", () => {
    loadAdminUsers();
    loadAdminPacks();
    loadAdminCoupons();
  });
  bindAdminCoupons();
  bindAdminKeys();
  bindAdminVoice();
  bindAdminAudio("music");
  bindAdminAudio("sfx");

  $("#adminUserList").addEventListener("submit", async (event) => {
    const form = event.target.closest(".grant-form");
    if (!form) return;
    event.preventDefault();
    const row = form.closest(".admin-row");
    const userId = row?.dataset.user;
    const delta = Number.parseInt(form.elements.delta.value, 10);
    const note = form.elements.note.value.trim();
    if (!userId || !Number.isInteger(delta) || delta === 0) {
      setAdminMessage("error", "Enter a whole number of points (use a minus sign to take points back).");
      return;
    }
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const balance = await adminGrantPoints(userId, delta, note);
      const user = adminUsers.find((u) => u.user_id === userId);
      setAdminMessage(
        "note",
        `${delta > 0 ? "Gave" : "Took"} ${Math.abs(delta)} points ${delta > 0 ? "to" : "from"} ${user?.email || "user"}. Balance: ${balance}.`,
      );
      if (userId === currentUserId) await refreshProfile();
      await loadAdminUsers();
    } catch (err) {
      setAdminMessage("error", err instanceof Error ? err.message : "Could not update points.");
      button.disabled = false;
    }
  });

  $("#adminUserList").addEventListener("click", async (event) => {
    const button = event.target.closest(".toggle-admin");
    if (!button) return;
    const row = button.closest(".admin-row");
    const userId = row?.dataset.user;
    const user = adminUsers.find((u) => u.user_id === userId);
    if (!user) return;
    const next = !user.is_admin;
    if (!confirm(`${next ? "Make" : "Remove"} ${user.email || "this user"} ${next ? "an admin" : "from admins"}?`)) return;
    button.disabled = true;
    try {
      await adminSetAdmin(userId, next);
      setAdminMessage("note", `${user.email || "User"} is ${next ? "now an admin" : "no longer an admin"}.`);
      await loadAdminUsers();
    } catch (err) {
      setAdminMessage("error", err instanceof Error ? err.message : "Could not update admin.");
      button.disabled = false;
    }
  });

  fillPackForm(null);
  $("#packCancelBtn").addEventListener("click", () => fillPackForm(null));
  $("#packForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const label = form.elements.label.value.trim();
    const points = Number.parseInt(form.elements.points.value, 10);
    const price = Number(form.elements.price.value);
    const sort = Number.parseInt(form.elements.sort.value, 10);
    if (!label) return setAdminMessage("error", "Label is required.");
    if (!Number.isInteger(points) || points <= 0) return setAdminMessage("error", "Points must be a positive whole number.");
    if (!Number.isFinite(price) || price <= 0) return setAdminMessage("error", "Price must be greater than zero.");
    const pack = {
      id: editingPackId ?? slugId(label),
      label: label.slice(0, 60),
      points,
      price_cents: Math.round(price * 100),
      currency: (form.elements.currency.value || "usd").trim().toLowerCase().slice(0, 3),
      badge: form.elements.badge.value.trim().slice(0, 24) || null,
      sort: Number.isInteger(sort) ? sort : 99,
      active: form.elements.active.checked,
    };
    form.querySelector("button[type=submit]").disabled = true;
    try {
      await adminSavePack(pack);
      setAdminMessage("note", `${editingPackId ? "Updated" : "Created"} ${pack.label}.`);
      fillPackForm(null);
      packsCache = null;
      await loadAdminPacks();
    } catch (err) {
      setAdminMessage("error", err instanceof Error ? err.message : "Could not save the pack.");
    } finally {
      form.querySelector("button[type=submit]").disabled = false;
    }
  });

  $("#adminPackList").addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const id = button.closest(".admin-row")?.dataset.pack;
    const pack = adminPacks.find((p) => p.id === id);
    if (!pack) return;
    try {
      if (button.classList.contains("edit-pack")) {
        fillPackForm(pack);
        $("#packForm").scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (button.classList.contains("toggle-pack")) {
        await adminSavePack({ ...pack, active: pack.active === false });
      } else if (button.classList.contains("delete-pack")) {
        if (!confirm(`Delete “${pack.label}” permanently?`)) return;
        await adminDeletePack(pack.id);
      }
      packsCache = null;
      await loadAdminPacks();
    } catch (err) {
      setAdminMessage("error", err instanceof Error ? err.message : "Could not update the pack.");
    }
  });
}

// ---------------------------------------------------------------------------
// Coupons: redeem (account sheet) and manage (admin)
// ---------------------------------------------------------------------------

function setCouponMessage(message, success = false) {
  const box = $("#couponMessage");
  box.hidden = !message;
  box.textContent = message ?? "";
  box.classList.toggle("is-success", success);
}

function bindCouponForm() {
  const input = $("#couponCode");
  input.addEventListener("input", () => {
    input.value = input.value.toUpperCase();
    setCouponMessage(null);
  });
  $("#couponForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = normalizeCouponCode(input.value);
    if (!code) {
      setCouponMessage(t("That coupon code is not valid."));
      return;
    }
    const button = $("#couponRedeemBtn");
    button.disabled = true;
    localizeText(button.querySelector("span"), "Redeeming…");
    try {
      const result = await redeemCoupon(code);
      if (profile) profile.points = result.balance;
      renderPointsBadge();
      renderAccountSheet();
      input.value = "";
      setCouponMessage(t("{n} points added!", { n: result.points }), true);
      hooks.notify("{n} points added!", { n: result.points });
      refreshProfile();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setCouponMessage(t(message || "That coupon code is not valid."));
    } finally {
      button.disabled = false;
      localizeText(button.querySelector("span"), "Redeem");
    }
  });
}

let mcpCache = [];

const MCP_PARAM_TYPES = [
  ["string", "Text"],
  ["number", "Number"],
  ["integer", "Integer"],
  ["boolean", "Yes / No"],
];

function paramTypeOptions(selected) {
  return MCP_PARAM_TYPES.map(
    ([value, label]) =>
      `<option value="${value}"${value === selected ? " selected" : ""}>${escapeHtml(t(label))}</option>`,
  ).join("");
}

function rowsFromSchema(schema) {
  const props = schema?.properties;
  if (!props || typeof props !== "object") return [];
  const required = new Set(schema.required || []);
  return Object.entries(props).map(([name, spec]) => ({
    name,
    type: MCP_PARAM_TYPES.some(([value]) => value === spec?.type) ? spec.type : "string",
    required: required.has(name),
    description: typeof spec?.description === "string" ? spec.description : "",
  }));
}

function schemaIsFormFriendly(schema) {
  const props = schema?.properties;
  if (!props || typeof props !== "object") return true;
  return Object.values(props).every((spec) => {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) return false;
    const keys = Object.keys(spec).filter((key) => spec[key] != null && spec[key] !== "");
    return (
      MCP_PARAM_TYPES.some(([value]) => value === spec.type) &&
      keys.every((key) => key === "type" || key === "description")
    );
  });
}

function schemaFromRows(rows) {
  const properties = {};
  const required = [];
  for (const row of rows) {
    const spec = { type: row.type || "string" };
    if (row.description) spec.description = row.description;
    properties[row.name] = spec;
    if (row.required) required.push(row.name);
  }
  return { type: "object", properties, required };
}

function readParamRows() {
  return [...document.querySelectorAll("#mcpParamRows .mcp-param-row")].map((row) => ({
    name: row.querySelector(".mcp-param-name")?.value || "",
    type: row.querySelector(".mcp-param-type")?.value || "string",
    required: Boolean(row.querySelector(".mcp-param-required input")?.checked),
    description: row.dataset.description || "",
  }));
}

function renderParamRows(rows) {
  const list = $("#mcpParamRows");
  if (!list) return;
  const source = rows.length ? rows : [{ name: "", type: "string", required: true, description: "" }];
  list.innerHTML = source
    .map(
      (row) => `
    <div class="mcp-param-row" data-description="${escapeHtml(row.description || "")}">
      <input class="mcp-param-name" type="text" maxlength="40" placeholder="${escapeHtml(t("Parameter name"))}" aria-label="${escapeHtml(t("Parameter name"))}" value="${escapeHtml(row.name || "")}" />
      <select class="mcp-param-type" aria-label="${escapeHtml(t("Type"))}">${paramTypeOptions(row.type || "string")}</select>
      <button type="button" class="text-button mcp-param-remove" aria-label="${escapeHtml(t("Remove"))}">×</button>
      <label class="mcp-param-required"><input type="checkbox"${row.required ? " checked" : ""} /> ${escapeHtml(t("Required"))}</label>
    </div>`,
    )
    .join("");
}

function setParamMode(mode, schema) {
  const useJson = mode === "json";
  const formBox = $("#mcpParamForm");
  const jsonBox = $("#mcpParameters");
  if (formBox) formBox.hidden = useJson;
  if (jsonBox) jsonBox.hidden = !useJson;
  document.querySelectorAll("[data-param-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.paramMode === mode));
  });
  if (!schema) return;
  if (useJson) {
    const empty = !schema.properties || !Object.keys(schema.properties).length;
    jsonBox.value = empty ? "" : JSON.stringify(schema, null, 2);
  } else {
    renderParamRows(rowsFromSchema(schema));
  }
}

function collectParameters() {
  const useJson = $("#mcpParamForm")?.hidden;
  if (useJson) {
    const text = $("#mcpParameters")?.value.trim() || "";
    if (!text) return { type: "object", properties: {}, required: [] };
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(t("Parameters must be JSON."));
    }
  }
  const rows = readParamRows();
  const filled = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) {
      if (rows.length === 1) continue;
      throw new Error(t("Each parameter needs a name."));
    }
    filled.push({ ...row, name });
  }
  if (new Set(filled.map((row) => row.name)).size !== filled.length)
    throw new Error(t("Parameter names must be different."));
  return schemaFromRows(filled);
}

function paramSummary(server) {
  const props = server.parameters?.properties;
  if (props && typeof props === "object" && Object.keys(props).length) {
    const required = new Set(server.parameters.required || []);
    return Object.entries(props)
      .map(([name, spec]) => `${name} (${spec?.type || "string"}${required.has(name) ? ", required" : ""})`)
      .join(", ");
  }
  return server.parameter_hint || "";
}

function setMcpMessage(message, success = false) {
  const box = $("#mcpMessage");
  if (!box) return;
  box.hidden = !message;
  box.textContent = message ?? "";
  box.classList.toggle("is-success", success);
}

async function loadMcpServers() {
  const list = $("#mcpList");
  if (!list) return;
  try {
    mcpCache = await listMcpServers();
    if (!mcpCache.length) {
      list.innerHTML = `<p class="packs-hint">${escapeHtml(t("No MCP servers yet."))}</p>`;
      return;
    }
    list.innerHTML = mcpCache
      .map(
        (server) => `
      <div class="mcp-row" data-id="${escapeHtml(server.id)}">
        <div>
          <strong>${escapeHtml(server.name)}</strong>
          <p class="admin-row-meta">${escapeHtml(server.description || t("No description yet."))}</p>
          <p class="admin-row-meta">${escapeHtml(paramSummary(server) || t("No parameters."))}</p>
        </div>
        <div class="mcp-row-actions">
          <button type="button" class="text-button mcp-edit" data-id="${escapeHtml(server.id)}">${escapeHtml(t("Edit"))}</button>
          <button type="button" class="text-button mcp-remove" data-id="${escapeHtml(server.id)}">${escapeHtml(t("Remove"))}</button>
        </div>
      </div>`,
      )
      .join("");
  } catch (err) {
    list.innerHTML = `<p class="packs-hint">${escapeHtml(err instanceof Error ? err.message : t("Could not load MCP servers."))}</p>`;
  }
}

function clearMcpForm() {
  const form = $("#mcpForm");
  if (!form) return;
  delete form.dataset.editId;
  $("#mcpName").value = "";
  $("#mcpUrl").value = "";
  $("#mcpAuthValue").value = "";
  $("#mcpDescription").value = "";
  setParamMode("form", { type: "object", properties: {}, required: [] });
  $("#mcpCancelEdit").hidden = true;
  localizeText($("#mcpAddBtn").querySelector("span"), "Add MCP");
}

function fillMcpForm(server) {
  const form = $("#mcpForm");
  form.dataset.editId = server.id;
  $("#mcpName").value = server.name || "";
  $("#mcpUrl").value = server.url || "";
  $("#mcpAuthValue").value = "";
  $("#mcpDescription").value = server.description || "";
  const schema =
    server.parameters && typeof server.parameters === "object"
      ? server.parameters
      : { type: "object", properties: {}, required: [] };
  setParamMode(schemaIsFormFriendly(schema) ? "form" : "json", schema);
  $("#mcpCancelEdit").hidden = false;
  localizeText($("#mcpAddBtn").querySelector("span"), "Save");
  $("#mcpSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  $("#mcpDescription")?.focus({ preventScroll: true });
}

function bindMcpForm() {
  const form = $("#mcpForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("#mcpName").value.trim();
    const url = $("#mcpUrl").value.trim();
    const authValue = $("#mcpAuthValue").value.trim();
    const description = $("#mcpDescription").value.trim();
    if (!name || !url) {
      setMcpMessage(t("Name and URL are required."));
      return;
    }
    if (!description) {
      setMcpMessage(t("A description is required so the pet knows what this tool does."));
      return;
    }
    let parameters;
    try {
      parameters = collectParameters();
    } catch (err) {
      setMcpMessage(err instanceof Error ? err.message : t("Parameters must be JSON."));
      return;
    }
    const editing = form.dataset.editId || "";
    const button = $("#mcpAddBtn");
    button.disabled = true;
    try {
      const input = {
        name,
        url,
        description,
        parameters,
        parameterHint: "",
        ...(authValue
          ? { authValue, authHeader: "Authorization" }
          : {}),
      };
      if (editing) {
        await updateMcpServer({ ...input, id: editing });
        setMcpMessage(t("MCP server updated."), true);
      } else {
        await createMcpServer(input);
        setMcpMessage(t("MCP server connected."), true);
      }
      clearMcpForm();
      await loadMcpServers();
    } catch (err) {
      setMcpMessage(err instanceof Error ? err.message : t("Could not add MCP server."));
    } finally {
      button.disabled = false;
    }
  });
  $("#mcpCancelEdit")?.addEventListener("click", () => {
    clearMcpForm();
    setMcpMessage(null);
  });
  $("#mcpAddParam")?.addEventListener("click", () => {
    renderParamRows([...readParamRows(), { name: "", type: "string", required: true, description: "" }]);
  });
  $("#mcpParamRows")?.addEventListener("click", (event) => {
    const button = event.target.closest(".mcp-param-remove");
    if (!button) return;
    const rows = readParamRows();
    const index = [...document.querySelectorAll("#mcpParamRows .mcp-param-row")].indexOf(
      button.closest(".mcp-param-row"),
    );
    if (index >= 0) rows.splice(index, 1);
    renderParamRows(rows);
  });
  document.querySelector(".mcp-param-mode")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-param-mode]");
    if (!button || button.getAttribute("aria-pressed") === "true") return;
    if (button.dataset.paramMode === "json") {
      try {
        setParamMode("json", collectParameters());
        setMcpMessage(null);
      } catch (err) {
        setMcpMessage(err instanceof Error ? err.message : t("Parameters must be JSON."));
      }
      return;
    }
    const text = $("#mcpParameters")?.value.trim() || "";
    let schema = { type: "object", properties: {}, required: [] };
    if (text) {
      try {
        schema = JSON.parse(text);
      } catch {
        setMcpMessage(t("Parameters must be JSON."));
        return;
      }
    }
    if (!schemaIsFormFriendly(schema)) {
      setMcpMessage(t("This JSON is too detailed for the form."));
      return;
    }
    setMcpMessage(null);
    setParamMode("form", schema);
  });
  renderParamRows([]);
  $("#mcpList")?.addEventListener("click", async (event) => {
    const edit = event.target.closest(".mcp-edit");
    if (edit) {
      const server = mcpCache.find((item) => item.id === edit.dataset.id);
      if (server) fillMcpForm(server);
      return;
    }
    const button = event.target.closest(".mcp-remove");
    if (!button) return;
    const id = button.dataset.id;
    if (!id) return;
    button.disabled = true;
    try {
      await deleteMcpServer(id);
      if ($("#mcpForm")?.dataset.editId === id) clearMcpForm();
      setMcpMessage(t("MCP server removed."), true);
      await loadMcpServers();
    } catch (err) {
      setMcpMessage(err instanceof Error ? err.message : t("Could not remove MCP server."));
      button.disabled = false;
    }
  });
}

async function loadAdminVoice() {
  const tools = $("#adminToolList");
  const agents = $("#adminAgentList");
  if (!tools || !agents) return;
  tools.textContent = "Loading…";
  agents.textContent = "Loading…";
  try {
    const session = await getSession();
    if (!session) throw new Error("Sign in first.");
    const headers = { Authorization: `Bearer ${session.access_token}` };
    const [toolRes, agentRes] = await Promise.all([
      fetch("/api/botnoi/tools", { headers }),
      fetch("/api/botnoi/agents", { headers }),
    ]);
    const toolData = await toolRes.json().catch(() => ({}));
    const agentData = await agentRes.json().catch(() => ({}));
    if (!toolRes.ok) throw new Error(toolData.error || "Could not load tools.");
    if (!agentRes.ok) throw new Error(agentData.error || "Could not load agents.");
    const toolRows = Array.isArray(toolData.tools) ? toolData.tools : [];
    const agentRows = Array.isArray(agentData.agents) ? agentData.agents : [];
    tools.innerHTML = toolRows.length
      ? toolRows
          .map(
            (tool) =>
              `<div class="admin-row"><strong>${escapeHtml(tool.name || tool.id || "tool")}</strong><p class="admin-row-meta">${escapeHtml(tool.tool_type || "")} · ${escapeHtml(tool.status || "")} · ${escapeHtml(tool.id || tool.tool_id || "")}</p></div>`,
          )
          .join("")
      : `<p class="admin-lead">No tools yet.</p>`;
    agents.innerHTML = agentRows.length
      ? agentRows
          .map(
            (agent) =>
              `<div class="admin-row"><strong>${escapeHtml(agent.bot_name || agent.name || agent.agent_id || "agent")}</strong><p class="admin-row-meta">${escapeHtml(agent.agent_id || agent.id || "")}</p></div>`,
          )
          .join("")
      : `<p class="admin-lead">No agents yet.</p>`;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load Voice API.";
    tools.innerHTML = `<p class="admin-lead">${escapeHtml(message)}</p>`;
    agents.innerHTML = "";
    setAdminMessage("error", message);
  }
}

function bindAdminVoice() {
  $("#adminRefreshVoiceBtn")?.addEventListener("click", () => loadAdminVoice());
}

async function loadAdminCoupons() {
  try {
    adminCoupons = await adminListCoupons();
  } catch (err) {
    adminCoupons = [];
    setAdminMessage("error", err instanceof Error ? err.message : "Could not load coupons.");
  }
  renderAdminCoupons();
}

function couponStatus(coupon) {
  if (coupon.active === false) return "disabled";
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return "expired";
  if (coupon.max_redemptions !== null && coupon.redemption_count >= coupon.max_redemptions) return "used up";
  return "";
}

function renderAdminCoupons() {
  const list = $("#adminCouponList");
  const query = $("#adminCouponSearch").value.trim().toLowerCase();
  const rows = adminCoupons.filter(
    (c) => !query || c.code.toLowerCase().includes(query) || (c.note ?? "").toLowerCase().includes(query),
  );
  $("#adminCouponCount").textContent = `${rows.length} / ${adminCoupons.length}`;
  if (rows.length === 0) {
    list.innerHTML = `<p class="admin-empty">No coupons yet. Create some above.</p>`;
    return;
  }
  list.innerHTML = rows
    .map((c) => {
      const status = couponStatus(c);
      const uses = `${c.redemption_count} / ${c.max_redemptions ?? "∞"}`;
      const expires = c.expires_at ? `claim by ${new Date(c.expires_at).toLocaleDateString()}` : "no expiry";
      return `<div class="admin-row" data-coupon="${escapeHtml(c.id)}">
        <div class="admin-row-main">
          <p class="admin-row-title"><span class="coupon-code">${escapeHtml(c.code)}</span>${
            status ? `<span class="admin-chip is-off">${status}</span>` : ""
          }</p>
          <p class="admin-row-meta">${c.points.toLocaleString("en-US")} points · used ${uses} · ${escapeHtml(expires)}${
            c.note ? ` · ${escapeHtml(c.note)}` : ""
          } · ${new Date(c.created_at).toLocaleDateString()}</p>
        </div>
        <div class="admin-row-actions">
          <button type="button" class="secondary copy-coupon">Copy</button>
          <button type="button" class="secondary toggle-coupon">${c.active === false ? "Enable" : "Disable"}</button>
        </div>
      </div>`;
    })
    .join("");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function bindAdminCoupons() {
  $("#adminCouponSearch").addEventListener("input", renderAdminCoupons);

  $("#couponCreateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const points = Number.parseInt(form.elements.points.value, 10);
    const quantity = Number.parseInt(form.elements.quantity.value || "1", 10);
    const maxRaw = form.elements.maxRedemptions.value.trim();
    const maxRedemptions = maxRaw === "" ? null : Number.parseInt(maxRaw, 10);
    const code = form.elements.code.value.trim();
    const note = form.elements.note.value.trim();
    const dateRaw = form.elements.expiresAt.value;
    if (!Number.isInteger(points) || points <= 0 || points > 100000) {
      return setAdminMessage("error", "Points per code must be between 1 and 100000.");
    }
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 500) {
      return setAdminMessage("error", "Create between 1 and 500 codes at a time.");
    }
    if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0)) {
      return setAdminMessage("error", "Uses per code must be a positive number, or blank for unlimited.");
    }
    if (code && quantity !== 1) {
      return setAdminMessage("error", "A custom code can only be created one at a time.");
    }
    if (code && !normalizeCouponCode(code)) {
      return setAdminMessage("error", "Custom codes use letters, numbers and hyphens.");
    }
    let expiresAt = null;
    if (dateRaw) {
      const end = new Date(`${dateRaw}T23:59:59`);
      if (Number.isNaN(end.getTime())) return setAdminMessage("error", "Claim-by date is invalid.");
      expiresAt = end.toISOString();
    }
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const { coupons } = await adminCreateCoupons({ points, quantity, code, maxRedemptions, expiresAt, note });
      const codes = coupons.map((c) => c.code);
      $("#couponBatchTitle").textContent = `${codes.length} new ${codes.length === 1 ? "code" : "codes"} · ${points} points each`;
      $("#couponBatchCodes").value = codes.join("\n");
      $("#couponBatchCodes").rows = Math.min(10, Math.max(2, codes.length));
      $("#couponBatch").hidden = false;
      setAdminMessage("note", `Created ${codes.length} coupon${codes.length === 1 ? "" : "s"}.`);
      form.elements.code.value = "";
      form.elements.note.value = "";
      await loadAdminCoupons();
    } catch (err) {
      setAdminMessage("error", err instanceof Error ? err.message : "Could not create coupons.");
    } finally {
      button.disabled = false;
    }
  });

  $("#couponBatchCopy").addEventListener("click", async () => {
    const ok = await copyText($("#couponBatchCodes").value);
    setAdminMessage(ok ? "note" : "error", ok ? "Codes copied." : "Could not copy. Select the codes and copy them by hand.");
  });

  $("#adminCouponList").addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const id = button.closest(".admin-row")?.dataset.coupon;
    const coupon = adminCoupons.find((c) => c.id === id);
    if (!coupon) return;
    if (button.classList.contains("copy-coupon")) {
      const ok = await copyText(coupon.code);
      setAdminMessage(ok ? "note" : "error", ok ? `Copied ${coupon.code}.` : "Could not copy.");
      return;
    }
    if (button.classList.contains("toggle-coupon")) {
      button.disabled = true;
      try {
        await adminUpdateCoupon(coupon.id, { active: coupon.active === false });
        await loadAdminCoupons();
      } catch (err) {
        setAdminMessage("error", err instanceof Error ? err.message : "Could not update the coupon.");
        button.disabled = false;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// AI keys
// ---------------------------------------------------------------------------

const PROVIDER_COPY = {
  elevenlabs: {
    name: "ElevenLabs",
    blurb: "Makes the background music and sound effects. The key needs Music and Sound Effects permissions.",
    placeholder: "sk_…",
    envVar: "ELEVENLABS_API_KEY",
  },
  gemini: {
    name: "Gemini",
    blurb: "Plans batches of tracks and sounds so you do not have to write every prompt.",
    placeholder: "AIza…",
    envVar: "GEMINI_API_KEY",
  },
};

let keyStatuses = {};

function renderKeyCards() {
  const list = $("#adminKeyCards");
  list.innerHTML = AI_PROVIDERS.map((provider) => {
    const copy = PROVIDER_COPY[provider];
    const status = keyStatuses[provider];
    let line = `<span>Loading…</span>`;
    if (status?.error) line = `<span class="is-missing">${escapeHtml(status.error)}</span>`;
    else if (status) {
      const source =
        status.source === "database"
          ? "Using the key saved here"
          : status.source === "environment"
            ? `Using the ${copy.envVar} environment variable`
            : "No key yet";
      line = `<strong class="${status.source === "none" ? "is-missing" : ""}">${source}</strong>${
        status.last4 ? `<span>ends in <code>…${escapeHtml(status.last4)}</code></span>` : ""
      }${status.updatedAt ? `<span>saved ${new Date(status.updatedAt).toLocaleString()}</span>` : ""}`;
    }
    return `<div class="admin-row key-card" data-provider="${provider}">
      <h3>${copy.name} API key</h3>
      <p class="admin-row-meta">${escapeHtml(copy.blurb)}</p>
      <p class="key-status">${line}</p>
      <form class="key-form">
        <input type="password" name="key" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(copy.placeholder)}" aria-label="${copy.name} API key" />
        <button type="submit" class="primary">Save key</button>
        <button type="button" class="secondary test-key" ${status?.source && status.source !== "none" ? "" : "disabled"}>Test key</button>
        <button type="button" class="secondary remove-key" ${status?.source === "database" ? "" : "hidden"}>Remove</button>
      </form>
      <p class="key-hint">${
        status?.envFallbackAvailable
          ? `Removing the saved key falls back to ${copy.envVar}.`
          : `No ${copy.envVar} fallback is set on the server, so removing the saved key turns this provider off.`
      }</p>
    </div>`;
  }).join("");
}

async function loadKeyCards() {
  renderKeyCards();
  await Promise.all(
    AI_PROVIDERS.map(async (provider) => {
      try {
        keyStatuses[provider] = await adminKeyStatus(provider);
      } catch (err) {
        keyStatuses[provider] = { error: err instanceof Error ? err.message : "Could not read status." };
      }
    }),
  );
  renderKeyCards();
}

function bindAdminKeys() {
  const list = $("#adminKeyCards");
  list.addEventListener("submit", async (event) => {
    const form = event.target.closest(".key-form");
    if (!form) return;
    event.preventDefault();
    const provider = form.closest(".key-card")?.dataset.provider;
    const key = form.elements.key.value.trim();
    if (key.length < 10) return setAdminMessage("error", "Paste the whole key.");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Checking…";
    try {
      keyStatuses[provider] = await adminSaveKey(provider, key);
      setAdminMessage("note", `${PROVIDER_COPY[provider].name} key saved and working.`);
    } catch (err) {
      setAdminMessage("error", err instanceof Error ? err.message : "Could not save the key.");
    }
    renderKeyCards();
  });
  list.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || button.type === "submit") return;
    const provider = button.closest(".key-card")?.dataset.provider;
    if (!provider) return;
    button.disabled = true;
    try {
      if (button.classList.contains("test-key")) {
        keyStatuses[provider] = await adminTestKey(provider);
        setAdminMessage("note", `${PROVIDER_COPY[provider].name} key is working.`);
      } else if (button.classList.contains("remove-key")) {
        if (!confirm(`Remove the saved ${PROVIDER_COPY[provider].name} key?`)) {
          button.disabled = false;
          return;
        }
        keyStatuses[provider] = await adminRemoveKey(provider);
        setAdminMessage("note", `${PROVIDER_COPY[provider].name} key removed.`);
      }
    } catch (err) {
      setAdminMessage("error", err instanceof Error ? err.message : "Request failed.");
    }
    renderKeyCards();
  });
}

// ---------------------------------------------------------------------------
// Music and sound effects
// ---------------------------------------------------------------------------

const MUSIC_IDEAS = [
  { title: "Sunny morning", mood: "happy", prompt: "A cheerful, bouncy children's tune with ukulele, glockenspiel and soft hand claps, warm and simple, no vocals" },
  { title: "Cozy kitchen", mood: "cozy", prompt: "A gentle, homely acoustic piece with fingerpicked guitar, light piano and a hint of kazoo, relaxed and friendly, no vocals" },
  { title: "Magic world", mood: "magical", prompt: "A magical, wondrous underscore with shimmering bells, soft harp and airy pads, dreamy and spacious, no vocals" },
  { title: "Dreamy bedtime", mood: "sleepy", prompt: "A gentle lullaby with a soft music box and warm strings, slow and calm, no vocals" },
  { title: "Flower sky", mood: "calm", prompt: "A light, floating piece with flute, celesta and soft strings, like drifting through clouds, peaceful, no vocals" },
  { title: "Little adventure", mood: "adventure", prompt: "A light-hearted adventure theme with playful woodwinds, pizzicato strings and a gentle marching beat, curious and bright, no vocals" },
];

const SFX_IDEAS = [
  { title: "Cat meow", ms: 1500, prompt: "A small cat meowing once, cute and clear [meow]" },
  { title: "Kitten mew", ms: 2000, prompt: "A tiny kitten mewing softly twice [mew]" },
  { title: "Cat purr", ms: 4000, prompt: "A cat purring contentedly, close and warm [purr]" },
  { title: "Paws crawling", ms: 3000, prompt: "Small paws crawling and scurrying across a wooden floor [crawl]" },
  { title: "Dog bark", ms: 1500, prompt: "A small dog barking once, happy and friendly [bark]" },
  { title: "Puppy pant", ms: 3000, prompt: "A puppy panting happily with a little whine [pant]" },
  { title: "Cozy room", ms: 8000, prompt: "Cozy living room ambience with a soft clock ticking and distant birds outside [room]" },
  { title: "Rain on window", ms: 8000, prompt: "Light rain tapping on a window pane, calm [rain]" },
  { title: "Magic sparkle", ms: 1500, prompt: "A bright magical sparkle chime, twinkly and short [sparkle]" },
  { title: "Happy giggle", ms: 2000, prompt: "A small child giggling happily [giggle]" },
];

const audioState = {
  music: { items: [], running: false, stop: false },
  sfx: { items: [], running: false, stop: false },
};

function parseTags(value) {
  return String(value ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function formatLength(ms) {
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function renderIdeas(kind) {
  const box = $(kind === "music" ? "#musicIdeas" : "#sfxIdeas");
  const ideas = kind === "music" ? MUSIC_IDEAS : SFX_IDEAS;
  box.innerHTML = ideas
    .map((idea, i) => `<button type="button" data-idea="${i}">${escapeHtml(idea.title)}</button>`)
    .join("");
}

function applyIdea(kind, idea) {
  const form = $(kind === "music" ? "#musicForm" : "#sfxForm");
  form.elements.title.value = idea.title;
  form.elements.prompt.value = idea.prompt;
  if (kind === "music") form.elements.mood.value = idea.mood ?? "";
  if (kind === "sfx") {
    form.elements.durationMs.value = String(idea.ms);
    updateCuePreview();
  }
  form.elements.title.focus();
}

function updateCuePreview() {
  const prompt = $("#sfxForm").elements.prompt.value;
  const match = prompt.trim().match(/\[([a-z][a-z0-9_]{0,31})\]\s*$/i);
  const box = $("#sfxCuePreview");
  box.innerHTML = match
    ? `Tag: <code>[${escapeHtml(match[1].toLowerCase())}]</code>`
    : `No tag yet. End the description with one, like <code>[meow]</code>; otherwise one is made from the title.`;
}

async function loadAudio(kind) {
  try {
    audioState[kind].items = await adminListAudio(kind);
  } catch (err) {
    audioState[kind].items = [];
    setAdminMessage("error", err instanceof Error ? err.message : "Could not load the library.");
  }
  renderAudioList(kind);
}

function renderAudioList(kind) {
  const list = $(kind === "music" ? "#musicList" : "#sfxList");
  const query = $(kind === "music" ? "#musicSearch" : "#sfxSearch").value.trim().toLowerCase();
  const items = audioState[kind].items;
  const rows = items.filter((row) => {
    if (!query) return true;
    const hay = [row.title, row.prompt, row.cue, row.mood, ...(row.tags ?? [])].join(" ").toLowerCase();
    return hay.includes(query);
  });
  $(kind === "music" ? "#musicCount" : "#sfxCount").textContent = `${rows.length} / ${items.length}`;
  if (rows.length === 0) {
    list.innerHTML = `<p class="admin-empty">${items.length ? "No matches." : kind === "music" ? "No tracks yet. Compose one above." : "No sounds yet. Make one above."}</p>`;
    return;
  }
  list.innerHTML = rows
    .map((row) => {
      const meta = [
        kind === "sfx" ? `<span class="sfx-cue">[${escapeHtml(row.cue)}]</span>` : row.mood ? escapeHtml(row.mood) : "",
        formatLength(row.duration_ms),
        (row.tags ?? []).map((t) => escapeHtml(t)).join(", "),
        new Date(row.created_at).toLocaleDateString(),
      ]
        .filter(Boolean)
        .join(" · ");
      return `<div class="admin-row audio-row" data-id="${escapeHtml(row.id)}">
        <div class="admin-row-main">
          <p class="admin-row-title">${escapeHtml(row.title)}${row.active === false ? `<span class="admin-chip is-off">hidden</span>` : ""}</p>
          <p class="admin-row-meta">${meta}</p>
          <p class="admin-row-meta">${escapeHtml(row.prompt)}</p>
        </div>
        <audio controls preload="none" src="${escapeHtml(audioUrl(kind, row.storage_path))}"></audio>
        <div class="admin-row-actions">
          <button type="button" class="secondary rename-audio">Rename</button>
          <button type="button" class="secondary toggle-audio">${row.active === false ? "Show" : "Hide"}</button>
          <button type="button" class="secondary delete-audio">Delete</button>
        </div>
      </div>`;
    })
    .join("");
}

function runLog(kind, line, { reset = false } = {}) {
  const box = $(kind === "music" ? "#musicRunLog" : "#sfxRunLog");
  box.hidden = false;
  box.textContent = reset ? line : `${box.textContent}\n${line}`;
  box.scrollTop = box.scrollHeight;
}

function setRunning(kind, running) {
  audioState[kind].running = running;
  audioState[kind].stop = false;
  const prefix = kind === "music" ? "#music" : "#sfx";
  $(`${prefix}StopBtn`).hidden = !running;
  $(`${prefix}StarterBtn`).disabled = running;
  $(`${prefix}PlanBtn`).disabled = running;
  $(kind === "music" ? "#musicForm" : "#sfxForm").querySelector("button[type=submit]").disabled = running;
}

async function generateOne(kind, plan) {
  if (kind === "music") {
    return adminGenerateMusic({
      title: plan.title,
      prompt: plan.prompt,
      mood: plan.mood ?? "",
      durationMs: plan.durationMs,
      tags: plan.tags ?? [],
    });
  }
  return adminGenerateSfx({
    title: plan.title,
    prompt: plan.prompt,
    cue: plan.cue,
    durationMs: plan.durationMs,
    tags: plan.tags ?? [],
  });
}

/** Generate a list one after another, logging progress, honouring Stop. */
async function runBatch(kind, plans, label) {
  if (plans.length === 0) {
    runLog(kind, `${label}: nothing to make.`, { reset: true });
    return;
  }
  setRunning(kind, true);
  runLog(kind, `${label}: making ${plans.length} ${kind === "music" ? "tracks" : "sounds"}…`, { reset: true });
  let made = 0;
  for (const [index, plan] of plans.entries()) {
    if (audioState[kind].stop) {
      runLog(kind, "Stopped.");
      break;
    }
    runLog(kind, `${index + 1}/${plans.length} ${plan.title} (${formatLength(plan.durationMs)})…`);
    try {
      await generateOne(kind, plan);
      made += 1;
      runLog(kind, `   done`);
      await loadAudio(kind);
    } catch (err) {
      runLog(kind, `   failed: ${err instanceof Error ? err.message : "unknown error"}`);
      if (/key/i.test(String(err?.message))) break;
    }
  }
  runLog(kind, `Finished: ${made} of ${plans.length} made.`);
  setRunning(kind, false);
}

function starterPlans(kind) {
  if (kind === "music") {
    const taken = new Set(audioState.music.items.map((t) => t.title.toLowerCase()));
    return MUSIC_IDEAS.filter((i) => !taken.has(i.title.toLowerCase())).map((i) => ({
      ...i,
      durationMs: 60_000,
      tags: [i.mood],
    }));
  }
  const takenCues = new Set(audioState.sfx.items.map((c) => c.cue));
  return SFX_IDEAS.flatMap((i) => {
    const cue = i.prompt.match(/\[([a-z0-9_]+)\]\s*$/)?.[1];
    if (!cue || takenCues.has(cue)) return [];
    return [{ title: i.title, prompt: i.prompt, cue, durationMs: i.ms, tags: [] }];
  });
}

function bindAdminAudio(kind) {
  const prefix = kind === "music" ? "#music" : "#sfx";
  const form = $(`${prefix}Form`);
  renderIdeas(kind);

  $(`${prefix}Ideas`).addEventListener("click", (event) => {
    const button = event.target.closest("[data-idea]");
    if (!button) return;
    const ideas = kind === "music" ? MUSIC_IDEAS : SFX_IDEAS;
    applyIdea(kind, ideas[Number(button.dataset.idea)]);
  });

  if (kind === "sfx") {
    form.elements.prompt.addEventListener("input", updateCuePreview);
    updateCuePreview();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const plan = {
      title: form.elements.title.value.trim(),
      prompt: form.elements.prompt.value.trim(),
      durationMs: Number(form.elements.durationMs.value),
      tags: parseTags(form.elements.tags.value),
      mood: kind === "music" ? form.elements.mood.value : undefined,
    };
    if (!plan.title || plan.prompt.length < 5) {
      return setAdminMessage("error", "Give it a title and a short description.");
    }
    const button = form.querySelector("button[type=submit]");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = kind === "music" ? "Composing… this can take a minute" : "Making sound…";
    setAdminMessage("note", null);
    try {
      const row = await generateOne(kind, plan);
      setAdminMessage("note", `Made “${row.title}”. Press play to listen.`);
      form.elements.title.value = "";
      form.elements.prompt.value = "";
      if (kind === "sfx") updateCuePreview();
      await loadAudio(kind);
    } catch (err) {
      setAdminMessage("error", err instanceof Error ? err.message : "Generation failed.");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });

  $(`${prefix}StarterBtn`).addEventListener("click", () => {
    if (audioState[kind].running) return;
    const plans = starterPlans(kind);
    if (plans.length === 0) return setAdminMessage("note", "The starter set is already in the library.");
    runBatch(kind, plans, "Starter set");
  });

  $(`${prefix}PlanBtn`).addEventListener("click", async () => {
    if (audioState[kind].running) return;
    const count = Number($(`${prefix}PlanCount`).value) || 5;
    const brief = $(`${prefix}PlanBrief`).value.trim();
    setRunning(kind, true);
    runLog(kind, `Asking Gemini to plan ${count}…`, { reset: true });
    let plans = [];
    try {
      plans = await adminPlanAudio(kind, { count, brief });
      runLog(kind, plans.map((p) => `• ${p.title}: ${p.prompt}`).join("\n"));
    } catch (err) {
      runLog(kind, `Planning failed: ${err instanceof Error ? err.message : "unknown error"}`);
      setRunning(kind, false);
      return;
    }
    setRunning(kind, false);
    await runBatch(kind, plans, "Gemini plan");
  });

  $(`${prefix}StopBtn`).addEventListener("click", () => {
    audioState[kind].stop = true;
    runLog(kind, "Stopping after the current one…");
  });

  $(`${prefix}Search`).addEventListener("input", () => renderAudioList(kind));

  $(`${prefix}List`).addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const id = button.closest(".audio-row")?.dataset.id;
    const row = audioState[kind].items.find((r) => r.id === id);
    if (!row) return;
    try {
      if (button.classList.contains("rename-audio")) {
        const title = prompt("New title", row.title);
        if (!title || !title.trim()) return;
        await adminUpdateAudio(kind, id, { title: title.trim().slice(0, 120) });
      } else if (button.classList.contains("toggle-audio")) {
        await adminUpdateAudio(kind, id, { active: row.active === false });
      } else if (button.classList.contains("delete-audio")) {
        if (!confirm(`Delete “${row.title}” permanently?`)) return;
        await adminDeleteAudio(kind, id, row.storage_path);
      }
      await loadAudio(kind);
    } catch (err) {
      setAdminMessage("error", err instanceof Error ? err.message : "Could not update.");
    }
  });
}
