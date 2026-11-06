import { MODULE_ID } from "../core/constants.js";
import { SETTING_KEY } from "./personas/shared.js";
import { emptyLibrary } from "./personas/store.js";
import { bindPersonaDockHooks, registerPersonaDockSettings } from "./personas/dock.js";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING_KEY, {
    scope: "world",
    config: false,
    type: Object,
    default: emptyLibrary()
  });
  registerPersonaDockSettings();
});

Hooks.once("ready", () => {
  bindPersonaDockHooks();
});
