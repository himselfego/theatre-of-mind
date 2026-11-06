import { MODULE_ID } from "../../core/constants.js";
import { fileToSrc, nameFromPath, pickFile, t } from "./shared.js";
import { createPersona, folderSelectOptions, getLibrary, getPersona, updatePersona } from "./store.js";

const ApplicationV2 = foundry.applications.api.ApplicationV2;
const HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;

export class PersonaEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["tom-persona-editor"],
    position: { width: 680, height: "auto" },
    window: { resizable: true }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/personas/editor.hbs` }
  };

  constructor({ personaId = null, folderId = "" } = {}, options = {}) {
    super(foundry.utils.mergeObject({
      id: personaId ? `tom-persona-editor-${personaId}` : "tom-persona-editor-new",
      window: { title: personaId ? t("editorTitle") : t("editorTitleCreate") }
    }, options, { inplace: false }));
    this.personaId = personaId;
    this.folderId = folderId || "";
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const library = getLibrary();
    const persona = this.personaId ? getPersona(this.personaId) : null;
    const folderId = persona ? (persona.folder || "") : this.folderId;
    const boundActorUuid = persona?.boundActorUuid || "";
    const actors = (game.actors?.contents ?? []).map(actor => ({
      uuid: actor.uuid,
      name: actor.name,
      selected: actor.uuid === boundActorUuid
    })).sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang || undefined, { sensitivity: "base" }));
    const boundFound = actors.some(actor => actor.uuid === boundActorUuid);
    return {
      ...context,
      name: persona?.name ?? "",
      image: persona?.image ?? "",
      isPlayer: !!persona?.isPlayer,
      boundActorUuid,
      brokenBind: !!(boundActorUuid && !boundFound),
      folders: folderSelectOptions(library, folderId),
      actors,
      portraitHeightMultiplier: persona?.portraitHeightMultiplier ?? 1,
      portraitBreathingMultiplier: persona?.portraitBreathingMultiplier ?? 1
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
    root.querySelector("[data-tom='clear-bind']")?.addEventListener("click", event => {
      event.preventDefault();
      const select = root.querySelector("[data-field='boundActorUuid']");
      if (select) select.value = "";
    });
    root.querySelector("[data-tom='open-sheet']")?.addEventListener("click", async event => {
      event.preventDefault();
      const uuid = root.querySelector("[data-field='boundActorUuid']")?.value;
      if (!uuid) return;
      const actor = await fromUuid(uuid);
      actor?.sheet?.render(true);
    });
    root.querySelectorAll("input[type='range'][data-field]").forEach(range => {
      const number = root.querySelector(`input[data-sync='${range.dataset.field}']`);
      range.addEventListener("input", () => { if (number) number.value = range.value; });
      number?.addEventListener("input", () => { range.value = number.value; });
    });
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
    if (!name) return ui.notifications.warn(t("needName"));
    if (!image) return ui.notifications.warn(t("needImage"));
    const payload = {
      name,
      image,
      folder: root.querySelector("[data-field='folder']")?.value || "",
      isPlayer: !!root.querySelector("[data-field='isPlayer']")?.checked,
      boundActorUuid: root.querySelector("[data-field='boundActorUuid']")?.value || "",
      portraitHeightMultiplier: Number(root.querySelector("[data-field='portraitHeightMultiplier']")?.value ?? 1),
      portraitBreathingMultiplier: Number(root.querySelector("[data-field='portraitBreathingMultiplier']")?.value ?? 1)
    };
    if (this.personaId) {
      await updatePersona(this.personaId, payload);
      ui.notifications.info(t("saved"));
    } else {
      await createPersona(payload);
      ui.notifications.info(t("created"));
    }
    this.close();
  }
}
