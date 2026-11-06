import { MODULE_ID } from "../core/constants.js";
import { bindEffectsDockHooks } from "./effects/dock.js";
import { applyEffects, bindEffects, CALM_KEY, registerEffectKeybindings, TARGET_KEY } from "./effects/stage.js";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, CALM_KEY, {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.effectsCalm.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.effectsCalm.hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false,
    onChange: () => applyEffects()
  });
  game.settings.register(MODULE_ID, TARGET_KEY, { scope: "client", config: false, type: String, default: "all" });
  registerEffectKeybindings();
});

Hooks.once("ready", () => {
  bindEffects();
  bindEffectsDockHooks();
});
