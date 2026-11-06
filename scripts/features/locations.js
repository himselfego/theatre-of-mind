import { MODULE_ID } from "../core/constants.js";
import { SETTING_KEY } from "./locations/shared.js";
import { emptyLibrary } from "./locations/store.js";
import {
  bindLocationDockHooks,
  registerLocationDockSettings
} from "./locations/dock.js";
import { bindRemoteLocationTransition } from "./locations/stage.js";
import { bindLocationTitleHooks } from "./locations/title.js";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING_KEY, {
    scope: "world",
    config: false,
    type: Object,
    default: emptyLibrary()
  });
  registerLocationDockSettings();
});

Hooks.once("ready", () => {
  bindLocationDockHooks();
  bindLocationTitleHooks();
  bindRemoteLocationTransition();
});
