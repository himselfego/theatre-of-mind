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

export function emptyLibrary() {
  return { locations: [], folders: [], favorites: [], activeId: "" };
}

export function getLibrary() {
  try {
    const data = game.settings.get(MODULE_ID, SETTING_KEY);
    if (data && Array.isArray(data.locations) && Array.isArray(data.folders)) {
      const library = foundry.utils.duplicate(data);
      if (!Array.isArray(library.favorites)) library.favorites = [];
      if (typeof library.activeId !== "string") library.activeId = "";
      return library;
    }
  } catch {}
  return emptyLibrary();
}

export const LOCATIONS_CHANGED = `${MODULE_ID}.locationsChanged`;

export async function saveLibrary(library) {
  await game.settings.set(MODULE_ID, SETTING_KEY, library);
  Hooks.callAll(LOCATIONS_CHANGED);
}

export function folderSelectOptions(library, selectedId = "") {
  return folderSelectOptionsFrom(library, selectedId, t("rootFolder"));
}

export function sortLocations(locations) {
  return sortByName(locations);
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
  if (!unwrapFolderInLibrary(library, folderId, "locations")) return;
  await saveLibrary(library);
}

export async function deleteFolderCascade(folderId) {
  const library = getLibrary();
  const removed = deleteFolderCascadeInLibrary(library, folderId, "locations");
  const wasActive = removed.includes(library.activeId);
  if (wasActive) library.activeId = "";
  await saveLibrary(library);
  return wasActive;
}

export async function createLocation(data) {
  const library = getLibrary();
  const location = {
    id: foundry.utils.randomID(),
    name: data.name,
    image: data.image,
    folder: data.folder || "",
    outdoors: !!data.outdoors
  };
  library.locations.push(location);
  await saveLibrary(library);
  return location;
}

export async function updateLocation(locationId, patch) {
  const library = getLibrary();
  const location = library.locations.find(item => item.id === locationId);
  if (!location) return;
  Object.assign(location, patch);
  await saveLibrary(library);
  return location;
}

export async function deleteLocation(locationId) {
  const library = getLibrary();
  const wasActive = library.activeId === locationId;
  library.locations = library.locations.filter(item => item.id !== locationId);
  library.favorites = library.favorites.filter(id => id !== locationId);
  if (wasActive) library.activeId = "";
  await saveLibrary(library);
  return wasActive;
}

export async function moveLocation(locationId, folderId) {
  await updateLocation(locationId, { folder: folderId || "" });
}

export async function toggleFavorite(locationId) {
  const library = getLibrary();
  if (!library.locations.some(item => item.id === locationId)) return;
  const set = new Set(library.favorites);
  if (set.has(locationId)) set.delete(locationId);
  else set.add(locationId);
  library.favorites = [...set];
  await saveLibrary(library);
}

export async function createMany({ folders = [], locations = [] }) {
  const library = getLibrary();
  library.folders.push(...folders);
  library.locations.push(...locations);
  await saveLibrary(library);
}
