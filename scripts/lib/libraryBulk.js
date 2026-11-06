import {
  FilePickerClass,
  IMAGE_EXT,
  escapeHTML,
  fileToSrc,
  nameFromPath,
  normPath,
  pickFile
} from "./sharedUi.js";
import { folderPathLabel } from "./folderLibrary.js";

export function bulkLabels(t) {
  return {
    bulkImport: t("bulkImport"),
    importSubfolders: t("importSubfolders"),
    ignoreSourceFolder: t("ignoreSourceFolder"),
    folderPath: t("folderPath"),
    browseFolder: t("browseFolder"),
    refresh: t("refresh"),
    bulkList: t("bulkList"),
    showNames: t("showNames"),
    showDuplicates: t("showDuplicates"),
    selectAll: t("selectAll"),
    deselectAll: t("deselectAll"),
    bulkSettings: t("bulkSettings"),
    targetFolder: t("targetFolder"),
    importConfirm: t("importConfirm")
  };
}

export async function browseImageTree(source, path, { subfolders, usedPaths }) {
  const Picker = FilePickerClass();
  const result = await Picker.browse(source, path);
  const used = usedPaths instanceof Set ? usedPaths : new Set(usedPaths || []);
  const id = foundry.utils.randomID();
  const node = {
    id,
    name: decodeURIComponent(String(path).split("/").pop() || path),
    parentId: "",
    entities: (result.files || []).filter(file => IMAGE_EXT.test(file)).map(file => ({
      file,
      name: nameFromPath(file),
      folderId: id,
      duplicate: used.has(normPath(file))
    })),
    children: []
  };
  if (subfolders) {
    for (const dir of result.dirs || []) {
      const child = await browseImageTree(source, dir, { subfolders, usedPaths: used });
      child.parentId = id;
      node.children.push(child);
    }
  }
  return node;
}

export function countFiles(node) {
  if (!node) return 0;
  return node.entities.length + node.children.reduce((sum, child) => sum + countFiles(child), 0);
}

function flattenFolders(node, acc = []) {
  if (!node) return acc;
  if (node.id) acc.push(node);
  for (const child of node.children || []) flattenFolders(child, acc);
  return acc;
}

function resolveDiskFolder(node, byId, library, folderMap, folders) {
  if (!node?.id) return "";
  if (folderMap[node.id]) return folderMap[node.id];
  const parentLibId = node.parentId ? resolveDiskFolder(byId[node.parentId], byId, library, folderMap, folders) : "";
  const existing = [...library.folders, ...folders].find(folder => folder.name === node.name && (folder.parent || "") === parentLibId);
  if (existing) {
    folderMap[node.id] = existing.id;
    return existing.id;
  }
  folderMap[node.id] = node.id;
  folders.push({ id: node.id, name: node.name, parent: parentLibId });
  return node.id;
}

export function viewImportTree(rawTree, ignoreSourceFolder) {
  if (!rawTree) return null;
  if (!ignoreSourceFolder) return rawTree;
  return {
    id: "",
    name: "",
    parentId: "",
    entities: rawTree.entities,
    children: rawTree.children.map(child => ({ ...child, parentId: "" }))
  };
}

export function resolveTargetFolder(library, { targetFolderText, targetFolderId, t }) {
  const text = String(targetFolderText || "").trim();
  if (!text) return "";
  if (targetFolderId) {
    const byId = library.folders.find(folder => folder.id === targetFolderId);
    if (byId) return byId.id;
  }
  const byPath = library.folders.find(folder => (folderPathLabel(library, folder.id) || folder.name) === text);
  if (byPath) return byPath.id;
  const byName = library.folders.filter(folder => folder.name === text);
  if (byName.length === 1) return byName[0].id;
  ui.notifications.error(t("targetMissing"));
  return false;
}

export function bindBulkChrome(app, { onListClick } = {}) {
  if (app._chromeBound) return;
  app._chromeBound = true;
  const root = app.element;
  const checks = {
    "import-subfolders": { field: "importSubfolders", reload: true },
    "ignore-source": { field: "ignoreSourceFolder", repaint: true },
    "show-names": { field: "showNames" },
    "show-duplicates": { field: "showDuplicates" }
  };

  root.addEventListener("click", event => {
    const browse = event.target.closest("[data-tom='browse']");
    if (browse && root.contains(browse)) {
      event.preventDefault();
      pickFile({
        type: "folder",
        current: app.folderPath,
        callback: (path, fp) => {
          app.source = fp?.activeSource || "data";
          app.folderPath = path;
          const input = root.querySelector("[data-field='folder-path']");
          if (input) input.value = path;
          app._loadTree();
        }
      });
      return;
    }
    const refresh = event.target.closest("[data-tom='refresh']");
    if (refresh && root.contains(refresh)) {
      event.preventDefault();
      if (app.folderPath) app._loadTree();
      return;
    }
    const suggestion = event.target.closest("[data-suggestions] [data-folder-id]");
    if (suggestion && root.contains(suggestion)) {
      const target = root.querySelector("[data-field='target-folder']");
      const suggestions = root.querySelector("[data-suggestions]");
      app.targetFolderId = suggestion.dataset.folderId;
      app.targetFolderText = suggestion.dataset.path || suggestion.dataset.name || "";
      if (target) target.value = app.targetFolderText;
      if (suggestions) suggestions.hidden = true;
      return;
    }
    const selectAll = event.target.closest("[data-tom='select-all']");
    if (selectAll && root.contains(selectAll)) {
      event.preventDefault();
      app._setIncluded(true);
      return;
    }
    const selectNone = event.target.closest("[data-tom='select-none']");
    if (selectNone && root.contains(selectNone)) {
      event.preventDefault();
      app._setIncluded(false);
      return;
    }
    const commit = event.target.closest("[data-tom='commit']");
    if (commit && root.contains(commit)) {
      event.preventDefault();
      app._commit();
      return;
    }
    if (!event.target.closest("[data-field='target-folder'], [data-suggestions]")) {
      const suggestionsEl = root.querySelector("[data-suggestions]");
      if (suggestionsEl) suggestionsEl.hidden = true;
    }
    if (event.target.closest("[data-bulk-list]") && root.contains(event.target)) {
      if (onListClick?.(event)) return;
      handleBulkListClick(event);
    }
  });

  root.addEventListener("change", event => {
    const field = event.target.closest("[data-field]");
    if (!field || !root.contains(field)) return;
    const spec = checks[field.dataset.field];
    if (!spec) return;
    app[spec.field] = event.target.checked;
    if (spec.reload && app.folderPath) app._loadTree();
    else if (spec.repaint) app._paintList();
    else app._applyListFlags();
  });

  root.addEventListener("input", event => {
    const target = event.target.closest("[data-field='target-folder']");
    if (!target || !root.contains(target)) return;
    app.targetFolderText = target.value;
    app.targetFolderId = "";
    app._rebuildSuggestions();
    app._filterSuggestions(target.value);
  });

  root.addEventListener("focusin", event => {
    const target = event.target.closest("[data-field='target-folder']");
    if (!target || !root.contains(target)) return;
    app._rebuildSuggestions();
    app._filterSuggestions(target.value);
  });
}

function handleBulkListClick(event) {
  const box = event.target.closest("[data-include]");
  const strip = event.target.closest(".tom-lib-strip");
  const folderBox = event.target.closest("[data-folder-include]");
  const folderHeader = event.target.closest(".tom-lib-bulk-folder-header");
  if (event.target.closest("[data-tom='toggle-folder']") || event.target.closest(".tom-lib-bulk-folder-name")) {
    event.preventDefault();
    event.target.closest(".tom-lib-bulk-folder")?.classList.toggle("is-collapsed");
    return true;
  }
  if (folderBox) {
    const folder = folderBox.closest(".tom-lib-bulk-folder");
    const next = folderBox.dataset.checked !== "1";
    folder.querySelectorAll("[data-include]:not(.is-duplicate), [data-folder-include]").forEach(el => {
      el.dataset.checked = next ? "1" : "0";
      el.classList.toggle("is-checked", next);
    });
    return true;
  }
  if (folderHeader) return true;
  if (box || strip) {
    const include = box || strip.closest(".tom-lib-strip-row")?.querySelector("[data-include]");
    if (!include) return true;
    const next = include.dataset.checked !== "1";
    include.dataset.checked = next ? "1" : "0";
    include.classList.toggle("is-checked", next);
    return true;
  }
  return false;
}

export function rebuildFolderSuggestions(root, library) {
  const suggestions = root.querySelector("[data-suggestions]");
  if (!suggestions) return;
  suggestions.innerHTML = library.folders.map(folder => {
    const path = folderPathLabel(library, folder.id) || folder.name;
    return `<button type="button" data-folder-id="${escapeHTML(folder.id)}" data-name="${escapeHTML(folder.name)}" data-path="${escapeHTML(path)}"><i class="fas fa-folder"></i>${escapeHTML(path)}</button>`;
  }).join("");
}

export function filterFolderSuggestions(root, query) {
  const suggestions = root.querySelector("[data-suggestions]");
  if (!suggestions) return;
  const q = String(query || "").trim().toLowerCase();
  let visible = 0;
  suggestions.querySelectorAll("[data-folder-id]").forEach(item => {
    const hay = `${item.dataset.name || ""} ${item.dataset.path || ""}`.toLowerCase();
    const show = !q || hay.includes(q);
    item.hidden = !show;
    if (show) visible += 1;
  });
  suggestions.hidden = !visible;
}

export function collectCheckedStrips(root) {
  return [...root.querySelectorAll(".tom-lib-strip")].filter(el => {
    const include = el.closest(".tom-lib-strip-row")?.querySelector("[data-include]");
    return include?.dataset.checked === "1";
  });
}

export function collectImportFolders(root, tree, library) {
  const folders = [];
  const folderMap = {};
  const checkedFolders = [...root.querySelectorAll(".tom-lib-bulk-folder")].filter(el => {
    const box = el.querySelector(":scope > .tom-lib-bulk-folder-header [data-folder-include]");
    const used = el.querySelector(".tom-lib-strip-row [data-include][data-checked='1']");
    return box?.dataset.checked === "1" || used;
  });
  const byId = Object.fromEntries(flattenFolders(tree).map(node => [node.id, node]));
  for (const el of checkedFolders) {
    const diskId = el.dataset.folderId;
    const node = byId[diskId];
    if (!node?.id) continue;
    resolveDiskFolder(node, byId, library, folderMap, folders);
  }
  for (const strip of collectCheckedStrips(root)) {
    const diskFolder = strip.dataset.folderId;
    if (!diskFolder) continue;
    const node = byId[diskFolder];
    if (node) resolveDiskFolder(node, byId, library, folderMap, folders);
  }
  return { folders, folderMap };
}

export function applyBulkListFlags(app) {
  const wrap = app.root.querySelector("[data-bulk-list]");
  if (!wrap) return null;
  wrap.classList.toggle("show-names", app.showNames);
  wrap.classList.toggle("hide-duplicates", !app.showDuplicates);
  return wrap;
}

export function paintBulkList(app, { t, renderStrip }) {
  const wrap = applyBulkListFlags(app);
  if (!wrap) return;
  const tree = viewImportTree(app.rawTree, app.ignoreSourceFolder);
  if (!tree) {
    wrap.innerHTML = `<p class="notes">${t("bulkEmpty")}</p>`;
    return;
  }
  wrap.innerHTML = app.ignoreSourceFolder
    ? `${tree.children.map(child => folderBlockHTML(child, renderStrip)).join("")}${tree.entities.map(entity => renderStrip({ ...entity, folderId: "" })).join("")}`
    : folderBlockHTML(tree, renderStrip);
}

export function stripRowHTML(entity, { extra = "", duplicateLabel = "" } = {}) {
  const dupAttr = entity.duplicate ? ` data-tooltip="${escapeHTML(duplicateLabel)}"` : "";
  return `
    <div class="tom-lib-strip-row${entity.duplicate ? " is-duplicate" : ""}"${dupAttr}>
      <div class="tom-lib-strip" data-file="${escapeHTML(entity.file)}" data-name="${escapeHTML(entity.name)}" data-folder-id="${escapeHTML(entity.folderId || "")}" title="${escapeHTML(entity.file)}">
        <div class="tom-lib-strip-thumb">
          <img loading="lazy" src="${escapeHTML(fileToSrc(entity.file))}" data-src="${escapeHTML(entity.file)}" alt="">
        </div>
        <div class="tom-lib-strip-name">${escapeHTML(entity.name)}</div>
        ${extra}
      </div>
      <div class="tom-lib-include ${entity.duplicate ? "is-duplicate" : "is-checked"}" data-include ${entity.duplicate ? "" : 'data-checked="1"'} role="button">
        <i class="fas fa-check"></i>
      </div>
    </div>
  `;
}

function folderBlockHTML(node, renderStrip) {
  return `
    <div class="tom-lib-bulk-folder" data-folder-id="${escapeHTML(node.id)}" data-parent-id="${escapeHTML(node.parentId || "")}" data-name="${escapeHTML(node.name)}">
      <div class="tom-lib-bulk-folder-header">
        <button type="button" class="tom-lib-folder-toggle" data-tom="toggle-folder"><i class="fas fa-folder-open"></i></button>
        <span class="tom-lib-bulk-folder-name">${escapeHTML(node.name)}</span>
        <div class="tom-lib-include is-checked" data-folder-include data-checked="1" role="button"><i class="fas fa-check"></i></div>
      </div>
      <div class="tom-lib-bulk-folder-body">
        ${node.children.map(child => folderBlockHTML(child, renderStrip)).join("")}
        ${node.entities.map(entity => renderStrip({ ...entity, folderId: node.id })).join("")}
      </div>
    </div>
  `;
}
