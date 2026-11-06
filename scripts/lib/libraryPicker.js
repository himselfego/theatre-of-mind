import { confirmDialog, escapeHTML, promptText } from "./sharedUi.js";
import { childFolders } from "./folderLibrary.js";

// The library looks like one window with tabs. Each tab is its own app:
// switching opens the next one in place of the current one and keeps each tab's search and folder.
const libraryTabs = new Map();
const tabStates = new Map();
let isSwitchingTab = false;

export function registerLibraryTab(id, App, labelKey) {
  libraryTabs.set(id, { App, labelKey });
}

export function libraryTabsContext(activeId) {
  return [...libraryTabs].map(([id, { labelKey }]) => ({
    id,
    label: game.i18n.localize(labelKey),
    active: id === activeId
  }));
}

export function restorePickerState(app, id) {
  Object.assign(app, {
    search: "",
    size: "medium",
    filterFolderId: null,
    selectedId: "",
    openedFolders: new Set()
  }, tabStates.get(id));
}

export function savePickerState(app, id) {
  const { search, size, filterFolderId, selectedId, openedFolders } = app;
  tabStates.set(id, { search, size, filterFolderId, selectedId, openedFolders });
}

export async function openLibraryTab(id) {
  if (!game.user?.isGM || isSwitchingTab) return;
  const { App } = libraryTabs.get(id);
  const current = [...libraryTabs.values()].map(tab => tab.App.instance).find(Boolean);
  if (current instanceof App) {
    await current.render({ force: true });
    return;
  }

  isSwitchingTab = true;
  try {
    const options = {};
    if (current) {
      const { left, top, width, height } = current.position;
      options.position = { left, top, width, height };
    }
    // The next window is drawn first, so the old one disappears without a blink.
    await new App(options).render({ force: true });
    await current?.close({ animate: false });
  } finally {
    isSwitchingTab = false;
  }
}

export function realFolderId(id) {
  if (!id || id === "__root__") return "";
  return id;
}

export function folderIdFrom(header, key) {
  const el = header?.jquery ? header[0] : header;
  return el?.closest?.("[data-item-id], [data-persona-id], [data-location-id], [data-folder-id]")?.dataset?.[key]
    ?? el?.dataset?.[key]
    ?? "";
}

function folderRowHTML({ id, name, filtered, hasChildren = false, open = false, all = false, unfiled = false }) {
  const drop = all ? "__all__" : (id || "__root__");
  const icon = all ? "fa-images" : unfiled ? "fa-inbox" : (open ? "fa-folder-open" : "fa-folder");
  const extra = `${filtered ? "is-filtered" : ""} ${all ? "is-all" : ""} ${unfiled ? "is-unfiled" : ""}`;
  return `
    <div class="tom-lib-folder-header ${extra}"
         data-folder-id="${escapeHTML(id)}"
         data-drop-folder="${escapeHTML(drop)}"
         data-tom="filter-folder"
         ${all ? 'data-all="true"' : ""}>
      <span class="tom-lib-folder-toggle"${hasChildren ? ' data-tom="toggle-folder"' : ""}>
        <i class="fas ${icon}"></i>
      </span>
      <span class="tom-lib-folder-name">${escapeHTML(name)}</span>
    </div>
  `;
}

export function bindPickerChrome(app, { onCreateItem, onCreateBulk }) {
  if (app._chromeBound) return;
  app._chromeBound = true;
  const root = app.element;
  root.addEventListener("input", event => {
    const search = event.target.closest?.("[data-search]");
    if (!search || !root.contains(search)) return;
    app.search = search.value;
    app._paintGallery();
  });
  root.addEventListener("click", event => {
    const tab = event.target.closest("[data-library-tab]");
    if (tab && root.contains(tab)) {
      event.preventDefault();
      openLibraryTab(tab.dataset.libraryTab);
      return;
    }
    const clear = event.target.closest("[data-tom='clear-search']");
    if (clear && root.contains(clear)) {
      event.preventDefault();
      app.search = "";
      const input = root.querySelector("[data-search]");
      if (input) input.value = "";
      app._paintGallery();
      return;
    }
    const size = event.target.closest("[data-size]");
    if (size && root.contains(size)) {
      event.preventDefault();
      event.stopPropagation();
      app.size = size.dataset.size;
      app._paintGallery();
      return;
    }
    const createItem = event.target.closest("[data-tom='create-item']");
    if (createItem && root.contains(createItem)) {
      event.preventDefault();
      onCreateItem?.(app._targetFolderId());
      return;
    }
    const createFolder = event.target.closest("[data-tom='create-folder']");
    if (createFolder && root.contains(createFolder)) {
      event.preventDefault();
      app._createFolder(app._targetFolderId());
      return;
    }
    const createBulk = event.target.closest("[data-tom='create-bulk']");
    if (createBulk && root.contains(createBulk)) {
      event.preventDefault();
      onCreateBulk?.();
    }
  });
}

export function bindPickerCardEvents(wrap, { cardSelector, onSelect, onActivate }) {
  wrap.querySelectorAll(cardSelector).forEach(card => {
    card.addEventListener("mousedown", event => {
      card.draggable = event.button === 0;
    });
    card.addEventListener("click", event => {
      event.preventDefault();
      onSelect?.(card);
    });
    card.addEventListener("dblclick", event => {
      event.preventDefault();
      onActivate?.(card);
    });
    card.addEventListener("dragstart", event => {
      event.dataTransfer.setData("text/plain", card.dataset.personaId || card.dataset.locationId || "");
    });
  });
}

export function pickerLabels(t, createItemKey) {
  return {
    createItem: t(createItemKey),
    createFolder: t("createFolder"),
    createBulk: t("createBulk"),
    search: t("search"),
    clearSearch: t("clearSearch"),
    sizeSmall: t("sizeSmall"),
    sizeMedium: t("sizeMedium"),
    sizeLarge: t("sizeLarge")
  };
}

export function paintFolderTree(app, { library, allLabel, rootLabel, onDropItem }) {
  const wrap = app.root.querySelector("[data-folder-tree]");
  if (!wrap) return;
  const folderHTML = folder => {
    const kids = childFolders(library, folder.id);
    const open = app.openedFolders.has(folder.id) || kids.some(child => containsFilter(app, library, child.id));
    const filtered = app.filterFolderId === folder.id;
    return `
      <div class="tom-lib-folder ${open ? "is-open" : "is-collapsed"}" data-folder-id="${escapeHTML(folder.id)}">
        ${folderRowHTML({ id: folder.id, name: folder.name, filtered, hasChildren: kids.length > 0, open })}
        <div class="tom-lib-folder-children">
          ${kids.map(child => folderHTML(child)).join("")}
        </div>
      </div>
    `;
  };

  wrap.innerHTML = `
    ${folderRowHTML({ id: "", name: allLabel, all: true, filtered: app.filterFolderId === null })}
    ${folderRowHTML({ id: "__root__", name: rootLabel, unfiled: true, filtered: app.filterFolderId === "" })}
    ${childFolders(library, "").map(folder => folderHTML(folder)).join("")}
  `;
  wrap.querySelectorAll("[data-tom='toggle-folder']").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const id = button.closest("[data-folder-id]")?.dataset.folderId;
      if (!id || id === "__root__") return;
      if (app.openedFolders.has(id)) app.openedFolders.delete(id);
      else app.openedFolders.add(id);
      app._paintFolders();
    });
  });
  wrap.querySelectorAll("[data-tom='filter-folder']").forEach(el => {
    el.addEventListener("click", event => {
      event.preventDefault();
      const raw = el.closest("[data-folder-id]")?.dataset.folderId;
      const id = raw === "__root__" ? "" : raw;
      const isAll = el.dataset.all === "true";
      if (isAll) app.filterFolderId = null;
      else app.filterFolderId = app.filterFolderId === id ? null : id;
      app._paint();
    });
  });
  wrap.querySelectorAll("[data-drop-folder]").forEach(el => {
    el.addEventListener("dragover", event => {
      event.preventDefault();
      el.classList.add("drop-over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drop-over"));
    el.addEventListener("drop", async event => {
      event.preventDefault();
      el.classList.remove("drop-over");
      const itemId = event.dataTransfer.getData("text/plain");
      const raw = el.dataset.dropFolder;
      const folderId = raw === "__all__" || raw === "__root__" ? "" : raw;
      if (itemId) await onDropItem?.(itemId, folderId);
    });
  });
}

function containsFilter(app, library, folderId) {
  if (app.filterFolderId == null || app.filterFolderId === "") return false;
  if (folderId === app.filterFolderId) return true;
  return childFolders(library, folderId).some(child => containsFilter(app, library, child.id));
}

export async function promptCreateFolder(app, { t, createFolder, parentId }) {
  const name = await promptText({ title: t("createFolder"), label: t("folderName") });
  if (name == null) return;
  if (!name) return ui.notifications.warn(t("needFolderName"));
  await createFolder({ name, parent: parentId || "" });
}

export async function promptRenameFolder(app, { t, getLibrary, renameFolder, folderId }) {
  const folder = getLibrary().folders.find(item => item.id === folderId);
  if (!folder) return;
  const name = await promptText({ title: t("renameFolder"), label: t("folderName"), value: folder.name });
  if (name == null) return;
  if (!name) return ui.notifications.warn(t("needFolderName"));
  await renameFolder(folderId, name);
}

export async function confirmUnwrapFolder({ t, unwrapFolder, folderId }) {
  const ok = await confirmDialog(t("unwrapFolderConfirm"), t("pickerTitle"));
  if (ok) await unwrapFolder(folderId);
}

export function applyGallerySize(app) {
  const wrap = app.root.querySelector("[data-gallery]");
  if (!wrap) return null;
  wrap.classList.toggle("is-small", app.size === "small");
  wrap.classList.toggle("is-medium", app.size === "medium");
  wrap.classList.toggle("is-large", app.size === "large");
  app.root.querySelectorAll("[data-size]").forEach(button => {
    button.classList.toggle("is-active", button.dataset.size === app.size);
  });
  return wrap;
}

export function filterLibraryItems(items, { filterFolderId, search }) {
  let next = items;
  if (filterFolderId === "") next = next.filter(item => !item.folder);
  else if (filterFolderId) next = next.filter(item => item.folder === filterFolderId);
  const q = String(search || "").trim().toLowerCase();
  if (q) next = next.filter(item => item.name.toLowerCase().includes(q));
  return next;
}
