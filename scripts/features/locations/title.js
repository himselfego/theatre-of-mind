import { MODULE_ID } from "../../core/constants.js";
import { isTheatreStage } from "../ensureTheatreScene.js";
import { SETTING_KEY } from "./shared.js";
import { getLibrary, LOCATIONS_CHANGED } from "./store.js";

const TITLE_ID = "tom-location-title";
const TOP_OFFSET_KEY = "locationTitleTopOffset";
const TOP_OFFSET_DEFAULT = 48;

let suppressed = false;

function titleTopOffsetPx() {
  try {
    const value = Number(game.settings.get(MODULE_ID, TOP_OFFSET_KEY));
    if (Number.isFinite(value)) return Math.max(0, Math.min(600, value));
    return TOP_OFFSET_DEFAULT;
  } catch {
    return TOP_OFFSET_DEFAULT;
  }
}

function applyTitleTopOffset(el = document.getElementById(TITLE_ID)) {
  const px = `${titleTopOffsetPx()}px`;
  document.documentElement.style.setProperty("--tom-location-title-top", px);
  if (el) el.style.top = px;
}

function titleHost() {
  return document.getElementById("interface") || document.body;
}

function ensureTitleEl() {
  const host = titleHost();
  let el = document.getElementById(TITLE_ID);
  if (el && el.parentElement !== host) {
    host.appendChild(el);
    return el;
  }
  if (el) return el;

  el = document.createElement("div");
  el.id = TITLE_ID;
  el.hidden = true;
  el.setAttribute("aria-live", "polite");
  host.appendChild(el);
  return el;
}

function titleName() {
  const onStage = isTheatreStage(canvas?.scene);
  const library = onStage ? getLibrary() : null;
  const location = library?.activeId
    ? library.locations.find(item => item.id === library.activeId)
    : null;
  return String(location?.name || "").trim();
}

function updateTitleContent(el) {
  const name = titleName();
  el.textContent = name;
  el.hidden = !name;
  el.classList.toggle("is-hidden", !name);
}

export function suppressLocationTitle() {
  suppressed = true;
  const el = ensureTitleEl();
  applyTitleTopOffset(el);
  el.classList.add("is-suppressed");
}

export function revealLocationTitle() {
  const wasSuppressed = suppressed;
  suppressed = false;
  const el = ensureTitleEl();
  applyTitleTopOffset(el);
  updateTitleContent(el);
  if (!wasSuppressed) {
    el.classList.remove("is-suppressed");
    return;
  }
  el.classList.add("is-suppressed");
  requestAnimationFrame(() => {
    if (!suppressed) el.classList.remove("is-suppressed");
  });
}

export function refreshLocationTitle() {
  const el = ensureTitleEl();
  applyTitleTopOffset(el);
  if (suppressed) {
    el.classList.add("is-suppressed");
    return;
  }
  updateTitleContent(el);
  el.classList.remove("is-suppressed");
}

export function bindLocationTitleHooks() {
  refreshLocationTitle();
  Hooks.on(LOCATIONS_CHANGED, refreshLocationTitle);
  Hooks.on("canvasReady", refreshLocationTitle);
  Hooks.on("updateSetting", setting => {
    if (setting?.key === `${MODULE_ID}.${SETTING_KEY}` || setting?.key === `${MODULE_ID}.${TOP_OFFSET_KEY}`) {
      refreshLocationTitle();
    }
  });
}
