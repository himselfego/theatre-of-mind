import { MODULE_ID } from "../../core/constants.js";
import { SETTING_KEY, t } from "./shared.js";
import {
  deleteFolderCascadeInLibrary,
  emptyFolder,
  folderSelectOptions as folderSelectOptionsFrom,
  sortByName,
  unwrapFolderInLibrary
} from "../../lib/folderLibrary.js";

export {
  folderPathLabel
} from "../../lib/folderLibrary.js";

function emptyPersona() {
  return {
    id: foundry.utils.randomID(),
    name: "",
    displayName: "",
    image: "",
    folder: "",
    boundActorUuid: "",
    isPlayer: false,
    customEmotions: [],
    showStandardEmotions: true,
    portraitHeightMultiplier: 1,
    portraitBreathingMultiplier: 1
  };
}

export function emptyLibrary() {
  return { personas: [], folders: [], favorites: [] };
}

function normalizePersona(raw = {}) {
  const persona = emptyPersona();
  Object.assign(persona, raw);
  persona.id = raw.id || persona.id;
  persona.name = String(raw.name || "");
  persona.displayName = String(raw.displayName || "");
  persona.image = String(raw.image || "");
  persona.folder = raw.folder || "";
  persona.boundActorUuid = String(raw.boundActorUuid || "");
  persona.isPlayer = !!raw.isPlayer;
  persona.customEmotions = Array.isArray(raw.customEmotions) ? raw.customEmotions : [];
  persona.showStandardEmotions = raw.showStandardEmotions !== false;
  const height = Number(raw.portraitHeightMultiplier);
  persona.portraitHeightMultiplier = Number.isFinite(height) ? height : 1;
  const breathing = Number(raw.portraitBreathingMultiplier);
  persona.portraitBreathingMultiplier = Number.isFinite(breathing) ? breathing : 1;
  return persona;
}

let libraryCache = null;

function readLibrary() {
  if (libraryCache) return libraryCache;
  try {
    const data = game.settings.get(MODULE_ID, SETTING_KEY);
    if (data && Array.isArray(data.personas) && Array.isArray(data.folders)) {
      const library = foundry.utils.duplicate(data);
      if (!Array.isArray(library.favorites)) library.favorites = [];
      library.personas = library.personas.map(normalizePersona);
      libraryCache = library;
      return libraryCache;
    }
  } catch {}
  return emptyLibrary();
}

function invalidateLibraryCache() {
  libraryCache = null;
}

export function getLibrary() {
  return readLibrary();
}

export const PERSONAS_CHANGED = `${MODULE_ID}.personasChanged`;

export async function saveLibrary(library) {
  invalidateLibraryCache();
  await game.settings.set(MODULE_ID, SETTING_KEY, library);
  invalidateLibraryCache();
}

export function getPersona(personaId) {
  return readLibrary().personas.find(item => item.id === personaId) || null;
}

// These hooks fire on every client, so players also see edits to a persona on stage.
// The very first save creates the setting instead of updating it.
function onLibrarySetting(setting) {
  if (setting?.key !== `${MODULE_ID}.${SETTING_KEY}`) return;
  invalidateLibraryCache();
  Hooks.callAll(PERSONAS_CHANGED);
}

Hooks.on("createSetting", onLibrarySetting);
Hooks.on("updateSetting", onLibrarySetting);

export function folderSelectOptions(library, selectedId = "") {
  return folderSelectOptionsFrom(library, selectedId, t("rootFolder"));
}

export function sortPersonas(personas) {
  return sortByName(personas);
}

export async function createFolder({ name, parent = "" }) {
  const library = getLibrary();
  const folder = emptyFolder({ name, parent });
  library.folders.push(folder);
  await saveLibrary(library);
  return folder;
}

export async function renameFolder(folderId, name) {
  const library = getLibrary();
  const folder = library.folders.find(item => item.id === folderId);
  if (!folder) return;
  folder.name = name;
  await saveLibrary(library);
}

export async function unwrapFolder(folderId) {
  const library = getLibrary();
  if (!unwrapFolderInLibrary(library, folderId, "personas")) return;
  await saveLibrary(library);
}

export async function deleteFolderCascade(folderId) {
  const library = getLibrary();
  const removed = deleteFolderCascadeInLibrary(library, folderId, "personas");
  await saveLibrary(library);
  return removed;
}

export async function createPersona(data) {
  const library = getLibrary();
  const persona = normalizePersona({ ...emptyPersona(), ...data, id: foundry.utils.randomID() });
  library.personas.push(persona);
  await saveLibrary(library);
  return persona;
}

export async function updatePersona(personaId, patch) {
  const library = getLibrary();
  const persona = library.personas.find(item => item.id === personaId);
  if (!persona) return;
  Object.assign(persona, patch);
  library.personas = library.personas.map(item => item.id === personaId ? normalizePersona(persona) : item);
  await saveLibrary(library);
  return getPersona(personaId);
}

export async function deletePersona(personaId) {
  const library = getLibrary();
  library.personas = library.personas.filter(item => item.id !== personaId);
  library.favorites = library.favorites.filter(id => id !== personaId);
  await saveLibrary(library);
  return true;
}

export async function movePersona(personaId, folderId) {
  await updatePersona(personaId, { folder: folderId || "" });
}

export async function toggleFavorite(personaId) {
  const library = getLibrary();
  if (!library.personas.some(item => item.id === personaId)) return;
  const set = new Set(library.favorites);
  if (set.has(personaId)) set.delete(personaId);
  else set.add(personaId);
  library.favorites = [...set];
  await saveLibrary(library);
}

export async function createMany({ folders = [], personas = [] }) {
  const library = getLibrary();
  library.folders.push(...folders);
  library.personas.push(...personas.map(item => normalizePersona(item)));
  await saveLibrary(library);
}
