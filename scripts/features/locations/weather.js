import { MODULE_ID } from "../../core/constants.js";
import { getTheatreScene } from "../ensureTheatreScene.js";
import { SETTING_KEY } from "./shared.js";
import { getLibrary } from "./store.js";

// Simple Timekeeping keeps writing the scene weather. A region only hides it indoors,
// so going back outdoors shows the current weather at once.
const REGION_NAME = "Theatre of Mind: weather";
// Bigger than any background, so the region does not have to follow the scene size.
const REGION_MARGIN = 1000;
const REGION_SIZE = 20000;

let syncQueue = Promise.resolve();

async function syncStageWeather() {
  if (game.user !== game.users?.activeGM) return;
  const scene = getTheatreScene();
  if (!scene) return;

  const library = getLibrary();
  const location = library.locations.find(item => item.id === library.activeId);
  const indoors = !!location && !location.outdoors;

  const region = scene.regions.getName(REGION_NAME);
  if (!region) {
    if (!indoors) return;
    await scene.createEmbeddedDocuments("Region", [{
      name: REGION_NAME,
      locked: true,
      shapes: [{ type: "rectangle", x: -REGION_MARGIN, y: -REGION_MARGIN, width: REGION_SIZE, height: REGION_SIZE }],
      behaviors: [{ type: "suppressWeather" }]
    }]);
    return;
  }

  const behavior = region.behaviors.find(item => item.type === "suppressWeather");
  if (behavior && behavior.disabled === indoors) await behavior.update({ disabled: !indoors });
}

function requestSync() {
  syncQueue = syncQueue
    .then(syncStageWeather)
    .catch(error => console.error("[theatre-of-mind] stage weather update failed", error));
}

function onSetting(setting) {
  if (setting?.key === `${MODULE_ID}.${SETTING_KEY}`) requestSync();
}

export function bindStageWeatherHooks() {
  requestSync();
  Hooks.on("createSetting", onSetting);
  Hooks.on("updateSetting", onSetting);
}
