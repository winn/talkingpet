import "@fontsource/noto-sans-thai/thai-400.css";
import "@fontsource/noto-sans-thai/thai-600.css";
import "@fontsource/noto-sans-thai/thai-700.css";
import { t, getLanguage, localizeText, initLanguageControls } from "./i18n.js";
import "@fontsource/nunito/latin-600.css";
import "@fontsource/nunito/latin-800.css";
import "@fontsource/nunito/latin-900.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-700.css";
import { configureOrbitControls } from "./camera-controls.js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
  PET_CONFIGS,
  getPetConfig,
  normalizePetType,
  petGender,
} from "./pet-configs.js";
import { getAllPets, getPetById, savePet, deletePetById } from "./pet-db.js";
import { createPetVrmUrl, revokeAllPetVrmUrls } from "./vrm-reconstruct.js";
import { capture360Frames, mount360Rotator } from "./preview-360.js";

import {
  PROMPT_CHOICES,
  DEFAULT_RECIPE,
  normalizeRecipe,
  recipeChoice,
  buildPrompt,
  promptParts,
  buildChatGreeting,
  samplePrompt,
  normalizeBackground,
} from "./prompt-builder.js";
import {
  pickPaintIntersection,
  createProjectedStroke,
} from "./projected-paint.js";
import { attachSurfaceGestures } from "./surface-gestures.js";
import { localizeChatControls } from "./chat-labels.js";
import { initPreventPageZoom } from "./prevent-page-zoom.js";
import { mountTalkControls } from "./talk-controls.js";
import {
  BACKGROUNDS,
  normalizeBackgroundId,
  applyBackdrop,
} from "./backgrounds.js";

// Prevent mobile browser page zoom while preserving canvas pinch gestures
initPreventPageZoom();

// Apply language and setup toggle listeners immediately
initLanguageControls();

// Make THREE globally accessible for preview-360 and plugins
if (typeof window !== "undefined") {
  window.THREE = THREE;
}

let activePetType = "minicat";
let petConfig = getPetConfig(activePetType);
let currentPetId = null;
let currentPetName = "Momo";
let currentPersonalityPrompt = "";
let petToDeleteId = null;
let currentRecipe = { ...DEFAULT_RECIPE };
let currentRecord = null;
let promptOnly = false;
let dirty = false;
let saveInProgress = false;
let rotators = [];
let toastTimer;
let modelLoadToken = 0;
let chatLaunchToken = 0;
let chatThemeObserver;
let talkControls = null;
let activeChatPet = null;
let lastPets = null;
let strokeSnapshot = null;
let strokeChanged = false;
let strokeSurface = null;
let textureUpdatePending = false;
let vrmRaycastProxies = [];
let vrmPaintMeshes = vrmRaycastProxies;
let currentStrokeBrushSize = 10;
let currentBackgroundId = null;
const compactStudio = window.matchMedia(
  "(max-width: 767px), (max-width: 1024px) and (max-height: 500px)",
);

let threeScene = null;
let threeCamera = null;
let threeRenderer = null;
let threeControls = null;
let isPainterRunning = false;
let animFrameId = null;
let currentVrmModelUrl = null;
const clock = new THREE.Clock();

const PRESERVED_MATERIAL_KEYWORDS = [
  "eye",
  "mouth",
  "teeth",
  "tongue",
  "lash",
  "pupil",
  "iris",
];

function isPaintableMaterial(materialName) {
  if (!materialName) return false;
  const nameLow = materialName.toLowerCase().replace("_flatpaint", "");
  for (const kw of PRESERVED_MATERIAL_KEYWORDS) {
    if (nameLow.includes(kw)) return false;
  }
  // Allow pet configs to override
  if (
    petConfig &&
    petConfig.editableMaterials &&
    petConfig.editableMaterials.length > 0
  ) {
    return petConfig.editableMaterials.some((m) =>
      nameLow.includes(m.toLowerCase()),
    );
  }
  return true;
}

// Canvas Elements
const paintCanvas = document.querySelector("#paintCanvas");
const guideCanvas = document.querySelector("#guideCanvas");
const popoverBrushSize = document.querySelector("#popoverBrushSize");
const sizePopover = document.querySelector("#sizePopover");
const colorWheelInput = document.querySelector("#colorWheel");
const toolButtons = document.querySelectorAll(".tool[data-tool]");
const clearButton = document.querySelector("#clearCanvas");
const undoBtn = document.querySelector("#undoBtn");
const redoBtn = document.querySelector("#redoBtn");
const vrmCanvas = document.querySelector("#vrmCanvas");
const presetColors = document.querySelectorAll(".preset-color");

// Pet Studio Screens & Hub UI
const petHubScreen = document.querySelector("#petHubScreen");
const hubAdoptNewBtn = document.querySelector("#hubAdoptNewBtn");
const petListGrid = document.querySelector("#petListGrid");
const selectPetTypeScreen = document.querySelector("#selectPetTypeScreen");
const petTypeListGrid = document.querySelector("#petTypeListGrid");
const petTypeBackBtn = document.querySelector("#petTypeBackBtn");
const headerBackToHubBtn = document.querySelector("#headerBackToHubBtn");
const nextPersonalityBtn = document.querySelector("#nextPersonalityBtn");
const personalityModal = document.querySelector("#personalityModal");
const closePersonalityBtn = document.querySelector("#closePersonalityBtn");
const backToPaintBtn = document.querySelector("#backToPaintBtn");
const savePetBtn = document.querySelector("#savePetBtn");
const personalityInput = document.querySelector("#personalityInput");
const personalityPetName = document.querySelector("#personalityPetName");
const savingOverlay = document.querySelector("#savingOverlay");
const savingText = document.querySelector("#savingText");
const talkScreen = document.querySelector("#talkScreen");
const exitTalkBtn = document.querySelector("#exitTalkBtn");
const deleteModal = document.querySelector("#deleteModal");
const deletePetName = document.querySelector("#deletePetName");
const cancelDeleteBtn = document.querySelector("#cancelDeleteBtn");
const confirmDeleteBtn = document.querySelector("#confirmDeleteBtn");

// Welcome / Step 2 Naming Screen UI
const welcomeScreen = document.querySelector("#welcomeScreen");
const nameInput = document.querySelector("#nameInput");
const startBtn = document.querySelector("#startBtn");
const nameBack = document.querySelector("#nameBack");
const userNameDisplay = document.querySelector("#userNameDisplay");

// Mobile Layout Toggles
const toggle2DBtn = document.querySelector("#toggle2DBtn");
const toggle3DBtn = document.querySelector("#toggle3DBtn");
const panel2D = document.querySelector("#panel2D");
const panel3D = document.querySelector("#panel3D");

// Image Upload UI
const imageUpload = document.querySelector("#imageUpload");
const uploadImageBtn = document.querySelector("#uploadImageBtn");
const transformOverlay = document.querySelector("#transformOverlay");
const overlayImage = document.querySelector("#overlayImage");
const handleRotate = document.querySelector("#handleRotate");
const handleScale = document.querySelector("#handleScale");
const commitImageBtn = document.querySelector("#commitImageBtn");
const cancelImageBtn = document.querySelector("#cancelImageBtn");
const canvasContainer = document.querySelector("#canvasContainer");
const bgColorPicker = document.querySelector("#bgColorPicker");
const rightPanelSection = document.querySelector("#vrmCanvas").parentElement;

const paintCtx = paintCanvas.getContext("2d");
const guideCtx = guideCanvas.getContext("2d");
const exportCanvas = document.createElement("canvas");
exportCanvas.width = paintCanvas.width;
exportCanvas.height = paintCanvas.height;
const exportCtx = exportCanvas.getContext("2d");

let activeTool = "brush";
let activeColor = colorWheelInput.value;
let drawing = false;
let lastPoint = null;
let editableTexture = null;
let currentVrm = null;

const MAX_HISTORY = 20;
let historyStack = [];
let historyIndex = -1;

// 2D Zoom & Pan State
let canvasZoom = 1;
let canvasPanX = 0;
let canvasPanY = 0;

// Mirror Mode State
let isMirrorMode = false;
let symmetryX = 512; // Initialized to center of 1024 width canvas

const toggleMirrorBtn = document.querySelector("#toggleMirrorBtn");
const zoom2DInBtn = document.querySelector("#zoom2DInBtn");
const zoom2DOutBtn = document.querySelector("#zoom2DOutBtn");
const reset2DBtn = document.querySelector("#reset2DBtn");
const canvasTransformWrapper = document.querySelector(
  "#canvasTransformWrapper",
);
const symmetryLine = document.querySelector("#symmetryLine");

paintCtx.lineCap = "round";
paintCtx.lineJoin = "round";

// Save initial blank state
initHistory();

// Start initialization
loadGuide();
initPainter();
initImageUpload();
initMobileToggle();
initWelcomeScreen();
initHubEvents();
initBackdropPicker();
const vrmReady = initVrm().catch(() => {
  localizeText(
    document.querySelector("#modelStatus"),
    "The 3D view could not start. You can still use the coloring sheet.",
  );
});
loadPetHub();
initPromptWorkshop();
initStudioExtras();

// ----------------------------------------------------
// UI Flow & Hub Coordination
// ----------------------------------------------------
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function initHubEvents() {
  hubAdoptNewBtn.addEventListener("click", startNewPetFlow);
  petTypeBackBtn.addEventListener("click", loadPetHub);
  headerBackToHubBtn.addEventListener("click", () => {
    if (dirty) {
      document.querySelector("#leaveModal").classList.remove("hidden");
      document.querySelector("#stayPaintingBtn").focus();
    } else loadPetHub();
  });
  nextPersonalityBtn.addEventListener("click", () => {
    if (overlayState.active) {
      notify("Stamp or cancel your picture first.");
      return;
    }
    if (currentPetId) {
      handleSavePet({ colorsOnly: true });
      return;
    }
    promptOnly = false;
    openPromptWorkshop();
  });
  closePersonalityBtn.addEventListener("click", closePromptWorkshop);
  backToPaintBtn.addEventListener("click", closePromptWorkshop);
  savePetBtn.addEventListener("click", () => handleSavePet());
  cancelDeleteBtn.addEventListener("click", closeDeleteModal);
  confirmDeleteBtn.addEventListener("click", async () => {
    confirmDeleteBtn.disabled = true;
    try {
      await deletePetById(petToDeleteId);
      closeDeleteModal();
      await loadPetHub();
      notify("Pet removed from this device.");
    } catch {
      notify("Could not remove your pet. Please try again.");
    } finally {
      confirmDeleteBtn.disabled = false;
    }
  });
  exitTalkBtn.addEventListener("click", async () => {
    chatLaunchToken++;
    activeChatPet = null;
    chatThemeObserver?.disconnect();
    talkControls?.destroy();
    talkControls = null;
    if (window.ChatWidget?.destroy) {
      try {
        await window.ChatWidget.destroy();
      } catch {}
    } else if (window.ChatWidget?.disconnect) {
      try {
        await window.ChatWidget.disconnect();
      } catch {}
    }
    document.querySelector("#chatWidgetContainer").replaceChildren();
    document.getElementById("webavatar-jssdk")?.remove();
    revokeAllPetVrmUrls();
    await loadPetHub();
  });
}

async function loadPetHub() {
  pausePainterScene();
  document.querySelector("#leaveModal").classList.add("hidden");
  dirty = false;
  petHubScreen.classList.remove("hidden");
  petHubScreen.style.display = "flex";
  selectPetTypeScreen.classList.add("hidden");
  selectPetTypeScreen.classList.remove("grid");
  welcomeScreen.classList.add("hidden");
  welcomeScreen.classList.remove("grid");
  talkScreen.classList.add("hidden");
  talkScreen.style.display = "none";
  personalityModal.classList.add("hidden");
  personalityModal.classList.remove("grid");

  try {
    const pets = await getAllPets();
    renderPetGrid(pets);
  } catch (err) {
    petListGrid.innerHTML = `<div class="empty-crew"><p data-i18n="Your browser could not open saved pets. Please allow site storage and reload.">${t("Your browser could not open saved pets. Please allow site storage and reload.")}</p></div>`;
  }
}

function renderPetGrid(pets) {
  lastPets = pets;
  rotators.forEach((rotator) => rotator.destroy());
  rotators = [];
  petListGrid.replaceChildren();
  document.querySelector("#petCount").textContent = pets.length;
  if (!pets.length) {
    petListGrid.innerHTML = `<div class="empty-crew"><span><svg><use href="#i-paw"/></svg></span><div><h3>${t("A little friend belongs here.")}</h3><p>${t("Create your first pet and this becomes their home.")}</p></div></div>`;
    return;
  }
  pets
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach((pet) => {
      const config = getPetConfig(pet.petType, petGender(pet));
      const card = document.createElement("article");
      card.className = "pet-card";
      card.innerHTML = `<div class="pet-card-header"><div><h3>${escapeHtml(pet.name)}</h3><span class="pet-type-label">${t(config.label)}</span></div><button class="delete-btn" aria-label="${escapeHtml(t("Delete {name}", { name: pet.name }))}" title="${t("Delete pet")}">×</button></div><div class="pet-preview"><div class="rotator"></div><span class="spin-hint">${t("Drag to turn ↔")}</span></div><p class="pet-description"></p><div class="pet-actions"><button class="edit-colors-btn secondary"><svg><use href="#i-brush"/></svg>${t("Edit colors")}</button><button class="edit-prompt-btn secondary"><svg><use href="#i-spark"/></svg>${t("Edit prompt")}</button><button class="talk-btn primary"><svg><use href="#i-chat"/></svg>${escapeHtml(t("Talk to {name}", { name: pet.name }))}</button></div>`;
      applyBackdrop(
        card.querySelector(".pet-preview"),
        normalizeBackground(pet.backgroundColor),
        pet.backgroundId,
      );
      card.querySelector(".pet-description").textContent = pet.promptRecipe
        ? `${recipeChoice(normalizeRecipe(pet.promptRecipe), "vibe", getLanguage()).label} · ${recipeChoice(normalizeRecipe(pet.promptRecipe), "activity", getLanguage()).label}`
        : pet.personalityPrompt || t("Your one-of-a-kind friend");
      const rotator = card.querySelector(".rotator");
      if (pet.previewFrames?.length)
        rotators.push(mount360Rotator(rotator, pet.previewFrames));
      else {
        const img = document.createElement("img");
        img.src = config.previewUrl;
        img.alt = pet.name;
        rotator.appendChild(img);
        card.querySelector(".spin-hint").remove();
      }
      card
        .querySelector(".delete-btn")
        .addEventListener("click", () => openDeleteModal(pet));
      card
        .querySelector(".edit-colors-btn")
        .addEventListener("click", () =>
          openEditPetFlow(pet).catch(() =>
            notify("Could not open these colors. Please try again."),
          ),
        );
      card
        .querySelector(".edit-prompt-btn")
        .addEventListener("click", () => openPromptOnly(pet));
      card
        .querySelector(".talk-btn")
        .addEventListener("click", () =>
          launchPetChat(pet).catch(() =>
            notify("Your pet could not connect. Please try again."),
          ),
        );
      petListGrid.appendChild(card);
    });
}

function loadPetTypeSelection() {
  petHubScreen.classList.add("hidden");
  welcomeScreen.classList.add("hidden");
  personalityModal.classList.add("hidden");
  selectPetTypeScreen.classList.remove("hidden");
  renderPetTypes();
}
function renderPetTypes() {
  petTypeListGrid.replaceChildren();
  Object.values(PET_CONFIGS).forEach((pet) => {
    const card = document.createElement("button");
    card.className = "type-card";
    card.innerHTML = `<img src="${pet.previewUrl}" alt="" draggable="false"><strong>${t(pet.label)}<svg><use href="#i-arrow"/></svg></strong><small>${t(pet.id === "minicat" ? "Tiny paws. Endless possibilities." : "Floppy ears. A heart full of ideas.")}</small>`;
    card.addEventListener("click", () => selectPetType(pet.id));
    petTypeListGrid.appendChild(card);
  });
}

async function selectPetType(petTypeId) {
  activePetType = petTypeId;
  petConfig = getPetConfig(activePetType);
  selectPetTypeScreen.classList.add("hidden");
  document.querySelector("#namePetPreview").src = petConfig.previewUrl;
  nameInput.value = "Momo";
  welcomeScreen.classList.remove("hidden");
  loadGuide(petConfig.guideUrl);
  await vrmReady;
  await loadVrmModel(petConfig.baseModelUrl);
}

function startNewPetFlow() {
  currentRecord = null;
  currentRecipe = { ...DEFAULT_RECIPE };
  promptOnly = false;
  dirty = false;
  resetStudio();
  setBackground("#e7ede4");
  localizeText(nextPersonalityBtn, "Next: personality");
  currentPetId = null;
  currentPetName = "Momo";
  currentPersonalityPrompt = "";
  activePetType = "minicat";
  petConfig = getPetConfig(activePetType);

  paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  initHistory();
  updateEditableTexture();

  loadPetTypeSelection();
}

async function openEditPetFlow(pet) {
  currentRecord = pet;
  currentRecipe = normalizeRecipe(
    pet.promptRecipe || {
      gender: petGender(pet),
      custom: pet.personalityPrompt,
    },
  );
  promptOnly = false;
  dirty = false;
  resetStudio();
  setBackground(pet.backgroundColor, pet.backgroundId);
  localizeText(nextPersonalityBtn, "Save colors");
  await vrmReady;
  currentPetId = pet.id;
  currentPetName = pet.name || "Momo";
  currentPersonalityPrompt = pet.personalityPrompt || "";
  activePetType = normalizePetType(pet.petType);
  petConfig = getPetConfig(activePetType);

  nameInput.value = currentPetName;
  localizeText(userNameDisplay, "{name}'s Studio", { name: currentPetName });
  personalityInput.value = currentPersonalityPrompt;
  personalityPetName.textContent = currentPetName;

  loadGuide(petConfig.guideUrl);
  if (petConfig.baseModelUrl && currentVrmModelUrl !== petConfig.baseModelUrl) {
    await loadVrmModel(petConfig.baseModelUrl);
  }

  if (pet.texturePng) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = () => resolve();
      img.src = pet.texturePng;
    });
    paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    paintCtx.drawImage(img, 0, 0, paintCanvas.width, paintCanvas.height);
    initHistory();
    updateEditableTexture();
  } else {
    paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    initHistory();
    updateEditableTexture();
  }

  petHubScreen.classList.add("hidden");
  petHubScreen.style.display = "none";
  selectPetTypeScreen.classList.add("hidden");
  selectPetTypeScreen.classList.remove("grid");
  welcomeScreen.classList.add("hidden");
  welcomeScreen.classList.remove("grid");
  talkScreen.classList.add("hidden");
  talkScreen.style.display = "none";

  resumePainterScene();
  setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
}

function openDeleteModal(pet) {
  petToDeleteId = pet.id;
  deletePetName.textContent = pet.name || t("Pet");
  deleteModal.classList.remove("hidden");
  deleteModal.classList.add("grid");
}

function closeDeleteModal() {
  petToDeleteId = null;
  deleteModal.classList.add("hidden");
  deleteModal.classList.remove("grid");
}

async function handleSavePet({ colorsOnly = false } = {}) {
  if (saveInProgress) return;
  if (overlayState.active && !promptOnly) {
    notify("Stamp or cancel your picture first.");
    return;
  }
  saveInProgress = true;
  savePetBtn.disabled = true;
  pausePainterScene();
  savingOverlay.classList.remove("hidden");
  localizeText(savingText, "Saving your little masterpiece…");
  if (!promptOnly) {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  }
  const wasNew = !currentPetId;
  try {
    if (!colorsOnly) {
      currentRecipe.custom = personalityInput.value.trim();
      currentPersonalityPrompt = buildPrompt(
        currentPetName,
        activePetType,
        currentRecipe,
        getLanguage(),
      );
    }
    let frames = currentRecord?.previewFrames || [];
    let texturePng = currentRecord?.texturePng;
    if (!promptOnly) {
      updateEditableTexture();
      if (currentVrm && currentVrmModelUrl === petConfig.baseModelUrl) {
        frames = await capture360Frames(
          threeRenderer,
          threeScene,
          threeCamera,
          currentVrm,
          18,
        );
      }
      texturePng = paintCanvas.toDataURL("image/png");
    }
    const petRecord = {
      ...currentRecord,
      id: currentPetId || crypto.randomUUID(),
      name: currentPetName,
      petType: activePetType,
      gender: colorsOnly
        ? petGender(currentRecord || {})
        : currentRecipe.gender,
      personalityPrompt: currentPersonalityPrompt,
      promptLanguage: colorsOnly
        ? currentRecord?.promptLanguage
        : getLanguage(),
      promptRecipe: colorsOnly
        ? currentRecord?.promptRecipe
        : { ...currentRecipe },
      backgroundColor: promptOnly
        ? normalizeBackground(currentRecord?.backgroundColor)
        : bgColorPicker.value,
      backgroundId: promptOnly
        ? normalizeBackgroundId(currentRecord?.backgroundId)
        : currentBackgroundId,
      texturePng,
      previewFrames: frames,
      createdAt: currentRecord?.createdAt || Date.now(),
    };
    const saved = await savePet(petRecord);
    currentRecord = saved;
    currentPetId = saved.id;
    dirty = false;
    personalityModal.classList.add("hidden");
    if (wasNew && !colorsOnly) {
      localizeText(savingText, "Your friend is ready. Let’s say hello…");
      try {
        await launchPetChat(saved);
      } catch {
        await loadPetHub();
        notify("Your pet is saved. Chat could not connect. Try Talk again.");
      }
    } else {
      await loadPetHub();
      notify(
        colorsOnly
          ? "New colors saved!"
          : "New ideas saved! Your pet is ready to try them.",
      );
    }
  } catch (err) {
    console.error("[PaintMomo] Save failed:", err);
    notify("Could not save yet. Your work is still here. Please try again.");
    if (!promptOnly) resumePainterScene();
  } finally {
    savingOverlay.classList.add("hidden");
    saveInProgress = false;
    savePetBtn.disabled = false;
  }
}

export async function launchPetChat(pet) {
  const config = getPetConfig(pet.petType, petGender(pet));
  const launchToken = ++chatLaunchToken;

  pausePainterScene();

  let textureBlob = pet.textureBlob;
  if (!textureBlob && pet.texturePng) {
    // Generate white-backed blob for GLB if only texturePng was stored
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = 1024;
    tempCanvas.height = 1024;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.fillStyle = "#ffffff";
    tempCtx.fillRect(0, 0, 1024, 1024);
    const img = new Image();
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = () => resolve();
      img.src = pet.texturePng;
    });
    tempCtx.drawImage(img, 0, 0);
    textureBlob = await new Promise((resolve) =>
      tempCanvas.toBlob(resolve, "image/png"),
    );
  }

  const vrmBlobUrl = await createPetVrmUrl(config.baseModelUrl, textureBlob);
  if (launchToken !== chatLaunchToken) return;
  activeChatPet = pet;
  const backgroundColor = normalizeBackground(pet.backgroundColor);
  talkScreen.style.setProperty("--talk-background", backgroundColor);
  talkScreen.style.backgroundColor = backgroundColor;
  applyBackdrop(
    document.querySelector("#chatWidgetContainer"),
    backgroundColor,
    pet.backgroundId,
  );
  document.querySelector("#talkPetName").textContent = pet.name;
  localizeText(
    document.querySelector("#chatStatus"),
    "Getting ready to say hello…",
  );

  petHubScreen.classList.add("hidden");
  petHubScreen.style.display = "none";
  selectPetTypeScreen.classList.add("hidden");
  selectPetTypeScreen.classList.remove("grid");
  welcomeScreen.classList.add("hidden");
  welcomeScreen.classList.remove("grid");
  personalityModal.classList.add("hidden");
  personalityModal.classList.remove("grid");
  talkScreen.classList.remove("hidden");
  talkScreen.style.display = "flex";

  const greeting = buildChatGreeting(pet, getLanguage());

  window.ChatWidgetConfig = {
    mode: "realtime-ar",
    widgetId: config.widgetId,
    avatarUrl: vrmBlobUrl,
    greetingInstruction: greeting,
    container: "#chatWidgetContainer",
    backgroundColor,
  };

  if (
    window.ChatWidget &&
    typeof window.ChatWidget.updateConfig === "function"
  ) {
    try {
      await window.ChatWidget.updateConfig({
        widgetId: config.widgetId,
        avatarUrl: vrmBlobUrl,
        greetingInstruction: greeting,
        backgroundColor,
      });
      watchChatSurface(backgroundColor, launchToken);
      return;
    } catch (err) {
      console.warn("[PaintMomo] updateConfig error, reloading script:", err);
    }
  }

  const chatContainer = document.querySelector("#chatWidgetContainer");
  if (chatContainer) chatContainer.innerHTML = "";
  const oldScript = document.getElementById("webavatar-jssdk");
  if (oldScript) oldScript.remove();

  const s = document.createElement("script");
  s.id = "webavatar-jssdk";
  s.src = "https://webavatar.didthat.cc/chat-widget.js";
  s.async = true;
  s.onload = () => watchChatSurface(backgroundColor, launchToken);
  s.onerror = () => {
    if (launchToken !== chatLaunchToken) return;
    localizeText(
      document.querySelector("#chatStatus"),
      "Your pet is saved! We couldn’t connect to chat. Go back to My pets and try again.",
    );
  };
  document.body.appendChild(s);
}

function initWelcomeScreen() {
  if (welcomeScreen && startBtn && nameInput && userNameDisplay) {
    startBtn.addEventListener("click", () => {
      currentPetName = nameInput.value.trim() || "Momo";
      dirty = true;
      localizeText(userNameDisplay, "{name}'s Studio", {
        name: currentPetName,
      });
      personalityPetName.textContent = currentPetName;
      welcomeScreen.classList.add("hidden");
      welcomeScreen.classList.remove("grid");
      resumePainterScene();
      setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    });

    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") startBtn.click();
    });

    if (nameBack) {
      nameBack.addEventListener("click", () => {
        welcomeScreen.classList.add("hidden");
        welcomeScreen.classList.remove("grid");
        loadPetTypeSelection();
      });
    }
  }
}

function initMobileToggle() {
  const studio = document.querySelector(".studio");
  toggle2DBtn.addEventListener("click", () => {
    studio.classList.add("show-sheet");
    toggle2DBtn.setAttribute("aria-pressed", "true");
    toggle3DBtn.setAttribute("aria-pressed", "false");
    syncQuickPreview();
  });
  toggle3DBtn.addEventListener("click", () => {
    studio.classList.remove("show-sheet");
    toggle3DBtn.setAttribute("aria-pressed", "true");
    toggle2DBtn.setAttribute("aria-pressed", "false");
    syncQuickPreview();
  });
  document
    .querySelector("#toggle3DPreviewBtn")
    .addEventListener("click", () => {
      studio.classList.toggle("show-preview");
      syncQuickPreview();
    });
  compactStudio.addEventListener("change", syncQuickPreview);
}

function isQuickPreview() {
  const studio = document.querySelector(".studio");
  return (
    compactStudio.matches &&
    studio.classList.contains("show-sheet") &&
    studio.classList.contains("show-preview")
  );
}
function syncQuickPreview() {
  document
    .querySelector("#toggle3DPreviewBtn")
    .setAttribute(
      "aria-pressed",
      document.querySelector(".studio").classList.contains("show-preview"),
    );
  const label = isQuickPreview()
    ? "3D preview. Drag to turn your pet. Paint on the coloring sheet."
    : "Your 3D pet. Use Brush to paint, Move to turn. Pinch with two fingers to zoom.";
  vrmCanvas.setAttribute("data-i18n-aria-label", label);
  vrmCanvas.setAttribute("aria-label", t(label));
  window.dispatchEvent(new Event("resize"));
}

function updatePopoverPosition() {
  popoverBrushSize.disabled = !["brush", "softBrush", "eraser"].includes(
    activeTool,
  );
}

function loadGuide(guideUrl = petConfig.guideUrl) {
  if (!guideUrl) {
    guideCtx.clearRect(0, 0, guideCanvas.width, guideCanvas.height);
    return;
  }
  const guideImage = new Image();
  guideImage.onload = () => {
    guideCtx.clearRect(0, 0, guideCanvas.width, guideCanvas.height);
    guideCtx.drawImage(guideImage, 0, 0, guideCanvas.width, guideCanvas.height);
  };
  guideImage.src = guideUrl;
}

function initPainter() {
  toolButtons.forEach((button) =>
    button.addEventListener("click", () => {
      activeTool = button.dataset.tool;
      toolButtons.forEach((item) => {
        item.classList.toggle("active", item === button);
        item.setAttribute("aria-pressed", item === button);
      });
      localizeText(
        document.querySelector("#gestureHint"),
        activeTool === "move"
          ? "Drag to turn · Two fingers turn & zoom"
          : "One finger paints · Two fingers turn & zoom",
      );
      vrmCanvas.style.cursor = activeTool === "move" ? "grab" : "crosshair";
      paintCanvas.style.cursor = activeTool === "move" ? "grab" : "crosshair";
      updatePopoverPosition();
    }),
  );
  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);
  window.addEventListener("keydown", (e) => {
    if (
      e.target.matches("input,textarea") ||
      !petHubScreen.classList.contains("hidden") ||
      !personalityModal.classList.contains("hidden")
    )
      return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    }
  });
  const chooseColor = (color) => {
    activeColor = color;
    colorWheelInput.value = color;
    presetColors.forEach((btn) =>
      btn.setAttribute("aria-pressed", btn.dataset.color === color),
    );
  };
  colorWheelInput.addEventListener("input", () =>
    chooseColor(colorWheelInput.value),
  );
  presetColors.forEach((btn) =>
    btn.addEventListener("click", () => chooseColor(btn.dataset.color)),
  );
  chooseColor(activeColor);
  clearButton.addEventListener("click", () => {
    paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    updateEditableTexture();
    pushHistoryState();
    notify("Colors cleared. Undo brings them back.");
  });
  init2DCanvasZoom();
  initMirrorMode();
}

// ----------------------------------------------------
// 2D Canvas Zoom & Pan Logic
// ----------------------------------------------------
function applyCanvasTransform() {
  const bound = Math.max(
    0,
    (canvasTransformWrapper.offsetWidth * (canvasZoom - 1)) / 2,
  );
  canvasPanX = Math.max(-bound, Math.min(bound, canvasPanX));
  canvasPanY = Math.max(-bound, Math.min(bound, canvasPanY));
  canvasTransformWrapper.style.transform = `translate(${canvasPanX}px, ${canvasPanY}px) scale(${canvasZoom})`;
  // Keep the drag handle visible and touch-sized when the sheet is zoomed.
  const sheetRect = paintCanvas.getBoundingClientRect();
  const viewportRect = canvasContainer.getBoundingClientRect();
  symmetryLine.style.setProperty(
    "--handle-top",
    `${Math.max(12, viewportRect.top - sheetRect.top + 12) / canvasZoom}px`,
  );
  symmetryLine.style.setProperty("--handle-scale", 1 / canvasZoom);
}
function init2DCanvasZoom() {
  const fit = () => {
    const size = Math.min(
      canvasContainer.clientWidth,
      canvasContainer.clientHeight,
    );
    if (size > 0) {
      canvasTransformWrapper.style.width = size + "px";
      canvasTransformWrapper.style.height = size + "px";
    }
    applyCanvasTransform();
  };
  new ResizeObserver(fit).observe(canvasContainer);
  window.addEventListener("resize", fit);
  const zoom = (ratio, x, y) => {
    const rect = canvasContainer.getBoundingClientRect();
    const cx = x - rect.left - rect.width / 2;
    const cy = y - rect.top - rect.height / 2;
    const next = Math.max(1, Math.min(5, canvasZoom * ratio));
    canvasPanX = cx - ((cx - canvasPanX) * next) / canvasZoom;
    canvasPanY = cy - ((cy - canvasPanY) * next) / canvasZoom;
    canvasZoom = next;
    applyCanvasTransform();
  };
  canvasContainer.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom(Math.exp(-e.deltaY * 0.001), e.clientX, e.clientY);
    },
    { passive: false },
  );
  zoom2DInBtn.addEventListener("click", () => {
    canvasZoom = Math.min(5, canvasZoom * 1.3);
    applyCanvasTransform();
  });
  zoom2DOutBtn.addEventListener("click", () => {
    canvasZoom = Math.max(1, canvasZoom / 1.3);
    applyCanvasTransform();
  });
  reset2DBtn.addEventListener("click", () => {
    canvasZoom = 1;
    canvasPanX = canvasPanY = 0;
    applyCanvasTransform();
  });
  attachSurfaceGestures(paintCanvas, {
    shouldNavigate: (e) =>
      activeTool === "move" || e.button !== 0 || e.shiftKey,
    start: (e) => beginSurfaceStroke(getCanvasPoint(e), "sheet"),
    move: (e) => moveSurfaceStroke(getCanvasPoint(e), "sheet"),
    end: finishSurfaceStroke,
    cancel: cancelSurfaceStroke,
    navigate: ({ dx, dy, ratio, x, y }) => {
      zoom(ratio, x, y);
      canvasPanX += dx;
      canvasPanY += dy;
      applyCanvasTransform();
    },
  });
}

// ----------------------------------------------------
// Mirror Mode Logic
// ----------------------------------------------------
function initMirrorMode() {
  toggleMirrorBtn.addEventListener("click", () => {
    isMirrorMode = !isMirrorMode;
    toggleMirrorBtn.setAttribute("aria-pressed", isMirrorMode);
    symmetryLine.classList.toggle("hidden", !isMirrorMode);
    if (isMirrorMode && compactStudio.matches) toggle2DBtn.click();
    notify(
      isMirrorMode
        ? "Mirror on: paint both sides of the sheet."
        : "Mirror off.",
    );
  });
  let pointerId = null;
  let startX = symmetryX;
  let offsetX = 0;
  symmetryLine.addEventListener("pointerdown", (event) => {
    if (pointerId !== null || event.button !== 0) return;
    event.preventDefault();
    cancelSurfaceStroke();
    pointerId = event.pointerId;
    startX = symmetryX;
    offsetX = symmetryX - getCanvasPoint(event).x;
    symmetryLine.setPointerCapture(pointerId);
    symmetryLine.focus({ preventScroll: true });
  });
  symmetryLine.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    setSymmetryPosition(getCanvasPoint(event).x + offsetX);
  });
  const finish = (event) => {
    if (event.pointerId !== pointerId) return;
    if (event.type === "pointercancel") setSymmetryPosition(startX);
    pointerId = null;
    if (symmetryLine.hasPointerCapture(event.pointerId))
      symmetryLine.releasePointerCapture(event.pointerId);
  };
  symmetryLine.addEventListener("pointerup", finish);
  symmetryLine.addEventListener("pointercancel", finish);
  symmetryLine.addEventListener("lostpointercapture", finish);
  symmetryLine.addEventListener("keydown", (event) => {
    const step = paintCanvas.width * (event.shiftKey ? 0.1 : 0.01);
    const positions = {
      ArrowLeft: symmetryX - step,
      ArrowRight: symmetryX + step,
      Home: 0,
      End: paintCanvas.width,
    };
    if (!(event.key in positions)) return;
    event.preventDefault();
    setSymmetryPosition(positions[event.key]);
  });
}

function setSymmetryPosition(x) {
  symmetryX = Math.max(0, Math.min(paintCanvas.width, x));
  const percent = (symmetryX / paintCanvas.width) * 100;
  symmetryLine.style.left = `${percent}%`;
  symmetryLine.setAttribute("aria-valuenow", Math.round(percent));
}

// ----------------------------------------------------
// Image Upload & Transform Logic
// ----------------------------------------------------
let overlayState = {
  active: false,
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  imgWidth: 0,
  imgHeight: 0,
};

function initImageUpload() {
  const stampActions = document.querySelector(".stamp-actions");
  panel2D.appendChild(stampActions);
  stampActions.classList.add("hidden");
  let imageUrl = null;
  const clearOverlay = () => {
    transformOverlay.classList.add("hidden");
    stampActions.classList.add("hidden");
    overlayState.active = false;
    imageUpload.value = "";
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = null;
  };
  const updateOverlayCSS = () => {
    const unit = canvasTransformWrapper.clientWidth / paintCanvas.width;
    transformOverlay.style.width =
      overlayState.imgWidth * overlayState.scale * unit + "px";
    transformOverlay.style.height =
      overlayState.imgHeight * overlayState.scale * unit + "px";
    transformOverlay.style.left = overlayState.x * unit + "px";
    transformOverlay.style.top = overlayState.y * unit + "px";
    transformOverlay.style.transform = `rotate(${overlayState.rotation}rad)`;
  };
  new ResizeObserver(updateOverlayCSS).observe(canvasTransformWrapper);
  uploadImageBtn.addEventListener("click", () => {
    toggle2DBtn.click();
    document.querySelector(".more-tools").open = false;
    imageUpload.click();
  });
  imageUpload.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      notify("Choose a picture smaller than 10 MB.");
      imageUpload.value = "";
      return;
    }
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      overlayState = {
        active: true,
        x: 256,
        y: 256,
        scale: Math.min(512 / img.width, 512 / img.height),
        rotation: 0,
        imgWidth: img.width,
        imgHeight: img.height,
      };
      overlayImage.src = imageUrl;
      reset2DBtn.click();
      updateOverlayCSS();
      transformOverlay.classList.remove("hidden");
      stampActions.classList.remove("hidden");
    };
    img.onerror = () => {
      clearOverlay();
      notify("That picture could not open. Try a PNG or JPG.");
    };
    img.src = imageUrl;
  });
  let drag = null;
  transformOverlay.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".stamp-actions")) return;
    if (drag) return;
    event.preventDefault();
    event.stopPropagation();
    const mode =
      event.target === handleScale
        ? "scale"
        : event.target === handleRotate
          ? "rotate"
          : "move";
    const rect = paintCanvas.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      mode,
      clientX: event.clientX,
      clientY: event.clientY,
      state: { ...overlayState },
      unit: paintCanvas.width / rect.width,
      centerX:
        rect.left +
        ((overlayState.x + (overlayState.imgWidth * overlayState.scale) / 2) /
          paintCanvas.width) *
          rect.width,
      centerY:
        rect.top +
        ((overlayState.y + (overlayState.imgHeight * overlayState.scale) / 2) /
          paintCanvas.height) *
          rect.height,
    };
    drag.angle = Math.atan2(
      event.clientY - drag.centerY,
      event.clientX - drag.centerX,
    );
    drag.distance = Math.max(
      1,
      Math.hypot(event.clientX - drag.centerX, event.clientY - drag.centerY),
    );
    transformOverlay.setPointerCapture(event.pointerId);
  });
  transformOverlay.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.mode === "move") {
      const w = overlayState.imgWidth * overlayState.scale,
        h = overlayState.imgHeight * overlayState.scale;
      overlayState.x = Math.max(
        -w / 2,
        Math.min(
          1024 - w / 2,
          drag.state.x + (event.clientX - drag.clientX) * drag.unit,
        ),
      );
      overlayState.y = Math.max(
        -h / 2,
        Math.min(
          1024 - h / 2,
          drag.state.y + (event.clientY - drag.clientY) * drag.unit,
        ),
      );
    } else if (drag.mode === "rotate") {
      overlayState.rotation =
        drag.state.rotation +
        Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX) -
        drag.angle;
    } else {
      const ratio = Math.max(
        0.2,
        Math.min(
          3,
          Math.hypot(
            event.clientX - drag.centerX,
            event.clientY - drag.centerY,
          ) / drag.distance,
        ),
      );
      overlayState.scale = drag.state.scale * ratio;
      overlayState.x =
        drag.state.x +
        (overlayState.imgWidth * (drag.state.scale - overlayState.scale)) / 2;
      overlayState.y =
        drag.state.y +
        (overlayState.imgHeight * (drag.state.scale - overlayState.scale)) / 2;
    }
    updateOverlayCSS();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    transformOverlay.addEventListener(type, (event) => {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      if (transformOverlay.hasPointerCapture(event.pointerId))
        transformOverlay.releasePointerCapture(event.pointerId);
    });
  cancelImageBtn.addEventListener("click", clearOverlay);
  commitImageBtn.addEventListener("click", () => {
    const w = overlayState.imgWidth * overlayState.scale,
      h = overlayState.imgHeight * overlayState.scale;
    paintCtx.save();
    paintCtx.translate(overlayState.x + w / 2, overlayState.y + h / 2);
    paintCtx.rotate(overlayState.rotation);
    paintCtx.drawImage(overlayImage, -w / 2, -h / 2, w, h);
    paintCtx.restore();
    updateEditableTexture();
    pushHistoryState();
    clearOverlay();
    notify("Picture stamped!");
  });
}

// ----------------------------------------------------
// Core Painting Logic
// ----------------------------------------------------
function beginSurfaceStroke(point, surface) {
  if (overlayState.active || strokeSnapshot) return;
  strokeSnapshot = paintCtx.getImageData(
    0,
    0,
    paintCanvas.width,
    paintCanvas.height,
  );
  strokeSurface = surface;
  strokeChanged = false;
  drawing = true;
  lastPoint = point;

  currentStrokeBrushSize = Number(popoverBrushSize.value) || 10;
  if (activeTool !== "softBrush" && activeTool !== "fill") {
    paintCtx.globalCompositeOperation =
      activeTool === "eraser" ? "destination-out" : "source-over";
    paintCtx.strokeStyle = activeColor;
    paintCtx.fillStyle = activeColor;
    paintCtx.lineWidth = currentStrokeBrushSize;
    paintCtx.lineCap = "round";
    paintCtx.lineJoin = "round";
  }

  if (!point) return;
  strokeChanged = true;
  if (activeTool === "fill") {
    floodFill(Math.floor(point.x), Math.floor(point.y));
    if (isMirrorMode)
      floodFill(Math.floor(symmetryX * 2 - point.x), Math.floor(point.y));
  } else drawPoint(point);
}
function moveSurfaceStroke(point, surface) {
  if (!drawing || strokeSurface !== surface || activeTool === "fill") return;
  if (point) {
    strokeChanged = true;
    if (
      !lastPoint ||
      (surface === "model" &&
        Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) > 50)
    )
      drawPoint(point);
    else drawStroke(lastPoint, point);
    textureUpdatePending = true;
  }
  lastPoint = point;
}
function finishSurfaceStroke() {
  if (textureUpdatePending) updateEditableTexture();
  if (strokeChanged) pushHistoryState();
  drawing = false;
  lastPoint = null;
  strokeSnapshot = null;
  strokeChanged = false;
  strokeSurface = null;
  paintCtx.globalCompositeOperation = "source-over";
}
function cancelSurfaceStroke() {
  if (strokeSnapshot) {
    paintCtx.putImageData(strokeSnapshot, 0, 0);
    updateEditableTexture();
  }
  drawing = false;
  lastPoint = null;
  strokeSnapshot = null;
  strokeChanged = false;
  strokeSurface = null;
  paintCtx.globalCompositeOperation = "source-over";
}

function drawPoint(point) {
  const size = currentStrokeBrushSize || Number(popoverBrushSize.value) || 10;
  if (activeTool === "softBrush") {
    stampSoftBrush(point, size);
    if (isMirrorMode) {
      stampSoftBrush({ x: symmetryX * 2 - point.x, y: point.y }, size);
    }
    textureUpdatePending = true;
    return;
  }

  const drawAt = (p) => {
    paintCtx.beginPath();
    paintCtx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
    paintCtx.fill();
  };

  drawAt(point);
  if (isMirrorMode) {
    drawAt({ x: symmetryX * 2 - point.x, y: point.y });
  }

  textureUpdatePending = true;
}

function drawStroke(from, to) {
  const size = currentStrokeBrushSize || Number(popoverBrushSize.value) || 10;
  if (activeTool === "softBrush") {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(4, size * 0.22)));
    paintCtx.save();
    paintCtx.globalCompositeOperation = "source-over";
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const pt = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      };
      stampSoftBrush(pt, size);
      if (isMirrorMode) {
        stampSoftBrush({ x: symmetryX * 2 - pt.x, y: pt.y }, size);
      }
    }
    paintCtx.restore();
    return;
  }

  const drawLine = (p1, p2) => {
    paintCtx.beginPath();
    paintCtx.moveTo(p1.x, p1.y);
    paintCtx.lineTo(p2.x, p2.y);
    paintCtx.stroke();
  };

  drawLine(from, to);
  if (isMirrorMode) {
    drawLine(
      { x: symmetryX * 2 - from.x, y: from.y },
      { x: symmetryX * 2 - to.x, y: to.y },
    );
  }
}

function stampSoftBrush(point, size) {
  const radius = size * 0.72;
  const gradient = paintCtx.createRadialGradient(
    point.x,
    point.y,
    0,
    point.x,
    point.y,
    radius,
  );
  gradient.addColorStop(0, hexToRgba(activeColor, 0.34));
  gradient.addColorStop(0.55, hexToRgba(activeColor, 0.17));
  gradient.addColorStop(1, hexToRgba(activeColor, 0));
  paintCtx.fillStyle = gradient;
  paintCtx.beginPath();
  paintCtx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  paintCtx.fill();
}

function getCanvasPoint(event) {
  const rect = paintCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * paintCanvas.width,
    y: ((event.clientY - rect.top) / rect.height) * paintCanvas.height,
  };
}

function updateEditableTexture() {
  textureUpdatePending = false;
  exportCtx.fillStyle = "#ffffff";
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  exportCtx.drawImage(paintCanvas, 0, 0);
  if (editableTexture) editableTexture.needsUpdate = true;
}

function initHistory() {
  historyStack = [
    paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height),
  ];
  historyIndex = 0;
  updateUndoRedoUI();
}

function pushHistoryState() {
  dirty = true;
  if (historyIndex < historyStack.length - 1) {
    historyStack = historyStack.slice(0, historyIndex + 1);
  }
  historyStack.push(
    paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height),
  );
  if (historyStack.length > MAX_HISTORY) {
    historyStack.shift();
  }
  historyIndex = historyStack.length - 1;
  updateUndoRedoUI();
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  dirty = true;
  const targetState = historyStack[historyIndex];
  paintCtx.putImageData(targetState, 0, 0);
  updateEditableTexture();
  updateUndoRedoUI();
}

function redo() {
  if (historyIndex >= historyStack.length - 1) return;
  historyIndex++;
  dirty = true;
  const targetState = historyStack[historyIndex];
  paintCtx.putImageData(targetState, 0, 0);
  updateEditableTexture();
  updateUndoRedoUI();
}

function updateUndoRedoUI() {
  if (undoBtn) {
    const canUndo = historyIndex > 0;
    undoBtn.disabled = !canUndo;
    undoBtn.classList.toggle("opacity-40", !canUndo);
    undoBtn.classList.toggle("cursor-not-allowed", !canUndo);
    undoBtn.classList.toggle("pointer-events-none", !canUndo);
  }
  if (redoBtn) {
    const canRedo = historyIndex < historyStack.length - 1;
    redoBtn.disabled = !canRedo;
    redoBtn.classList.toggle("opacity-40", !canRedo);
    redoBtn.classList.toggle("cursor-not-allowed", !canRedo);
    redoBtn.classList.toggle("pointer-events-none", !canRedo);
  }
}

function floodFill(startX, startY) {
  if (
    startX < 0 ||
    startY < 0 ||
    startX >= paintCanvas.width ||
    startY >= paintCanvas.height
  )
    return;
  const compCanvas = document.createElement("canvas");
  const width = 1024;
  const height = 1024;
  compCanvas.width = width;
  compCanvas.height = height;
  const compCtx = compCanvas.getContext("2d", { willReadFrequently: true });

  compCtx.fillStyle = "#ffffff";
  compCtx.fillRect(0, 0, width, height);
  compCtx.drawImage(guideCanvas, 0, 0);
  compCtx.drawImage(paintCanvas, 0, 0);

  const imgData = compCtx.getImageData(0, 0, width, height);
  const data = new Uint32Array(imgData.data.buffer);

  const fillR = parseInt(activeColor.slice(1, 3), 16);
  const fillG = parseInt(activeColor.slice(3, 5), 16);
  const fillB = parseInt(activeColor.slice(5, 7), 16);
  const fillPixel = (255 << 24) | (fillB << 16) | (fillG << 8) | fillR;

  const startPos = startY * width + startX;
  const targetColor = data[startPos];

  if (targetColor === fillPixel) return;

  const outImgData = paintCtx.getImageData(0, 0, width, height);
  const outData = new Uint32Array(outImgData.data.buffer);

  function colorMatch(a, b) {
    const r1 = a & 0xff,
      g1 = (a >> 8) & 0xff,
      b1 = (a >> 16) & 0xff;
    const r2 = b & 0xff,
      g2 = (b >> 8) & 0xff,
      b2 = (b >> 16) & 0xff;
    return (
      Math.abs(r1 - r2) < 50 && Math.abs(g1 - g2) < 50 && Math.abs(b1 - b2) < 50
    );
  }

  const queue = new Uint32Array(width * height);
  const visited = new Uint8Array(width * height);
  queue[0] = startPos;
  visited[startPos] = 1;
  let head = 0;
  let tail = 1;

  while (head < tail) {
    const pos = queue[head++];
    outData[pos] = fillPixel;

    const x = pos % width;
    const y = Math.floor(pos / width);

    if (x > 0) {
      const p = pos - 1;
      if (!visited[p] && colorMatch(data[p], targetColor)) {
        visited[p] = 1;
        queue[tail++] = p;
      }
    }
    if (x < width - 1) {
      const p = pos + 1;
      if (!visited[p] && colorMatch(data[p], targetColor)) {
        visited[p] = 1;
        queue[tail++] = p;
      }
    }
    if (y > 0) {
      const p = pos - width;
      if (!visited[p] && colorMatch(data[p], targetColor)) {
        visited[p] = 1;
        queue[tail++] = p;
      }
    }
    if (y < height - 1) {
      const p = pos + width;
      if (!visited[p] && colorMatch(data[p], targetColor)) {
        visited[p] = 1;
        queue[tail++] = p;
      }
    }
  }

  let currentEdges = new Uint32Array(queue.buffer, 0, tail);
  let edgeCount = tail;
  const BLEED_AMOUNT = 2;

  for (let bleed = 0; bleed < BLEED_AMOUNT; bleed++) {
    let nextEdges = new Uint32Array(edgeCount * 4);
    let nextCount = 0;
    for (let i = 0; i < edgeCount; i++) {
      const pos = currentEdges[i];

      if (pos % width > 0) {
        const p = pos - 1;
        if (!visited[p]) {
          visited[p] = 1;
          outData[p] = fillPixel;
          nextEdges[nextCount++] = p;
        }
      }
      if (pos % width < width - 1) {
        const p = pos + 1;
        if (!visited[p]) {
          visited[p] = 1;
          outData[p] = fillPixel;
          nextEdges[nextCount++] = p;
        }
      }
      if (pos >= width) {
        const p = pos - width;
        if (!visited[p]) {
          visited[p] = 1;
          outData[p] = fillPixel;
          nextEdges[nextCount++] = p;
        }
      }
      if (pos < width * (height - 1)) {
        const p = pos + width;
        if (!visited[p]) {
          visited[p] = 1;
          outData[p] = fillPixel;
          nextEdges[nextCount++] = p;
        }
      }
    }
    currentEdges = nextEdges;
    edgeCount = nextCount;
  }

  paintCtx.putImageData(outImgData, 0, 0);
  updateEditableTexture();
}

// ----------------------------------------------------
// 3D VRM & Rendering Logic
// ----------------------------------------------------
function animateLoop() {
  if (!isPainterRunning) return;
  animFrameId = requestAnimationFrame(animateLoop);
  const delta = clock.getDelta();
  if (textureUpdatePending) updateEditableTexture();
  if (currentVrm && !drawing) currentVrm.update(delta);
  if (threeControls) threeControls.update();
  if (threeRenderer && threeScene && threeCamera) {
    threeRenderer.render(threeScene, threeCamera);
  }
}

function pausePainterScene() {
  isPainterRunning = false;
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

function resumePainterScene() {
  if (isPainterRunning) return;
  isPainterRunning = true;
  clock.start();
  animateLoop();
  setTimeout(() => window.dispatchEvent(new Event("resize")), 20);
}

async function loadVrmModel(modelUrl) {
  if (!threeScene || !modelUrl) return;
  if (currentVrm && currentVrmModelUrl === modelUrl) return;

  const loadToken = ++modelLoadToken;
  const status = document.querySelector("#modelStatus");
  status.classList.remove("hidden");
  localizeText(status, "Getting your friend ready…");
  if (currentVrm) {
    disposeRaycastProxies();
    threeScene.remove(currentVrm.scene);
    VRMUtils.deepDispose(currentVrm.scene);
    currentVrm = null;
    editableTexture = null;
  }

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  try {
    const gltf = await loader.loadAsync(modelUrl);
    if (loadToken !== modelLoadToken) {
      VRMUtils.deepDispose(gltf.scene);
      return;
    }
    currentVrm = gltf.userData.vrm;
    currentVrmModelUrl = modelUrl;
    VRMUtils.removeUnnecessaryVertices(currentVrm.scene);
    VRMUtils.removeUnnecessaryJoints(currentVrm.scene);

    threeScene.add(currentVrm.scene);
    if (threeCamera && threeControls) {
      frameModel(currentVrm.scene, threeCamera, threeControls);
    }
    applyEditableTexture(currentVrm.scene);
    buildRaycastProxies(currentVrm.scene);
    status.classList.add("hidden");
  } catch (err) {
    delete status.dataset.i18n;
    const errorLabel = document.createElement("span");
    localizeText(errorLabel, "Your friend didn’t load.");
    status.replaceChildren(errorLabel, " ");
    const retry = document.createElement("button");
    localizeText(retry, "Try again");
    retry.addEventListener("click", () => loadVrmModel(modelUrl));
    status.append(retry);
  }
}

async function initVrm() {
  if (
    !vrmCanvas ||
    typeof window === "undefined" ||
    !window.WebGLRenderingContext
  )
    return;
  const scene = new THREE.Scene();
  scene.background = currentBackgroundId
    ? null
    : new THREE.Color(bgColorPicker.value);
  rightPanelSection.style.backgroundColor = bgColorPicker.value;

  const renderer = new THREE.WebGLRenderer({
    canvas: vrmCanvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.2, 3.1);

  const controls = new OrbitControls(camera, vrmCanvas);
  configureOrbitControls(controls, THREE);
  controls.target.set(0, 0.9, 0);
  controls.minDistance = 0.6;
  controls.maxDistance = 8;
  controls.update();

  threeScene = scene;
  threeRenderer = renderer;
  threeCamera = camera;
  threeControls = controls;

  scene.add(new THREE.AmbientLight(0xffffff, 1.7));
  const light = new THREE.DirectionalLight(0xffffff, 1.7);
  light.position.set(2, 4, 2);
  scene.add(light);

  if (petConfig.baseModelUrl) {
    await loadVrmModel(petConfig.baseModelUrl);
  }

  const resize = () => {
    if (!vrmCanvas.parentElement) return;
    const rect = vrmCanvas.parentElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / Math.max(1, rect.height);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(vrmCanvas.parentElement);
  resize();

  clock.start();
  if (isPainterRunning && !animFrameId) animateLoop();

  // Viewport Nav
  const viewBtns = document.querySelectorAll(".view-btn");
  viewBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!currentVrm) return;
      const view = btn.dataset.view;
      const box = new THREE.Box3().setFromObject(currentVrm.scene);
      const size = box.getSize(new THREE.Vector3());
      const centerY = size.y * 0.52;
      const dist = Math.max(2.3, size.y * 1.8);

      controls.target.set(0, centerY, 0);

      if (view === "front") camera.position.set(0, centerY, dist);
      else if (view === "right") camera.position.set(dist, centerY, 0);
      else if (view === "back") camera.position.set(0, centerY, -dist);
      else if (view === "top") camera.position.set(0, centerY + dist, 0.1);

      controls.update();
    });
  });

  // Quick Camera Helpers (Center & Step Zoom)
  const centerBtn = document.querySelector("#centerCameraBtn");
  if (centerBtn) {
    centerBtn.addEventListener("click", () => {
      if (!currentVrm || !camera || !controls) return;
      frameModel(currentVrm.scene, camera, controls);
    });
  }

  const zoomInBtn = document.querySelector("#zoomInBtn");
  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => {
      if (!camera || !controls) return;
      const dir = new THREE.Vector3().subVectors(
        camera.position,
        controls.target,
      );
      if (dir.length() > 0.8) {
        dir.multiplyScalar(0.8);
        camera.position.copy(controls.target).add(dir);
        controls.update();
      }
    });
  }

  const zoomOutBtn = document.querySelector("#zoomOutBtn");
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => {
      if (!camera || !controls) return;
      const dir = new THREE.Vector3().subVectors(
        camera.position,
        controls.target,
      );
      if (dir.length() < 10) {
        dir.multiplyScalar(1.25);
        camera.position.copy(controls.target).add(dir);
        controls.update();
      }
    });
  }

  let cachedCanvasRect = null;
  function getVrmCanvasRect() {
    if (!cachedCanvasRect) {
      cachedCanvasRect = vrmCanvas.getBoundingClientRect();
    }
    return cachedCanvasRect;
  }
  function invalidateCanvasRect() {
    cachedCanvasRect = null;
  }
  window.addEventListener("resize", invalidateCanvasRect);
  window.addEventListener("scroll", invalidateCanvasRect, true);

  // Own all surface pointer gestures so OrbitControls cannot rotate beneath a stroke.
  // Wheel and keyboard-independent camera helpers still use OrbitControls.
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const raycastHits = [];
  const pointAt = (event) => {
    const uv = getUvFromRaycast(event);
    return uv ? uvToCanvasPoint(uv) : null;
  };
  const projectedStroke = createProjectedStroke({
    project: pointAt,
    start: (point) => beginSurfaceStroke(point, "model"),
    move: (point) => moveSurfaceStroke(point, "model"),
    finish: finishSurfaceStroke,
    cancel: cancelSurfaceStroke,
    spacing: 5,
    maxSteps: 32,
  });
  attachSurfaceGestures(vrmCanvas, {
    shouldNavigate: (e) =>
      isQuickPreview() || activeTool === "move" || e.button !== 0 || e.shiftKey,
    start: (e) => {
      invalidateCanvasRect();
      projectedStroke.start(e);
    },
    move: (e) => projectedStroke.move(e),
    end: (e) => {
      projectedStroke.end(e);
      invalidateCanvasRect();
    },
    cancel: () => {
      projectedStroke.cancel();
      invalidateCanvasRect();
    },
    navigate: ({ dx, dy, ratio }) => {
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= dx * 0.008;
      spherical.phi = Math.max(
        0.15,
        Math.min(Math.PI - 0.15, spherical.phi - dy * 0.008),
      );
      spherical.radius = Math.max(0.6, Math.min(8, spherical.radius / ratio));
      camera.position
        .copy(controls.target)
        .add(new THREE.Vector3().setFromSpherical(spherical));
      controls.update();
    },
  });

  function getUvFromRaycast(event) {
    if (!currentVrm || !vrmRaycastProxies.length) return null;
    const rect = getVrmCanvasRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    raycastHits.length = 0;
    raycaster.intersectObjects(vrmRaycastProxies, false, raycastHits);
    return pickPaintIntersection(raycastHits, isPaintableMaterial)?.uv || null;
  }

  function uvToCanvasPoint(uv) {
    const yFlip =
      petConfig && petConfig.flipY !== undefined ? petConfig.flipY : false;
    return {
      x: uv.x * paintCanvas.width,
      y: (yFlip ? 1 - uv.y : uv.y) * paintCanvas.height,
    };
  }
}

function applyEditableTexture(root) {
  editableTexture = new THREE.CanvasTexture(exportCanvas);
  editableTexture.colorSpace = THREE.SRGBColorSpace;
  const yFlip =
    petConfig && petConfig.flipY !== undefined ? petConfig.flipY : false;
  editableTexture.flipY = yFlip;
  editableTexture.needsUpdate = true;

  root.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    const nextMaterials = materials.map((material) => {
      if (!material) return material;
      if (!isPaintableMaterial(material.name)) return material;

      const paintedMaterial = material.clone();
      paintedMaterial.map = editableTexture;
      paintedMaterial.name = `${material.name}_FlatPaint`;

      // Update MToon shade textures so paint shows in shadows too
      if (paintedMaterial.shadeMultiplyTexture !== undefined) {
        paintedMaterial.shadeMultiplyTexture = editableTexture;
      }
      if (paintedMaterial.shadeTexture !== undefined) {
        paintedMaterial.shadeTexture = editableTexture;
      }

      // If the original material relied on a dark texture for shadow color (i.e. shadeColorFactor was white),
      // we must provide a darker shade color because our new texture has a white background.
      if (paintedMaterial.shadeColorFactor !== undefined) {
        if (
          paintedMaterial.shadeColorFactor.r > 0.9 &&
          paintedMaterial.shadeColorFactor.g > 0.9 &&
          paintedMaterial.shadeColorFactor.b > 0.9
        ) {
          paintedMaterial.shadeColorFactor.setHex(0xb0b0b0); // soft grey shadow
        }
      } else if (paintedMaterial.shadeColor !== undefined) {
        if (
          paintedMaterial.shadeColor.r > 0.9 &&
          paintedMaterial.shadeColor.g > 0.9 &&
          paintedMaterial.shadeColor.b > 0.9
        ) {
          paintedMaterial.shadeColor.setHex(0xb0b0b0);
        }
      }

      paintedMaterial.needsUpdate = true;
      return paintedMaterial;
    });
    object.material = Array.isArray(object.material)
      ? nextMaterials
      : nextMaterials[0];
  });
  updateEditableTexture();
}

function buildRaycastProxies(root) {
  disposeRaycastProxies();
  vrmRaycastProxies = [];

  if (currentVrm) {
    currentVrm.update(0);
  }
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton) {
      o.skeleton.update();
    }
  });

  root.traverse((object) => {
    if (!object.isMesh || !object.visible) return;

    if (!object.isSkinnedMesh) {
      vrmRaycastProxies.push(object);
      return;
    }

    const geometry = object.geometry;
    const posAttr = geometry?.attributes?.position;
    if (!posAttr) return;

    const count = posAttr.count;
    const positions = new Float32Array(count * 3);
    const target = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      object.getVertexPosition(i, target);
      positions[i * 3] = target.x;
      positions[i * 3 + 1] = target.y;
      positions[i * 3 + 2] = target.z;
    }

    const proxyGeometry = new THREE.BufferGeometry();
    proxyGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    if (geometry.attributes.uv) {
      proxyGeometry.setAttribute("uv", geometry.attributes.uv);
    }
    if (geometry.index) {
      proxyGeometry.setIndex(geometry.index);
    }
    if (geometry.groups && geometry.groups.length) {
      for (const group of geometry.groups) {
        proxyGeometry.addGroup(group.start, group.count, group.materialIndex);
      }
    }
    proxyGeometry.computeBoundingSphere();
    proxyGeometry.computeBoundingBox();

    const proxyMesh = new THREE.Mesh(proxyGeometry, object.material);
    proxyMesh.name = `${object.name}_RaycastProxy`;
    proxyMesh.originalMesh = object;
    proxyMesh.matrix = object.matrix;
    proxyMesh.matrixWorld = object.matrixWorld;
    proxyMesh.matrixAutoUpdate = false;

    Object.defineProperty(proxyMesh, "visible", {
      get() {
        return object.visible;
      },
      set(val) {
        object.visible = val;
      },
    });
    Object.defineProperty(proxyMesh, "material", {
      get() {
        return object.material;
      },
      set(val) {
        object.material = val;
      },
    });

    vrmRaycastProxies.push(proxyMesh);
  });
  vrmPaintMeshes = vrmRaycastProxies;
}

function disposeRaycastProxies() {
  for (const proxy of vrmRaycastProxies) {
    if (proxy.geometry && proxy !== proxy.originalMesh) {
      proxy.geometry.dispose();
    }
  }
  vrmRaycastProxies = [];
  vrmPaintMeshes = vrmRaycastProxies;
}

function frameModel(root, camera, controls) {
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  root.position.sub(center);
  root.position.y += size.y / 2;
  controls.target.set(0, size.y * 0.52, 0);
  camera.position.set(0, size.y * 0.55, Math.max(2.3, size.y * 1.8));
  controls.update();
}

function hexToRgba(hex, alpha) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function notify(message) {
  const toast = document.querySelector("#toast");
  localizeText(toast, message);
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 4500);
}
function setBackground(color, id = null) {
  const resolved = normalizeBackground(color);
  currentBackgroundId = normalizeBackgroundId(id);
  bgColorPicker.value = resolved;
  applyBackdrop(rightPanelSection, resolved, currentBackgroundId);
  applyBackdrop(
    document.querySelector("#backdropSwatch"),
    resolved,
    currentBackgroundId,
  );
  document.querySelector("#solidBackdropSwatch").style.backgroundColor =
    resolved;
  document.querySelectorAll("[data-backdrop]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      (button.dataset.backdrop || null) === currentBackgroundId,
    );
  });
  if (threeScene)
    threeScene.background = currentBackgroundId
      ? null
      : new THREE.Color(resolved);
}

function initBackdropPicker() {
  const picker = document.querySelector("#backdropPicker");
  const toggle = document.querySelector("#backdropToggle");
  const options = document.querySelector("#backdropOptions");
  for (const background of [{ id: "", label: "Solid color" }, ...BACKGROUNDS]) {
    const button = document.createElement("button");
    button.className = "backdrop-option";
    button.dataset.backdrop = background.id;
    const swatch = document.createElement("span");
    swatch.className = "backdrop-thumbnail";
    swatch.setAttribute("aria-hidden", "true");
    if (!background.id) swatch.id = "solidBackdropSwatch";
    else swatch.style.backgroundImage = `url("${background.url}")`;
    const label = document.createElement("span");
    localizeText(label, background.label);
    button.append(swatch, label);
    button.addEventListener("click", () => {
      setBackground(bgColorPicker.value, background.id);
      dirty = true;
      picker.hidePopover();
    });
    options.append(button);
  }
  bgColorPicker.addEventListener("input", () => {
    setBackground(bgColorPicker.value);
    dirty = true;
  });
  const position = () => {
    if (!picker.matches(":popover-open")) return;
    const anchor = toggle.getBoundingClientRect();
    picker.style.left = `${Math.max(8, Math.min(innerWidth - picker.offsetWidth - 8, anchor.right - picker.offsetWidth))}px`;
    picker.style.top = `${Math.max(8, Math.min(innerHeight - picker.offsetHeight - 8, anchor.top - picker.offsetHeight - 8))}px`;
  };
  picker.addEventListener("toggle", position);
  new ResizeObserver(position).observe(picker);
  window.addEventListener("resize", position);
  setBackground(bgColorPicker.value);
}
function resetStudio() {
  document.querySelector(".studio").classList.remove("show-preview");
  syncQuickPreview();
  cancelSurfaceStroke();
  cancelImageBtn.click();
  overlayState.active = false;
  transformOverlay.classList.add("hidden");
  canvasZoom = 1;
  canvasPanX = canvasPanY = 0;
  applyCanvasTransform();
  isMirrorMode = false;
  setSymmetryPosition(paintCanvas.width / 2);
  toggleMirrorBtn.setAttribute("aria-pressed", "false");
  symmetryLine.classList.add("hidden");
  document.querySelector('.tool[data-tool="brush"]').click();
  document.querySelector(".more-tools").open = false;
  toggle3DBtn.click();
}
function initPromptWorkshop() {
  const promptName = document.querySelector("#promptPetName");
  promptName.addEventListener("input", () => {
    currentPetName = promptName.value.trim() || "Momo";
    nameInput.value = currentPetName;
    personalityPetName.textContent = currentPetName;
    localizeText(userNameDisplay, "{name}'s Studio", { name: currentPetName });
    dirty = true;
    renderPromptRecipe();
    if (!document.querySelector("#promptExample").classList.contains("hidden"))
      document.querySelector("#tryPromptBtn").click();
  });
  promptName.addEventListener("blur", () => {
    promptName.value = currentPetName;
  });
  const containers = {
    gender: "#genderChoices",
    vibe: "#vibeChoices",
    activity: "#activityChoices",
    style: "#styleChoices",
  };
  for (const [key, choices] of Object.entries(PROMPT_CHOICES)) {
    const group = document.querySelector(containers[key]);
    for (const choice of choices) {
      const button = document.createElement("button");
      button.className = "choice";
      button.setAttribute("aria-label", choice.label);
      button.dataset.category = key;
      button.dataset.choice = choice.id;
      button.innerHTML = `<span class="choice-emoji" aria-hidden="true">${choice.emoji}</span><span><strong>${choice.label}</strong>${choice.detail ? `<small>${choice.detail}</small>` : ""}</span>`;
      button.addEventListener("click", () => {
        currentRecipe[key] = choice.id;
        document.querySelector("#promptExample").classList.add("hidden");
        renderPromptRecipe();
      });
      group.appendChild(button);
    }
  }
  document.querySelector("#customPromptBtn").addEventListener("click", () => {
    const area = document.querySelector("#customPromptArea");
    const expanded = area.classList.contains("hidden");
    area.classList.toggle("hidden", !expanded);
    document
      .querySelector("#customPromptBtn")
      .setAttribute("aria-expanded", expanded);
    if (expanded) personalityInput.focus();
  });
  personalityInput.addEventListener("input", () => {
    currentRecipe.custom = personalityInput.value;
    renderPromptRecipe();
  });
  document.querySelector("#tryPromptBtn").addEventListener("click", () => {
    const example = document.querySelector("#promptExample");
    example.replaceChildren();
    const label = document.createElement("small");
    localizeText(label, "PRACTICE PREVIEW · A SAMPLE, NOT A LIVE AI REPLY");
    example.append(
      label,
      document.createTextNode(
        samplePrompt(currentPetName, currentRecipe, getLanguage()),
      ),
    );
    if (currentRecipe.custom.trim()) {
      const note = document.createElement("p");
      note.className = "input-caption";
      localizeText(
        note,
        "Your extra idea will be tried when you talk to your pet.",
      );
      example.appendChild(note);
    }
    example.classList.remove("hidden");
  });
}
function renderPromptRecipe() {
  document.querySelectorAll(".choice").forEach((button) => {
    const key = button.dataset.category;
    const choice = recipeChoice(
      { [key]: button.dataset.choice },
      key,
      getLanguage(),
    );
    button.setAttribute("aria-pressed", currentRecipe[key] === choice.id);
    button.setAttribute("aria-label", choice.label);
    button.querySelector("strong").textContent = choice.label;
    if (choice.detail)
      button.querySelector("small").textContent = choice.detail;
  });
  const recipe = document.querySelector("#promptRecipe");
  recipe.replaceChildren();
  for (const line of promptParts(
    currentPetName,
    activePetType,
    currentRecipe,
    getLanguage(),
  )) {
    const paragraph = document.createElement("p");
    for (const part of line) {
      if (part.mark) {
        const mark = document.createElement("mark");
        mark.textContent = part.text;
        paragraph.append(mark);
      } else paragraph.append(document.createTextNode(part.text));
    }
    recipe.append(paragraph);
  }
}
function openPromptWorkshop() {
  pausePainterScene();
  document.querySelector("#promptPetName").value = currentPetName;
  personalityPetName.textContent = currentPetName;
  personalityInput.value = currentRecipe.custom;
  document
    .querySelector("#customPromptArea")
    .classList.toggle("hidden", !currentRecipe.custom);
  document
    .querySelector("#customPromptBtn")
    .setAttribute("aria-expanded", !!currentRecipe.custom);
  document.querySelector("#promptExample").classList.add("hidden");
  localizeText(
    backToPaintBtn,
    promptOnly ? "← Back to my pets" : "← Back to painting",
  );
  localizeText(savePetBtn, promptOnly ? "Save my ideas" : "Save & say hello →");
  renderPromptRecipe();
  personalityModal.classList.remove("hidden");
  personalityModal.scrollTop = 0;
  closePersonalityBtn.focus({ preventScroll: true });
}
function openPromptOnly(pet) {
  currentRecord = pet;
  currentPetId = pet.id;
  currentPetName = pet.name;
  activePetType = normalizePetType(pet.petType);
  petConfig = getPetConfig(pet.petType, petGender(pet));
  currentPersonalityPrompt = pet.personalityPrompt || "";
  currentRecipe = normalizeRecipe(
    pet.promptRecipe || {
      gender: petGender(pet),
      custom: pet.personalityPrompt,
    },
  );
  promptOnly = true;
  petHubScreen.classList.add("hidden");
  openPromptWorkshop();
}
function closePromptWorkshop() {
  currentRecipe.custom = personalityInput.value;
  personalityModal.classList.add("hidden");
  if (promptOnly) loadPetHub();
  else {
    resumePainterScene();
    nextPersonalityBtn.focus();
  }
}
function initStudioExtras() {
  const moreTools = document.querySelector(".more-tools");
  moreTools.addEventListener("click", (event) => {
    if (event.target.closest("button")) moreTools.open = false;
  });
  document.addEventListener("pointerdown", (event) => {
    if (moreTools.open && !moreTools.contains(event.target))
      moreTools.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && moreTools.open) {
      moreTools.open = false;
      moreTools.querySelector("summary").focus();
    }
  });
  const modalLayers = [
    deleteModal,
    document.querySelector("#leaveModal"),
    savingOverlay,
    talkScreen,
    personalityModal,
    welcomeScreen,
    selectPetTypeScreen,
    petHubScreen,
  ];
  let previousScreen = petHubScreen;
  const syncAccess = () => {
    const active = modalLayers.find(
      (layer) => !layer.classList.contains("hidden"),
    );
    modalLayers.forEach((layer) => {
      layer.inert = layer !== active;
    });
    document.querySelector(".studio").inert = !!active;
    document.querySelector(".studio-header").inert = !!active;
    if (active) document.querySelector("#backdropPicker").hidePopover();
    if (active && active !== previousScreen && active !== petHubScreen)
      requestAnimationFrame(() => {
        if (active.contains(document.activeElement)) return;
        [...active.querySelectorAll("button:not(.language-switch button)")]
          .find((button) => !button.disabled && button.getClientRects().length)
          ?.focus({ preventScroll: true });
      });
    previousScreen = active;
  };
  const screenObserver = new MutationObserver(syncAccess);
  modalLayers.forEach((layer) =>
    screenObserver.observe(layer, {
      attributes: true,
      attributeFilter: ["class"],
    }),
  );
  syncAccess();
  document.querySelectorAll("[data-name]").forEach((button) =>
    button.addEventListener("click", () => {
      nameInput.value = button.dataset.name;
    }),
  );
  popoverBrushSize.addEventListener("input", () => {
    document.querySelector("#brushSizeValue").value = popoverBrushSize.value;
  });
  document
    .querySelector("#stayPaintingBtn")
    .addEventListener("click", () =>
      document.querySelector("#leaveModal").classList.add("hidden"),
    );
  document
    .querySelector("#discardPaintingBtn")
    .addEventListener("click", loadPetHub);
  document.querySelector("#savePaintingBtn").addEventListener("click", () => {
    document.querySelector("#leaveModal").classList.add("hidden");
    if (currentPetId) handleSavePet({ colorsOnly: true });
    else {
      promptOnly = false;
      openPromptWorkshop();
    }
  });
  // iOS still dispatches gesture events even with a fixed viewport.
  for (const type of ["gesturestart", "gesturechange", "gestureend"])
    document.addEventListener(type, (event) => event.preventDefault(), {
      passive: false,
    });
  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelSurfaceStroke();
      pausePainterScene();
    } else if (
      petHubScreen.classList.contains("hidden") &&
      welcomeScreen.classList.contains("hidden") &&
      selectPetTypeScreen.classList.contains("hidden") &&
      personalityModal.classList.contains("hidden") &&
      talkScreen.classList.contains("hidden")
    )
      resumePainterScene();
  });
  document.addEventListener("keydown", (event) => {
    const modal = [
      deleteModal,
      document.querySelector("#leaveModal"),
      personalityModal,
    ].find((el) => !el.classList.contains("hidden"));
    if (!modal) return;
    if (event.key === "Escape") {
      if (modal === deleteModal) closeDeleteModal();
      else if (modal === personalityModal) closePromptWorkshop();
      else modal.classList.add("hidden");
    }
    if (event.key === "Tab") {
      const items = [
        ...modal.querySelectorAll("button,input,textarea,summary"),
      ].filter((el) => !el.disabled && el.getClientRects().length);
      const first = items[0],
        last = items.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !modal.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
}
function watchChatSurface(backgroundColor, launchToken) {
  chatThemeObserver?.disconnect();
  const container = document.querySelector("#chatWidgetContainer");
  const status = document.querySelector("#chatStatus");
  const update = () => {
    if (launchToken !== chatLaunchToken) return;
    // Only inspect the rendered UI. The hosted widget's source is kept opaque.
    localizeChatControls(container);
    const canvas = container.querySelector("canvas");
    if (canvas) {
      localizeText(status, "");
      if (talkControls && talkControls.canvas !== canvas) {
        talkControls.destroy();
        talkControls = null;
      }
      const controls = mountTalkControls({
        canvas,
        tray: document.querySelector("#talkActionTray"),
        hint: document.querySelector("#talkGestureHint"),
        win: window,
      });
      if (controls) talkControls = controls;
    }
  };
  chatThemeObserver = new MutationObserver(update);
  chatThemeObserver.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-label", "title", "placeholder"],
  });
  update();
  setTimeout(() => {
    if (launchToken === chatLaunchToken && !container.querySelector("canvas"))
      localizeText(
        status,
        "Your pet is saved. Chat is taking a little longer. You can return to My pets and try again.",
      );
  }, 20000);
}

// Switching language updates labels and recipes, never the painting or form values.
localizeText(
  document.querySelector("#gestureHint"),
  "One finger paints · Two fingers turn & zoom",
);
localizeText(userNameDisplay, "{name}'s Studio", { name: currentPetName });
initLanguageControls();
renderPromptRecipe();
window.addEventListener("languagechange", async () => {
  if (lastPets) renderPetGrid(lastPets);
  renderPetTypes();
  renderPromptRecipe();
  if (!document.querySelector("#promptExample").classList.contains("hidden"))
    document.querySelector("#tryPromptBtn").click();
  if (activeChatPet && window.ChatWidgetConfig) {
    localizeChatControls(document.querySelector("#chatWidgetContainer"));
    const greetingInstruction = buildChatGreeting(activeChatPet, getLanguage());
    window.ChatWidgetConfig.greetingInstruction = greetingInstruction;
    if (
      window.ChatWidget &&
      typeof window.ChatWidget.updateConfig === "function"
    ) {
      try {
        await window.ChatWidget.updateConfig({
          ...window.ChatWidgetConfig,
          greetingInstruction,
        });
      } catch (err) {
        console.warn("[PaintMomo] updateConfig language update error:", err);
      }
    }
    localizeText(
      document.querySelector("#toast"),
      "New conversations will use {language}.",
      { language: t(getLanguage() === "th" ? "Thai" : "English") },
    );
    document.querySelector("#toast").classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => document.querySelector("#toast").classList.add("hidden"),
      4500,
    );
  }
});
