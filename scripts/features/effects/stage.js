import { MODULE_ID } from "../../core/constants.js";
import { getTheatreScene, isTheatreStage } from "../ensureTheatreScene.js";

export const EFFECTS_CHANGED = `${MODULE_ID}.effectsChanged`;
export const TARGET_KEY = "effectsTarget";
export const CALM_KEY = "effectsCalm";

const SOCKET = `module.${MODULE_ID}`;
const STATE_FLAG = "effects";
const ONCE_MESSAGE = "effectOnce";
const LAYER_ID = "tom-fx-layer";
const GRADE_FADE_MS = 700;

// once: plays and ends. curtain: on or off for everyone. mood: one at a time, for everyone or one player.
export const EFFECTS = [
  { id: "flash", kind: "once", icon: "fa-bolt" },
  { id: "shake", kind: "once", icon: "fa-house-crack" },
  { id: "heart", kind: "once", icon: "fa-heart-pulse" },
  { id: "glitch", kind: "once", icon: "fa-tv" },
  { id: "curtain", kind: "curtain", icon: "fa-person-booth" },
  { id: "frenzy", kind: "mood", icon: "fa-face-angry" },
  { id: "rot", kind: "mood", icon: "fa-fire" },
  { id: "memory", kind: "mood", icon: "fa-film" },
  { id: "freeze", kind: "mood", icon: "fa-hourglass-half" }
];

const MOODS = EFFECTS.filter(effect => effect.kind === "mood").map(effect => effect.id);

let gradeTimer = null;

function readSetting(key, fallback) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return fallback;
  }
}

function isCalm() {
  return !!readSetting(CALM_KEY, false) || !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

function isForMe(users) {
  return !users?.length || users.includes(game.user?.id);
}

export function getEffectsState(scene = getTheatreScene()) {
  const raw = scene?.getFlag?.(MODULE_ID, STATE_FLAG);
  return {
    curtain: !!raw?.curtain,
    mood: MOODS.includes(raw?.mood) ? raw.mood : "",
    users: Array.isArray(raw?.users) ? raw.users : []
  };
}

async function writeState(patch) {
  const scene = getTheatreScene();
  if (!scene || !game.user?.isGM) return;
  await scene.update({ [`flags.${MODULE_ID}.${STATE_FLAG}`]: { ...getEffectsState(scene), ...patch } });
}

function targetUsers() {
  const target = readSetting(TARGET_KEY, "all");
  return target !== "all" && game.users?.get(target) ? [target] : [];
}

function ensureLayer() {
  let layer = document.getElementById(LAYER_ID);
  if (layer) return layer;
  const host = document.getElementById("interface");
  if (!host) return null;
  layer = document.createElement("div");
  layer.id = LAYER_ID;
  for (const part of ["vignette", "heart", "grain", "flash", "curtain"]) {
    const element = document.createElement("div");
    element.className = `tom-fx-${part}`;
    layer.appendChild(element);
  }
  host.appendChild(layer);
  return layer;
}

function setGraded(on) {
  const body = document.body;
  clearTimeout(gradeTimer);
  if (on) body.classList.add("tom-fx-graded");
  // Keep the filters until the colours have faded back.
  else gradeTimer = setTimeout(() => body.classList.remove("tom-fx-graded"), GRADE_FADE_MS);
}

export function applyEffects() {
  const layer = ensureLayer();
  if (!layer) return;
  const body = document.body;
  const onStage = isTheatreStage();
  const state = getEffectsState();
  const mood = onStage && isForMe(state.users) ? state.mood : "";

  layer.classList.toggle("is-curtain", onStage && state.curtain);
  body.classList.toggle("tom-fx-gm", !!game.user?.isGM);
  body.classList.toggle("tom-fx-calm", isCalm());
  for (const id of MOODS) body.classList.toggle(`tom-fx-${id}`, mood === id);
  setGraded(!!mood);
}

function restartAnimation(element, className, durationMs) {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  setTimeout(() => element.classList.remove(className), durationMs);
}

function playOnce(id) {
  if (!isTheatreStage() || !EFFECTS.some(effect => effect.id === id && effect.kind === "once")) return;
  // The heartbeat is only a slow dark pulse, so it stays in the calm mode.
  if (isCalm() && id !== "heart") return;
  const layer = ensureLayer();
  if (!layer) return;

  if (id === "flash") restartAnimation(layer.querySelector(".tom-fx-flash"), "is-playing", 500);
  if (id === "heart") restartAnimation(layer.querySelector(".tom-fx-heart"), "is-playing", 2400);
  if (id === "shake" || id === "glitch") {
    const durationMs = id === "shake" ? 520 : 720;
    for (const element of [document.getElementById("board"), document.getElementById("ginzzzu-portrait-rail")]) {
      restartAnimation(element, `tom-fx-${id}`, durationMs);
    }
  }
}

export async function fireEffect(id) {
  if (!game.user?.isGM) return;
  const effect = EFFECTS.find(item => item.id === id);
  if (!effect) return;
  if (!isTheatreStage()) {
    ui.notifications.warn(game.i18n.localize("GINZZZUPORTRAITS.Effects.notOnStage"));
    return;
  }

  const users = targetUsers();
  if (effect.kind === "once") {
    game.socket?.emit(SOCKET, { type: ONCE_MESSAGE, id, users });
    if (isForMe(users)) playOnce(id);
    return;
  }

  const state = getEffectsState();
  if (effect.kind === "curtain") {
    await writeState({ curtain: !state.curtain });
    return;
  }
  const sameTarget = users.join() === state.users.join();
  await writeState(state.mood === id && sameTarget ? { mood: "", users: [] } : { mood: id, users });
}

export function clearEffects() {
  return writeState({ curtain: false, mood: "", users: [] });
}

export function registerEffectKeybindings() {
  for (const { id } of EFFECTS) {
    game.keybindings.register(MODULE_ID, `effect-${id}`, {
      name: game.i18n.format("GINZZZUPORTRAITS.Effects.keybinding", {
        name: game.i18n.localize(`GINZZZUPORTRAITS.Effects.${id}`)
      }),
      editable: [],
      restricted: true,
      onDown: () => {
        fireEffect(id);
        return true;
      }
    });
  }
}

export function bindEffects() {
  applyEffects();
  game.socket?.on(SOCKET, data => {
    if (data?.type === ONCE_MESSAGE && isForMe(data.users)) playOnce(data.id);
  });
  Hooks.on("updateScene", (scene, diff) => {
    if (diff.flags?.[MODULE_ID]?.[STATE_FLAG] === undefined || scene.id !== getTheatreScene()?.id) return;
    applyEffects();
    Hooks.callAll(EFFECTS_CHANGED);
  });
  Hooks.on("canvasReady", applyEffects);
}
