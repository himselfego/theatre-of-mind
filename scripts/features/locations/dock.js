import { MODULE_ID } from "../../core/constants.js";
import { escapeHTML, fileToSrc, t } from "./shared.js";
import { folderPathLabel, getLibrary, LOCATIONS_CHANGED, sortLocations, toggleFavorite } from "./store.js";
import { applyDockPanelChrome, isLocationDockMode, LOCATION_DOCK_SEARCH_KEY } from "../dockChrome.js";
import { clearLocation, toggleLocation } from "./stage.js";

const SEARCH_KEY = LOCATION_DOCK_SEARCH_KEY;
const FOLDER_KEY = "locationDockFolder";

function getSearch() {
  try {
    return game.settings.get(MODULE_ID, SEARCH_KEY) || "";
  } catch {
    return "";
  }
}

function setSearch(value) {
  try { game.settings.set(MODULE_ID, SEARCH_KEY, value || ""); } catch {}
}

function getFolder() {
  try {
    return game.settings.get(MODULE_ID, FOLDER_KEY) || "all";
  } catch {
    return "all";
  }
}

function setFolder(value) {
  try { game.settings.set(MODULE_ID, FOLDER_KEY, value || "all"); } catch {}
}

export function registerLocationDockSettings() {
  game.settings.register(MODULE_ID, SEARCH_KEY, { scope: "client", config: false, type: String, default: "" });
  game.settings.register(MODULE_ID, FOLDER_KEY, { scope: "client", config: false, type: String, default: "all" });
}

function rebuildDock() {
  globalThis.GinzzzuNPCDock?.rebuild?.();
}

export function onLocationDockSearch(value) {
  setSearch(value);
  rebuildDock();
}

export function onLocationDockFolder(value) {
  setFolder(value);
  rebuildDock();
}

export function onLocationDockClear() {
  return clearLocation();
}

function fillFolderSelect(root) {
  const sel = root.querySelector("#ginzzzu-npc-folder");
  if (!sel) return;
  const library = getLibrary();
  const current = getFolder();
  const folders = [...library.folders].sort((a, b) =>
    (folderPathLabel(library, a.id) || a.name).localeCompare(folderPathLabel(library, b.id) || b.name, game.i18n.lang || undefined, { sensitivity: "base" })
  );
  sel.innerHTML = `
    <option value="all">${t("allLocations")}</option>
    <option value="root">${t("rootFolder")}</option>
    ${folders.map(folder => {
      const path = folderPathLabel(library, folder.id) || folder.name;
      return `<option value="${escapeHTML(folder.id)}">${escapeHTML(path)}</option>`;
    }).join("")}
  `;
  sel.value = current;
  if (sel.value !== current) {
    sel.value = "all";
    setFolder("all");
  }
}

function filteredLocations(library, { skipFavorites = false } = {}) {
  let locations = sortLocations(library.locations);
  const folderSel = getFolder();
  if (folderSel === "root") locations = locations.filter(location => !location.folder);
  else if (folderSel !== "all") locations = locations.filter(location => location.folder === folderSel);
  const q = getSearch().trim().toLowerCase();
  if (q) {
    locations = locations.filter(location => {
      const folderName = folderPathLabel(library, location.folder) || "";
      return location.name.toLowerCase().includes(q) || folderName.toLowerCase().includes(q);
    });
  }
  if (skipFavorites) locations = locations.filter(location => !library.favorites.includes(location.id));
  return locations;
}

function locationCard(location, { favorite = false, activeId = "" } = {}) {
  const btn = document.createElement("div");
  btn.className = "item location-item";
  btn.dataset.locationId = location.id;
  btn.title = location.name;
  if (location.id === activeId) btn.classList.add("is-on");

  const img = document.createElement("img");
  img.loading = "lazy";
  img.src = fileToSrc(location.image);
  img.alt = location.name;
  btn.appendChild(img);

  const label = document.createElement("div");
  label.className = "npc-label";
  label.textContent = location.name;
  btn.appendChild(label);

  if (favorite) {
    const star = document.createElement("div");
    star.className = "fav-star";
    star.textContent = "★";
    btn.appendChild(star);
  }

  btn.addEventListener("click", event => {
    event.preventDefault();
    if (btn.dataset.dragging) return;
    toggleLocation(location.id);
  });
  btn.addEventListener("mousedown", async event => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    await toggleFavorite(location.id);
  });
  btn.addEventListener("auxclick", event => {
    if (event.button === 1) event.preventDefault();
  });
  return btn;
}

function buildLocationFavs(container) {
  if (!container) return;
  const library = getLibrary();
  const favs = sortLocations(library.locations.filter(location => library.favorites.includes(location.id)));
  if (!favs.length) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }
  container.style.display = "";
  container.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const location of favs) fragment.appendChild(locationCard(location, { favorite: true, activeId: library.activeId }));
  container.appendChild(fragment);
}

function buildLocationRail(container) {
  if (!container) return;
  container.classList.remove("is-empty");
  container.innerHTML = "";
  const library = getLibrary();
  const locations = filteredLocations(library, { skipFavorites: true });
  if (!library.locations.length) {
    container.classList.add("is-empty");
    container.innerHTML = `<div class="empty">${t("emptyGallery")}</div>`;
    return;
  }
  if (!locations.length) {
    container.classList.add("is-empty");
    container.innerHTML = `<div class="empty">${t("emptyGallery")}</div>`;
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const location of locations) fragment.appendChild(locationCard(location, { activeId: library.activeId }));
  container.appendChild(fragment);
}

export function buildLocationDock(root) {
  applyDockPanelChrome(root);
  fillFolderSelect(root);
  const playersBox = root.querySelector(".players");
  if (playersBox) {
    playersBox.style.display = "none";
    playersBox.innerHTML = "";
  }
  buildLocationFavs(root.querySelector(".npc-favs"));
  buildLocationRail(root.querySelector(".npcs .rail"));
}

export function bindLocationDockHooks() {
  Hooks.on(LOCATIONS_CHANGED, () => {
    if (isLocationDockMode()) rebuildDock();
  });
}
