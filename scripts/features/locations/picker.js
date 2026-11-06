import { MODULE_ID } from "../../core/constants.js";
import { confirmDialog, contextMenu, escapeHTML, fileToSrc, menuItem, t } from "./shared.js";
import {
  LOCATIONS_CHANGED,
  createFolder,
  deleteFolderCascade,
  deleteLocation,
  getLibrary,
  moveLocation,
  renameFolder,
  sortLocations,
  unwrapFolder
} from "./store.js";
import { applyLocation, clearLocation } from "./stage.js";
import { LocationEditorApp } from "./editor.js";
import { BulkLocationCreatorApp } from "./bulk.js";
import {
  applyGallerySize,
  bindPickerCardEvents,
  bindPickerChrome,
  confirmUnwrapFolder,
  filterLibraryItems,
  folderIdFrom,
  libraryTabsContext,
  paintFolderTree,
  pickerLabels,
  promptCreateFolder,
  promptRenameFolder,
  realFolderId,
  registerLibraryTab,
  restorePickerState,
  savePickerState
} from "../../lib/libraryPicker.js";

const LIBRARY_TAB = "locations";
const ApplicationV2 = foundry.applications.api.ApplicationV2;
const HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;

export class LocationPickerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tom-location-picker",
    classes: ["tom-location-picker"],
    position: { width: 1100, height: 720 },
    window: { resizable: true }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/library/picker.hbs` }
  };

  constructor(options = {}) {
    super(foundry.utils.mergeObject({
      window: { title: t("pickerTitle") }
    }, options, { inplace: false }));
    restorePickerState(this, LIBRARY_TAB);
    this._onLibraryChange = () => {
      if (this.rendered) this.render({ force: true });
    };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      search: this.search,
      size: this.size,
      tabs: libraryTabsContext(LIBRARY_TAB),
      labels: pickerLabels(t, "createLocation")
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    LocationPickerApp.instance = this;
    Hooks.off(LOCATIONS_CHANGED, this._onLibraryChange);
    Hooks.on(LOCATIONS_CHANGED, this._onLibraryChange);
    this.root = this.element;
    this._paint();
    bindPickerChrome(this, {
      onCreateItem: folderId => new LocationEditorApp({ folderId }).render({ force: true }),
      onCreateBulk: () => new BulkLocationCreatorApp().render({ force: true })
    });
    if (!this._menusBound) {
      this._bindMenus();
      this._menusBound = true;
    }
  }

  async close(options) {
    savePickerState(this, LIBRARY_TAB);
    this._menusBound = false;
    Hooks.off(LOCATIONS_CHANGED, this._onLibraryChange);
    if (LocationPickerApp.instance === this) LocationPickerApp.instance = null;
    return super.close(options);
  }

  _targetFolderId() {
    return this.filterFolderId || "";
  }

  _bindMenus() {
    const root = this.element;
    const cardItems = () => [
      menuItem({
        label: t("edit"),
        icon: '<i class="fas fa-edit"></i>',
        onClick: (_event, header) => {
          const id = folderIdFrom(header, "locationId");
          if (id) new LocationEditorApp({ locationId: id }).render({ force: true });
        }
      }),
      menuItem({
        label: t("delete"),
        icon: '<i class="fas fa-trash"></i>',
        onClick: async (_event, header) => {
          const id = folderIdFrom(header, "locationId");
          if (!id) return;
          const ok = await confirmDialog(t("deleteConfirm"));
          if (ok) {
            const wasActive = await deleteLocation(id);
            if (wasActive) await clearLocation();
            ui.notifications.info(t("deleted"));
          }
        }
      })
    ];
    const folderItems = () => [
      menuItem({
        label: t("createLocation"),
        icon: '<i class="fas fa-plus"></i>',
        onClick: (_event, header) => {
          new LocationEditorApp({ folderId: realFolderId(folderIdFrom(header, "folderId")) }).render({ force: true });
        }
      }),
      menuItem({
        label: t("createBulk"),
        icon: '<i class="fas fa-layer-group"></i>',
        onClick: () => new BulkLocationCreatorApp().render({ force: true })
      }),
      menuItem({
        label: t("createFolder"),
        icon: '<i class="fas fa-folder-plus"></i>',
        onClick: (_event, header) => this._createFolder(realFolderId(folderIdFrom(header, "folderId")))
      }),
      menuItem({
        label: t("renameFolder"),
        icon: '<i class="fas fa-i-cursor"></i>',
        visible: header => !!realFolderId(folderIdFrom(header, "folderId")),
        onClick: (_event, header) => this._renameFolder(realFolderId(folderIdFrom(header, "folderId")))
      }),
      menuItem({
        label: t("unwrapFolder"),
        icon: '<i class="fas fa-folder-minus"></i>',
        visible: header => !!realFolderId(folderIdFrom(header, "folderId")),
        onClick: (_event, header) => confirmUnwrapFolder({
          t,
          unwrapFolder,
          folderId: realFolderId(folderIdFrom(header, "folderId"))
        })
      }),
      menuItem({
        label: t("deleteFolder"),
        icon: '<i class="fas fa-dumpster"></i>',
        visible: header => !!realFolderId(folderIdFrom(header, "folderId")),
        onClick: async (_event, header) => {
          const id = realFolderId(folderIdFrom(header, "folderId"));
          const ok = await confirmDialog(t("deleteFolderConfirm"));
          if (ok) {
            const wasActive = await deleteFolderCascade(id);
            if (wasActive) await clearLocation();
          }
        }
      })
    ];

    contextMenu(root, ".tom-loc-card", cardItems());
    contextMenu(root, ".tom-lib-folder-header", folderItems());
  }

  _createFolder(parentId) {
    return promptCreateFolder(this, { t, createFolder, parentId });
  }

  _renameFolder(folderId) {
    return promptRenameFolder(this, { t, getLibrary, renameFolder, folderId });
  }

  _paint() {
    if (this.filterFolderId && !getLibrary().folders.some(folder => folder.id === this.filterFolderId)) {
      this.filterFolderId = null;
    }
    this._paintFolders();
    this._paintGallery();
  }

  _paintFolders() {
    paintFolderTree(this, {
      library: getLibrary(),
      allLabel: t("allLocations"),
      rootLabel: t("rootFolder"),
      onDropItem: (locationId, folderId) => moveLocation(locationId, folderId)
    });
  }

  _paintGallery() {
    const wrap = applyGallerySize(this);
    if (!wrap) return;
    const library = getLibrary();
    const locations = filterLibraryItems(sortLocations(library.locations), {
      filterFolderId: this.filterFolderId,
      search: this.search
    });
    wrap.innerHTML = locations.length
      ? locations.map(location => cardHTML(location, location.id === this.selectedId, location.id === library.activeId)).join("")
      : `<p class="notes">${t("emptyGallery")}</p>`;
    bindPickerCardEvents(wrap, {
      cardSelector: ".tom-loc-card",
      onSelect: card => {
        this.selectedId = card.dataset.locationId;
        wrap.querySelectorAll(".tom-loc-card").forEach(el => {
          el.classList.toggle("is-selected", el.dataset.locationId === this.selectedId);
        });
      },
      onActivate: card => {
        const id = card.dataset.locationId;
        if (id) applyLocation(id);
      }
    });
  }
}

LocationPickerApp.instance = null;
registerLibraryTab(LIBRARY_TAB, LocationPickerApp, "GINZZZUPORTRAITS.Locations.tabLibrary");

function cardHTML(location, selected, playing) {
  const outdoors = !!location.outdoors;
  return `
    <div class="tom-loc-card ${selected ? "is-selected" : ""} ${playing ? "is-playing" : ""} ${outdoors ? "is-outdoors" : ""}"
         draggable="true"
         data-location-id="${escapeHTML(location.id)}"
         data-folder-id="${escapeHTML(location.folder || "")}">
      <div class="tom-loc-card-thumb">
        <img loading="lazy" src="${escapeHTML(fileToSrc(location.image))}" alt="">
        <span class="tom-loc-card-flag" title="${outdoors ? t("outdoor") : t("indoor")}">
          <i class="fas ${outdoors ? "fa-tree" : "fa-home"}"></i>
        </span>
      </div>
      <div class="tom-loc-card-name">${escapeHTML(location.name)}</div>
    </div>
  `;
}
