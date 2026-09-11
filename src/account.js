import {
  TALK_COST,
  adminCreateCoupons,
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
    console.error("[PaintMomo] spend_points failed:", err);
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
  $("#accountModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeAccountSheet();
  });
  $("#signOutBtn").addEventListener("click", async () => {
    $("#signOutBtn").disabled = true;
    try {
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
