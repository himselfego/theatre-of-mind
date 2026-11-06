import { MODULE_ID } from "../../core/constants.js";
import { getTheatreScene, isTheatreStage } from "../ensureTheatreScene.js";
import { getLibrary, getPersona } from "./store.js";

export const CAST_CHANGED = `${MODULE_ID}.castChanged`;

// screenX and screenY are fractions of the screen: clients have different resolutions.
function normalizeTransform(transform) {
  const screenX = Number(transform?.screenX);
  const screenY = Number(transform?.screenY);
  const tilt = Number(transform?.tilt);
  const scale = Number(transform?.scale);
  return {
    screenX: Number.isFinite(screenX) ? screenX : 0,
    screenY: Number.isFinite(screenY) ? screenY : 0,
    tilt: Number.isFinite(tilt) ? tilt : 0,
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1
  };
}

function normalizeCastItem(raw, personaId) {
  const id = String(raw?.personaId || personaId || "").trim();
  if (!id) return null;
  return {
    personaId: id,
    emotion: raw?.emotion || "none",
    flip: !!raw?.flip,
    transform: normalizeTransform(raw?.transform)
  };
}

export function getCast(scene = getTheatreScene()) {
  try {
    const raw = scene?.getFlag?.(MODULE_ID, "cast");
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const cast = [];
    for (const item of raw) {
      const next = normalizeCastItem(item);
      if (!next || seen.has(next.personaId)) continue;
      seen.add(next.personaId);
      cast.push(next);
    }
    return cast;
  } catch {
    return [];
  }
}

export function getFocusedPersonaId(scene = getTheatreScene()) {
  try {
    return String(scene?.getFlag?.(MODULE_ID, "focusedPersonaId") || "");
  } catch {
    return "";
  }
}

export function getCastItem(personaId, scene = getTheatreScene()) {
  return getCast(scene).find(item => item.personaId === personaId) || null;
}

export function isOnStage(personaId, scene = getTheatreScene()) {
  return !!getCastItem(personaId, scene);
}

// A write replaces the whole cast, so the next one must read it after the server answered the previous one.
let castWriteQueue = Promise.resolve();

function enqueueCastWrite(task) {
  const result = castWriteQueue.then(task);
  castWriteQueue = result.catch(() => {});
  return result;
}

async function writeCast(cast, { focusedPersonaId } = {}, scene = getTheatreScene()) {
  if (!scene) return false;
  const patch = { [`flags.${MODULE_ID}.cast`]: cast };
  if (focusedPersonaId !== undefined) {
    patch[`flags.${MODULE_ID}.focusedPersonaId`] = focusedPersonaId || "";
  }
  await scene.update(patch);
  Hooks.callAll(CAST_CHANGED, getCast(scene));
  return true;
}

async function addToCast(personaId) {
  if (!game.user?.isGM) return;
  const persona = getPersona(personaId);
  if (!persona?.image) return ui.notifications.warn(game.i18n.localize("GINZZZUPORTRAITS.Personas.needImage"));
  const scene = getTheatreScene();
  if (!scene) return ui.notifications.error(game.i18n.localize("GINZZZUPORTRAITS.Locations.noTheatreScene"));
  const cast = getCast(scene);
  if (cast.some(item => item.personaId === personaId)) return;
  cast.push(normalizeCastItem({ personaId }));
  await writeCast(cast, {}, scene);
}

async function removeFromCast(personaId) {
  if (!game.user?.isGM) return;
  const scene = getTheatreScene();
  if (!scene) return;
  const cast = getCast(scene).filter(item => item.personaId !== personaId);
  const focused = getFocusedPersonaId(scene) === personaId ? "" : undefined;
  await writeCast(cast, { focusedPersonaId: focused }, scene);
}

export function showPersona(personaId) {
  return enqueueCastWrite(() => addToCast(personaId));
}

export function hidePersona(personaId) {
  return enqueueCastWrite(() => removeFromCast(personaId));
}

export function togglePersona(personaId) {
  return enqueueCastWrite(() => (isOnStage(personaId) ? removeFromCast(personaId) : addToCast(personaId)));
}

export function hideAllPersonas() {
  return enqueueCastWrite(async () => {
    if (!game.user?.isGM) return;
    const scene = getTheatreScene();
    if (!scene) return;
    if (!getCast(scene).length && !getFocusedPersonaId(scene)) return;
    await writeCast([], { focusedPersonaId: "" }, scene);
  });
}

export function removePersonasFromCast(personaIds) {
  return enqueueCastWrite(async () => {
    const ids = new Set(personaIds || []);
    if (!ids.size) return;
    const scene = getTheatreScene();
    if (!scene) return;
    const cast = getCast(scene).filter(item => !ids.has(item.personaId));
    const focused = ids.has(getFocusedPersonaId(scene)) ? "" : undefined;
    await writeCast(cast, { focusedPersonaId: focused }, scene);
  });
}

function patchCastItem(personaId, patch, scene = getTheatreScene()) {
  return enqueueCastWrite(async () => {
    const cast = getCast(scene);
    const item = cast.find(entry => entry.personaId === personaId);
    if (!item) return null;
    Object.assign(item, patch);
    return writeCast(cast, {}, scene);
  });
}

export async function setCastEmotion(personaId, emotion) {
  return patchCastItem(personaId, { emotion: emotion || "none" });
}

export async function setCastFlip(personaId, flip) {
  return patchCastItem(personaId, { flip: !!flip });
}

export async function setCastTransform(personaId, transform) {
  return patchCastItem(personaId, { transform: normalizeTransform(transform) });
}

export function setFocusedPersona(personaId) {
  return enqueueCastWrite(async () => {
    const scene = getTheatreScene();
    if (!scene) return;
    await scene.update({ [`flags.${MODULE_ID}.focusedPersonaId`]: personaId || "" });
  });
}

export function reorderCast(personaIds) {
  return enqueueCastWrite(async () => {
    const scene = getTheatreScene();
    if (!scene) return;
    const current = new Map(getCast(scene).map(item => [item.personaId, item]));
    const next = [];
    const seen = new Set();
    for (const id of personaIds || []) {
      const item = current.get(id);
      if (!item || seen.has(id)) continue;
      seen.add(id);
      next.push(item);
    }
    for (const item of current.values()) {
      if (!seen.has(item.personaId)) next.push(item);
    }
    await writeCast(next, {}, scene);
  });
}

export function getPersonaImage(persona, castItem = getCastItem(persona?.id)) {
  if (!persona) return "";
  const key = String(castItem?.emotion || "none");
  const match = /^custom_(\d+)$/.exec(key);
  if (match) {
    const emotion = persona.customEmotions?.[Number(match[1])];
    if (typeof emotion?.imagePath === "string" && emotion.imagePath.trim()) return emotion.imagePath.trim();
  }
  return persona.image || "";
}

export function getPersonaStageName(persona, castItem = getCastItem(persona?.id)) {
  if (!persona) return "";
  const key = String(castItem?.emotion || "none");
  const match = /^custom_(\d+)$/.exec(key);
  if (match) {
    const emotion = persona.customEmotions?.[Number(match[1])];
    if (typeof emotion?.displayName === "string" && emotion.displayName.trim()) return emotion.displayName.trim();
  }
  return persona.name || "";
}

export function getEmotionHeightMultiplier(persona, castItem = getCastItem(persona?.id)) {
  const key = String(castItem?.emotion || "none");
  const match = /^custom_(\d+)$/.exec(key);
  if (!match) return 1;
  const raw = Number(persona?.customEmotions?.[Number(match[1])]?.heightMultiplier);
  return Number.isFinite(raw) ? Math.max(0, raw) : 1;
}

export function getShownPersonaIds() {
  const known = new Set(getLibrary().personas.map(persona => persona.id));
  return getCast().map(item => item.personaId).filter(id => known.has(id));
}

export { isTheatreStage };
