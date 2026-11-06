import { MODULE_ID } from "../../core/constants.js";
import { fileToSrc, nameFromPath, pickFile, t } from "./shared.js";
import { createLocation, folderSelectOptions, getLibrary, updateLocation } from "./store.js";

const ApplicationV2 = foundry.applications.api.ApplicationV2;
const HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;

export class LocationEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["tom-location-editor"],
    position: { width: 560, height: "auto" },
    window: { resizable: true }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/locations/editor.hbs` }
  };

  constructor({ locationId = null, folderId = "" } = {}, options = {}) {
    super(foundry.utils.mergeObject({
      id: locationId ? `tom-location-editor-${locationId}` : "tom-location-editor-new",
      window: { title: locationId ? t("editorTitle") : t("editorTitleCreate") }
    }, options, { inplace: false }));
    this.locationId = locationId;
    this.folderId = folderId || "";
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const library = getLibrary();
    const location = library.locations.find(item => item.id === this.locationId);
    const folderId = location ? (location.folder || "") : this.folderId;
    return {
      ...context,
      name: location?.name ?? "",
      image: location?.image ?? "",
      outdoors: !!location?.outdoors,
      folders: folderSelectOptions(library, folderId)
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    root.querySelector("[data-tom='pick-image']")?.addEventListener("click", event => {
      event.preventDefault();
      const imageInput = root.querySelector("[data-field='image']");
      pickFile({
        type: "image",
        current: imageInput.value,
        callback: path => {
          imageInput.value = path;
          this._syncPreview(root);
          const nameInput = root.querySelector("[data-field='name']");
          if (path && !nameInput.value.trim()) nameInput.value = nameFromPath(path);
        }
      });
    });
    root.querySelector("[data-field='image']")?.addEventListener("change", () => this._syncPreview(root));
    root.querySelector("[data-tom='save']")?.addEventListener("click", event => {
      event.preventDefault();
      this._save(root);
    });
    this._syncPreview(root);
  }

  _syncPreview(root) {
    const path = root.querySelector("[data-field='image']")?.value.trim() || "";
    const img = root.querySelector("[data-preview] img");
    const empty = root.querySelector("[data-preview-empty]");
    if (!img) return;
    if (path) {
      img.src = fileToSrc(path);
      img.hidden = false;
      if (empty) empty.hidden = true;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      if (empty) empty.hidden = false;
    }
  }

  async _save(root) {
    const name = root.querySelector("[data-field='name']")?.value.trim() || "";
    const image = root.querySelector("[data-field='image']")?.value.trim() || "";
    const folder = root.querySelector("[data-field='folder']")?.value || "";
    const outdoors = !!root.querySelector("[data-field='outdoors']")?.checked;
    if (!name) return ui.notifications.warn(t("needName"));
    if (!image) return ui.notifications.warn(t("needImage"));

    if (this.locationId) {
      await updateLocation(this.locationId, { name, image, folder, outdoors });
      ui.notifications.info(t("saved"));
    } else {
      await createLocation({ name, image, folder, outdoors });
      ui.notifications.info(t("created"));
    }
    this.close();
  }
}
