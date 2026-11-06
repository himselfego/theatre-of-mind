import { MODULE_ID } from "../../core/constants.js";
import { t } from "./shared.js";
import { createMany, folderPathLabel, getLibrary } from "./store.js";
import {
  applyBulkListFlags,
  bindBulkChrome,
  browseImageTree,
  bulkLabels,
  collectCheckedStrips,
  collectImportFolders,
  countFiles,
  filterFolderSuggestions,
  paintBulkList,
  rebuildFolderSuggestions,
  resolveTargetFolder,
  stripRowHTML,
  viewImportTree
} from "../../lib/libraryBulk.js";
import { normPath } from "../../lib/sharedUi.js";

const ApplicationV2 = foundry.applications.api.ApplicationV2;
const HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;

export class BulkPersonaCreatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tom-persona-bulk",
    classes: ["tom-persona-bulk"],
    position: { width: 640, height: 850 },
    window: { resizable: true }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/library/bulk.hbs` }
  };

  constructor(options = {}) {
    super(foundry.utils.mergeObject({
      window: { title: t("bulkTitle") }
    }, options, { inplace: false }));
    this.source = "data";
    this.folderPath = "";
    this.rawTree = null;
    this.importSubfolders = true;
    this.ignoreSourceFolder = true;
    this.showNames = false;
    this.showDuplicates = true;
    this.targetFolderText = "";
    this.targetFolderId = "";
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const library = getLibrary();
    return {
      ...context,
      folderPath: this.folderPath,
      importSubfolders: this.importSubfolders,
      ignoreSourceFolder: this.ignoreSourceFolder,
      showNames: this.showNames,
      showDuplicates: this.showDuplicates,
      targetFolderText: this.targetFolderText,
      labels: bulkLabels(t),
      folders: library.folders.map(folder => ({
        id: folder.id,
        name: folder.name,
        path: folderPathLabel(library, folder.id) || folder.name
      }))
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.root = this.element;
    bindBulkChrome(this);
    this._paintList();
  }

  _rebuildSuggestions() {
    rebuildFolderSuggestions(this.root, getLibrary());
  }

  _filterSuggestions(query) {
    filterFolderSuggestions(this.root, query);
  }

  async _loadTree() {
    try {
      this.rawTree = await browseImageTree(this.source, this.folderPath, {
        subfolders: this.importSubfolders,
        usedPaths: new Set(getLibrary().personas.map(persona => normPath(persona.image)))
      });
    } catch (error) {
      console.error(error);
      ui.notifications.error(t("browseFailed"));
      return;
    }
    if (!countFiles(this.rawTree)) ui.notifications.warn(t("noImages"));
    this.render({ force: true });
  }

  _applyListFlags() {
    applyBulkListFlags(this);
  }

  _paintList() {
    paintBulkList(this, {
      t,
      renderStrip: entity => stripRowHTML(entity, { duplicateLabel: t("duplicate") })
    });
  }

  _setIncluded(on) {
    this.root.querySelectorAll("[data-include]:not(.is-duplicate), [data-folder-include]").forEach(el => {
      el.dataset.checked = on ? "1" : "0";
      el.classList.toggle("is-checked", on);
    });
  }

  async _commit() {
    const strips = collectCheckedStrips(this.root);
    if (!strips.length) return ui.notifications.warn(t("noneSelected"));

    const library = getLibrary();
    const dumpId = resolveTargetFolder(library, {
      targetFolderText: this.targetFolderText,
      targetFolderId: this.targetFolderId,
      t
    });
    if (dumpId === false) return;

    let folders = [];
    let folderMap = {};
    if (!dumpId) {
      ({ folders, folderMap } = collectImportFolders(this.root, this._viewTree(), library));
    }

    const personas = strips.map(strip => ({
      id: foundry.utils.randomID(),
      name: strip.dataset.name,
      image: strip.dataset.file,
      folder: dumpId || folderMap[strip.dataset.folderId] || ""
    }));

    this.close();
    await createMany({ folders, personas });
    ui.notifications.info(t("imported"));
  }

  _viewTree() {
    return viewImportTree(this.rawTree, this.ignoreSourceFolder);
  }
}
