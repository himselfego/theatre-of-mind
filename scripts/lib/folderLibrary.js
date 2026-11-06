function folderParent(folder) {
  return folder?.parent || "";
}

export function childFolders(library, parentId) {
  return library.folders
    .filter(folder => folderParent(folder) === (parentId || ""))
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang || undefined, { sensitivity: "base" }));
}

function descendantFolderIds(library, folderId) {
  const ids = new Set([folderId]);
  const walk = parentId => {
    for (const folder of library.folders) {
      if (folderParent(folder) === parentId && !ids.has(folder.id)) {
        ids.add(folder.id);
        walk(folder.id);
      }
    }
  };
  walk(folderId);
  return ids;
}

export function folderPathLabel(library, folderId) {
  const names = [];
  let current = library.folders.find(folder => folder.id === folderId);
  const guard = new Set();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    names.unshift(current.name);
    current = library.folders.find(folder => folder.id === folderParent(current));
  }
  return names.join(" / ");
}

export function folderSelectOptions(library, selectedId = "", rootLabel = "") {
  const options = [{ id: "", label: rootLabel, selected: !selectedId }];
  const walk = (parentId, prefix) => {
    for (const folder of childFolders(library, parentId)) {
      const label = prefix ? `${prefix} / ${folder.name}` : folder.name;
      options.push({ id: folder.id, label, selected: folder.id === selectedId });
      walk(folder.id, label);
    }
  };
  walk("", "");
  return options;
}

export function sortByName(items) {
  return [...items].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", game.i18n.lang || undefined, { sensitivity: "base" })
  );
}

export function emptyFolder({ name, parent = "" } = {}) {
  return { id: foundry.utils.randomID(), name, parent: parent || "" };
}

export function unwrapFolderInLibrary(library, folderId, itemsKey) {
  const folder = library.folders.find(item => item.id === folderId);
  if (!folder) return false;
  const parentId = folderParent(folder);
  for (const item of library[itemsKey] || []) {
    if (item.folder === folderId) item.folder = parentId;
  }
  for (const child of library.folders) {
    if (folderParent(child) === folderId) child.parent = parentId;
  }
  library.folders = library.folders.filter(item => item.id !== folderId);
  return true;
}

export function deleteFolderCascadeInLibrary(library, folderId, itemsKey) {
  const ids = descendantFolderIds(library, folderId);
  const removed = (library[itemsKey] || [])
    .filter(item => ids.has(item.folder || ""))
    .map(item => item.id);
  library[itemsKey] = (library[itemsKey] || []).filter(item => !ids.has(item.folder || ""));
  library.folders = library.folders.filter(folder => !ids.has(folder.id));
  if (Array.isArray(library.favorites)) {
    library.favorites = library.favorites.filter(id => !removed.includes(id));
  }
  return removed;
}
