import { DOCK_ID, MODULE_ID } from "../../core/constants.js";
import { escapeHTML, fileToSrc, t } from "./shared.js";
import { folderPathLabel, getLibrary, PERSONAS_CHANGED, sortPersonas, toggleFavorite } from "./store.js";
import { PersonaEditorApp } from "./editor.js";
import { getShownPersonaIds, isOnStage, togglePersona } from "./stage.js";
import { CAST_CHANGED } from "./stage.js";
import { applyDockPanelChrome, isLocationDockMode, PERSONA_DOCK_SEARCH_KEY } from "../dockChrome.js";

const SEARCH_KEY = PERSONA_DOCK_SEARCH_KEY;
const FOLDER_KEY = "personaDockFolder";

export function registerPersonaDockSettings() {
  game.settings.register(MODULE_ID, SEARCH_KEY, { scope: "client", config: false, type: String, default: "" });
  game.settings.register(MODULE_ID, FOLDER_KEY, { scope: "client", config: false, type: String, default: "all" });
}

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

function rebuildDock() {
  globalThis.GinzzzuNPCDock?.rebuild?.();
}

export function onPersonaDockSearch(value) {
  setSearch(value);
  rebuildDock();
}

export function onPersonaDockFolder(value) {
  setFolder(value);
  rebuildDock();
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
    <option value="all">${t("allPersonas")}</option>
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

function filteredPersonas(library, { players = false, skipFavorites = false } = {}) {
  let personas = sortPersonas(library.personas.filter(persona => !!persona.isPlayer === players));
  if (players) return personas;
  const folderSel = getFolder();
  if (folderSel === "root") personas = personas.filter(persona => !persona.folder);
  else if (folderSel !== "all") personas = personas.filter(persona => persona.folder === folderSel);
  const q = getSearch().trim().toLowerCase();
  if (q) {
    personas = personas.filter(persona => {
      const folderName = folderPathLabel(library, persona.folder) || "";
      return persona.name.toLowerCase().includes(q) || folderName.toLowerCase().includes(q);
    });
  }
  if (skipFavorites) personas = personas.filter(persona => !library.favorites.includes(persona.id));
  return personas;
}

function personaCard(persona, { favorite = false } = {}) {
  const btn = document.createElement("div");
  btn.className = "item persona-item";
  btn.dataset.personaId = persona.id;
  btn.title = persona.name;
  if (isOnStage(persona.id)) btn.classList.add("is-on");

  const img = document.createElement("img");
  img.loading = "lazy";
  img.src = fileToSrc(persona.image);
  img.alt = persona.name;
  btn.appendChild(img);

  const label = document.createElement("div");
  label.className = "npc-label";
  label.textContent = persona.name;
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
    togglePersona(persona.id);
  });
  btn.addEventListener("contextmenu", event => {
    event.preventDefault();
    event.stopPropagation();
    new PersonaEditorApp({ personaId: persona.id }).render({ force: true });
  });
  btn.addEventListener("mousedown", async event => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    await toggleFavorite(persona.id);
  });
  btn.addEventListener("auxclick", event => {
    if (event.button === 1) event.preventDefault();
  });
  return btn;
}

function buildPlayers(container) {
  if (!container) return;
  const players = filteredPersonas(getLibrary(), { players: true });
  if (!players.length) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }
  container.style.display = "";
  container.style.visibility = "";
  container.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const persona of players) {
    const favorite = getLibrary().favorites.includes(persona.id);
    fragment.appendChild(personaCard(persona, { favorite }));
  }
  container.appendChild(fragment);
}

function buildFavs(container) {
  if (!container) return;
  const library = getLibrary();
  const favs = sortPersonas(library.personas.filter(persona =>
    !persona.isPlayer && library.favorites.includes(persona.id)
  ));
  if (!favs.length) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }
  container.style.display = "";
  container.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const persona of favs) fragment.appendChild(personaCard(persona, { favorite: true }));
  container.appendChild(fragment);
}

function buildRail(container) {
  if (!container) return;
  container.classList.remove("is-empty");
  container.innerHTML = "";
  const library = getLibrary();
  const personas = filteredPersonas(library, { skipFavorites: true });
  if (!library.personas.filter(persona => !persona.isPlayer).length) {
    container.classList.add("is-empty");
    container.innerHTML = `<div class="empty">${t("emptyGallery")}</div>`;
    return;
  }
  if (!personas.length) {
    container.classList.add("is-empty");
    container.innerHTML = `<div class="empty">${t("emptyGallery")}</div>`;
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const persona of personas) fragment.appendChild(personaCard(persona));
  container.appendChild(fragment);
}

export function buildPersonaDock(root) {
  applyDockPanelChrome(root);
  fillFolderSelect(root);
  const searchEl = root.querySelector("#ginzzzu-npc-search");
  const next = getSearch();
  if (searchEl && searchEl.value !== next) searchEl.value = next;
  buildPlayers(root.querySelector(".players"));
  buildFavs(root.querySelector(".npc-favs"));
  buildRail(root.querySelector(".npcs .rail"));
}

function syncDockOnStage(root = document.getElementById(DOCK_ID)) {
  if (!root) return;
  const onStage = new Set(getShownPersonaIds());
  for (const item of root.querySelectorAll(".item.persona-item[data-persona-id]")) {
    item.classList.toggle("is-on", onStage.has(item.dataset.personaId));
  }
}

export function bindPersonaDockHooks() {
  Hooks.on(PERSONAS_CHANGED, () => {
    if (!isLocationDockMode()) rebuildDock();
  });
  Hooks.on(CAST_CHANGED, () => {
    if (isLocationDockMode()) return;
    syncDockOnStage();
  });
}
