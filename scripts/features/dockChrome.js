import { MODULE_ID } from "../core/constants.js";
import { t as tPersona } from "./personas/shared.js";
import { t as tLocation } from "./locations/shared.js";
import { openLibraryTab } from "../lib/libraryPicker.js";
import "./personas/picker.js";
import "./locations/picker.js";

const MODE_KEY = "locationDockMode";
const EFFECTS_MODE_KEY = "effectsDockMode";
export const PERSONA_DOCK_SEARCH_KEY = "personaDockSearch";
export const LOCATION_DOCK_SEARCH_KEY = "locationDockSearch";

export function isLocationDockMode() {
  try {
    return !!game.settings.get(MODULE_ID, MODE_KEY);
  } catch {
    return false;
  }
}

export function isEffectsDockMode() {
  try {
    return !!game.settings.get(MODULE_ID, EFFECTS_MODE_KEY);
  } catch {
    return false;
  }
}

export function registerDockChromeSettings() {
  game.settings.register(MODULE_ID, MODE_KEY, { scope: "client", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, EFFECTS_MODE_KEY, { scope: "client", config: false, type: Boolean, default: false });
}

function currentDockTab() {
  if (isEffectsDockMode()) return "effects";
  return isLocationDockMode() ? "scene" : "personas";
}

async function setDockTab(tab) {
  await game.settings.set(MODULE_ID, EFFECTS_MODE_KEY, tab === "effects");
  if (tab !== "effects") await game.settings.set(MODULE_ID, MODE_KEY, tab === "scene");
  globalThis.GinzzzuNPCDock?.rebuild?.();
}

function ensureLibraryButton(root) {
  let button = root.querySelector("#ginzzzu-open-location-library");
  if (button) return button;
  const collapseBtn = root.querySelector("#ginzzzu-npc-collapse");
  if (!collapseBtn) return null;
  button = document.createElement("button");
  button.id = "ginzzzu-open-location-library";
  button.type = "button";
  button.className = "library-btn";
  button.title = tLocation("openLibrary");
  button.innerHTML = '<i class="fas fa-book-open"></i>';
  button.addEventListener("click", event => {
    event.preventDefault();
    openLibraryTab(isLocationDockMode() ? "locations" : "personas");
  });
  collapseBtn.before(button);
  return button;
}

function ensureDockTabs(root) {
  let tabs = root.querySelector("#ginzzzu-dock-tabs");
  if (tabs) return tabs;
  const toolbar = root.querySelector(".toolbar");
  if (!toolbar) return null;
  tabs = document.createElement("div");
  tabs.id = "ginzzzu-dock-tabs";
  tabs.className = "dock-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.innerHTML = `
    <button type="button" class="dock-tab" data-dock-tab="personas" role="tab">${tPersona("tabPersonas")}</button>
    <button type="button" class="dock-tab" data-dock-tab="scene" role="tab">${tLocation("tabScene")}</button>
    <button type="button" class="dock-tab" data-dock-tab="effects" role="tab">${game.i18n.localize("GINZZZUPORTRAITS.Effects.tab")}</button>
  `;
  tabs.addEventListener("click", async event => {
    const tab = event.target.closest("[data-dock-tab]");
    if (!tab) return;
    event.preventDefault();
    const next = tab.dataset.dockTab;
    if (next === currentDockTab()) return;
    await setDockTab(next);
    if (next === "scene" && root.classList.contains("collapsed")) {
      root.querySelector("#ginzzzu-npc-collapse")?.click();
    }
  });
  toolbar.before(tabs);
  return tabs;
}

function readSearch(key) {
  try {
    return game.settings.get(MODULE_ID, key) || "";
  } catch {
    return "";
  }
}

export function applyDockPanelChrome(root) {
  if (!root) return;
  const activeTab = currentDockTab();
  const effectsMode = activeTab === "effects";
  const locationMode = activeTab === "scene";
  root.classList.toggle("effects-mode", effectsMode);
  root.classList.toggle("locations-mode", locationMode);
  root.classList.toggle("personas-mode", activeTab === "personas");
  const tabs = ensureDockTabs(root);
  tabs?.querySelectorAll("[data-dock-tab]").forEach(tab => {
    const on = tab.dataset.dockTab === activeTab;
    tab.classList.toggle("is-active", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
  });
  const libraryBtn = ensureLibraryButton(root);
  if (libraryBtn) {
    libraryBtn.hidden = effectsMode;
    libraryBtn.title = locationMode ? tLocation("openLibrary") : tPersona("openLibrary");
  }

  const sourceLabel = root.querySelector(".toolbar .right label");
  if (sourceLabel) {
    sourceLabel.textContent = game.i18n.localize(effectsMode ? "GINZZZUPORTRAITS.Effects.target" : "GINZZZUPORTRAITS.displaySrc");
  }

  const searchEl = root.querySelector("#ginzzzu-npc-search");
  if (searchEl) {
    searchEl.placeholder = locationMode ? tLocation("search") : tPersona("search");
    const next = readSearch(locationMode ? LOCATION_DOCK_SEARCH_KEY : PERSONA_DOCK_SEARCH_KEY);
    if (searchEl.value !== next) searchEl.value = next;
  }

  const clearBtn = root.querySelector("#ginzzzu-npc-clear");
  if (clearBtn) {
    if (effectsMode) clearBtn.title = game.i18n.localize("GINZZZUPORTRAITS.Effects.clear");
    else clearBtn.title = locationMode ? tLocation("clearLocation") : tPersona("clearCast");
  }
}
