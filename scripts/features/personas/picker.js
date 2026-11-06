import { MODULE_ID } from "../../core/constants.js";
import { confirmDialog, contextMenu, escapeHTML, fileToSrc, menuItem, t } from "./shared.js";
import {
  PERSONAS_CHANGED,
  createFolder,
  deleteFolderCascade,
  deletePersona,
  getLibrary,
  movePersona,
  renameFolder,
  sortPersonas,
  unwrapFolder
} from "./store.js";
import { CAST_CHANGED, isOnStage, removePersonasFromCast, showPersona } from "./stage.js";
import { PersonaEditorApp } from "./editor.js";
import { BulkPersonaCreatorApp } from "./bulk.js";
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

const LIBRARY_TAB = "personas";
const ApplicationV2 = foundry.applications.api.ApplicationV2;
const HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;

export class PersonaPickerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tom-persona-picker",
    classes: ["tom-persona-picker"],
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
      labels: pickerLabels(t, "createPersona")
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    PersonaPickerApp.instance = this;
    Hooks.off(PERSONAS_CHANGED, this._onLibraryChange);
    Hooks.off(CAST_CHANGED, this._onLibraryChange);
    Hooks.on(PERSONAS_CHANGED, this._onLibraryChange);
    Hooks.on(CAST_CHANGED, this._onLibraryChange);
    this.root = this.element;
    this._paint();
    bindPickerChrome(this, {
      onCreateItem: folderId => new PersonaEditorApp({ folderId }).render({ force: true }),
      onCreateBulk: () => new BulkPersonaCreatorApp().render({ force: true })
    });
    if (!this._menusBound) {
      this._bindMenus();
      this._menusBound = true;
    }
  }

  async close(options) {
    savePickerState(this, LIBRARY_TAB);
    this._menusBound = false;
    Hooks.off(PERSONAS_CHANGED, this._onLibraryChange);
    Hooks.off(CAST_CHANGED, this._onLibraryChange);
    if (PersonaPickerApp.instance === this) PersonaPickerApp.instance = null;
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
          const id = folderIdFrom(header, "personaId");
          if (id) new PersonaEditorApp({ personaId: id }).render({ force: true });
        }
      }),
      menuItem({
        label: t("delete"),
        icon: '<i class="fas fa-trash"></i>',
        onClick: async (_event, header) => {
          const id = folderIdFrom(header, "personaId");
          if (!id) return;
          const ok = await confirmDialog(t("deleteConfirm"));
          if (ok) {
            await deletePersona(id);
            await removePersonasFromCast([id]);
            ui.notifications.info(t("deleted"));
          }
        }
      })
    ];
    const folderItems = () => [
      menuItem({
        label: t("createPersona"),
        icon: '<i class="fas fa-plus"></i>',
        onClick: (_event, header) => {
          new PersonaEditorApp({ folderId: realFolderId(folderIdFrom(header, "folderId")) }).render({ force: true });
        }
      }),
      menuItem({
        label: t("createBulk"),
        icon: '<i class="fas fa-layer-group"></i>',
        onClick: () => new BulkPersonaCreatorApp().render({ force: true })
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
            const removed = await deleteFolderCascade(id);
            await removePersonasFromCast(removed);
          }
        }
      })
    ];

    contextMenu(root, ".tom-persona-card", cardItems());
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
      allLabel: t("allPersonas"),
      rootLabel: t("rootFolder"),
      onDropItem: (personaId, folderId) => movePersona(personaId, folderId)
    });
  }

  _paintGallery() {
    const wrap = applyGallerySize(this);
    if (!wrap) return;
    const library = getLibrary();
    const personas = filterLibraryItems(sortPersonas(library.personas), {
      filterFolderId: this.filterFolderId,
      search: this.search
    });
    wrap.innerHTML = personas.length
      ? personas.map(persona => cardHTML(persona, persona.id === this.selectedId, isOnStage(persona.id))).join("")
      : `<p class="notes">${t("emptyGallery")}</p>`;
    bindPickerCardEvents(wrap, {
      cardSelector: ".tom-persona-card",
      onSelect: card => {
        this.selectedId = card.dataset.personaId;
        wrap.querySelectorAll(".tom-persona-card").forEach(el => {
          el.classList.toggle("is-selected", el.dataset.personaId === this.selectedId);
        });
      },
      onActivate: card => {
        const id = card.dataset.personaId;
        if (id) showPersona(id);
      }
    });
  }
}

PersonaPickerApp.instance = null;
registerLibraryTab(LIBRARY_TAB, PersonaPickerApp, "GINZZZUPORTRAITS.Personas.tabPersonas");

function cardHTML(persona, selected, playing) {
  return `
    <div class="tom-persona-card ${selected ? "is-selected" : ""} ${playing ? "is-playing" : ""}"
         draggable="true"
         data-persona-id="${escapeHTML(persona.id)}"
         data-folder-id="${escapeHTML(persona.folder || "")}">
      <div class="tom-persona-card-thumb">
        <img loading="lazy" src="${escapeHTML(fileToSrc(persona.image))}" alt="">
      </div>
      <div class="tom-persona-card-name">${escapeHTML(persona.name)}</div>
    </div>
  `;
}
