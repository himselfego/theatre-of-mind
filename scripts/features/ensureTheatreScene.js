import { MODULE_ID } from "../core/constants.js";

const FOLDER_NAME = "Theatre of Mind";
export const SCENE_NAME = "Scene";
export const SCENE_WIDTH = 1920;
export const SCENE_HEIGHT = 1080;

let lockingView = false;

function sceneFolderId(scene) {
  const folder = scene?.folder;
  if (!folder) return "";
  return typeof folder === "string" ? folder : (folder.id || "");
}

function sceneFolderName(scene) {
  const folder = scene?.folder;
  if (!folder) return "";
  if (typeof folder === "string") return game.folders.get(folder)?.name || "";
  return folder.name || "";
}

export function isTheatreStage(scene = canvas?.scene) {
  if (!scene) return false;
  if (scene.getFlag(MODULE_ID, "stage")) return true;
  return scene.name === SCENE_NAME && sceneFolderName(scene) === FOLDER_NAME;
}

export function getTheatreScene() {
  const scenes = game.scenes?.contents ?? [];
  return scenes.find(s => s.getFlag(MODULE_ID, "stage"))
    ?? scenes.find(s => s.name === SCENE_NAME && sceneFolderName(s) === FOLDER_NAME)
    ?? null;
}

const STAGE_LIGHT_RADIUS = 140;
const STAGE_LIGHT_COLOR = "#fcd674";

function colorHex(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "number") return `#${value.toString(16).padStart(6, "0")}`;
  if (typeof value.css === "function") return String(value.css()).toLowerCase();
  return String(value).toLowerCase();
}

function stageLightData(width, height) {
  return {
    x: width / 2,
    y: height / 2,
    walls: false,
    vision: false,
    flags: { [MODULE_ID]: { stageLight: true } },
    config: {
      dim: STAGE_LIGHT_RADIUS,
      bright: STAGE_LIGHT_RADIUS,
      color: STAGE_LIGHT_COLOR,
      attenuation: 0.75,
      luminosity: 0.6,
      darkness: { min: 0, max: 1 },
      animation: {
        type: "torch",
        speed: 5,
        intensity: 1,
        reverse: true
      }
    }
  };
}

function findStageLight(scene) {
  return scene?.lights?.find(light => light.getFlag?.(MODULE_ID, "stageLight")) ?? null;
}

export async function ensureStageLight(scene, { recenter = false } = {}) {
  if (!scene) return;
  const data = stageLightData(scene.width ?? SCENE_WIDTH, scene.height ?? SCENE_HEIGHT);
  const existing = findStageLight(scene);
  if (!existing) {
    await scene.createEmbeddedDocuments("AmbientLight", [data]);
    return;
  }
  const patch = {};
  if (recenter) {
    if (existing.x !== data.x) patch.x = data.x;
    if (existing.y !== data.y) patch.y = data.y;
  }
  const cfg = existing.config ?? {};
  const next = data.config;
  if (Number(cfg.dim) !== next.dim) patch["config.dim"] = next.dim;
  if (Number(cfg.bright) !== next.bright) patch["config.bright"] = next.bright;
  if (Number(cfg.attenuation) !== next.attenuation) patch["config.attenuation"] = next.attenuation;
  if (Number(cfg.luminosity) !== next.luminosity) patch["config.luminosity"] = next.luminosity;
  if (colorHex(cfg.color) !== next.color) patch["config.color"] = next.color;
  const anim = cfg.animation ?? {};
  if (anim.type !== next.animation.type) patch["config.animation.type"] = next.animation.type;
  if (Number(anim.speed) !== next.animation.speed) patch["config.animation.speed"] = next.animation.speed;
  if (Number(anim.intensity) !== next.animation.intensity) patch["config.animation.intensity"] = next.animation.intensity;
  if (!!anim.reverse !== next.animation.reverse) patch["config.animation.reverse"] = next.animation.reverse;
  if (Object.keys(patch).length) await existing.update(patch);
}

export async function ensureTheatreSceneDocument() {
  let folder = game.folders.find(f => f.type === "Scene" && f.name === FOLDER_NAME);
  if (!folder) folder = await CONFIG.Folder.documentClass.create({ name: FOLDER_NAME, type: "Scene" });

  let scene = getTheatreScene()
    ?? game.scenes.find(s => s.name === SCENE_NAME && sceneFolderId(s) === folder.id);
  if (!scene) scene = await CONFIG.Scene.documentClass.create(sceneSetupData(folder.id));
  else {
    if (!scene.getFlag(MODULE_ID, "stage")) await scene.setFlag(MODULE_ID, "stage", true);
    const patch = {};
    if (scene.padding !== 0) patch.padding = 0;
    if (scene.tokenVision) patch.tokenVision = false;
    if (Object.keys(patch).length) await scene.update(patch);
  }
  try {
    await ensureStageLight(scene);
  } catch (error) {
    console.error("[theatre-of-mind] stage light failed", error);
  }
  return scene;
}

export async function openTheatreScene() {
  const scene = getTheatreScene();
  if (!scene) return;
  if (!scene.active) await scene.activate();
  else if (canvas.scene?.id !== scene.id) await scene.view();
}

function sceneSetupData(folderId) {
  const gridless = CONST.GRID_TYPES?.GRIDLESS ?? 0;
  const data = {
    name: SCENE_NAME,
    folder: folderId,
    width: SCENE_WIDTH,
    height: SCENE_HEIGHT,
    padding: 0,
    backgroundColor: "#000000",
    tokenVision: false,
    flags: { [MODULE_ID]: { stage: true } },
    lights: [stageLightData(SCENE_WIDTH, SCENE_HEIGHT)]
  };
  if ((game.release?.generation ?? 12) >= 13) data.grid = { type: gridless, size: 8 };
  else {
    data.grid = 8;
    data.gridType = gridless;
  }
  return data;
}

function lockedView() {
  const { sceneWidth, sceneHeight, sceneX, sceneY } = canvas.dimensions;
  const { width, height } = canvas.app.renderer.screen;
  return {
    x: sceneX + sceneWidth / 2,
    y: sceneY + sceneHeight / 2,
    scale: Math.max(width / sceneWidth, height / sceneHeight)
  };
}

function lockTheatreView() {
  if (!canvas?.ready || !isTheatreStage() || lockingView) return;
  const next = lockedView();
  const cur = canvas.scene?._viewPosition;
  if (cur && Math.abs(cur.x - next.x) < 0.5 && Math.abs(cur.y - next.y) < 0.5 && Math.abs((cur.scale ?? 0) - next.scale) < 0.0005) {
    return;
  }
  lockingView = true;
  canvas.pan(next);
  lockingView = false;
}

Hooks.once("ready", async () => {
  if (game.user === game.users.activeGM) await ensureTheatreSceneDocument();

  document.addEventListener("wheel", event => {
    if (!isTheatreStage() || !event.target.closest?.("#board")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, passive: false });

  const board = document.getElementById("board");
  if (board) new ResizeObserver(lockTheatreView).observe(board);
});

Hooks.on("canvasReady", () => requestAnimationFrame(lockTheatreView));
Hooks.on("canvasPan", lockTheatreView);
Hooks.on("collapseSidebar", lockTheatreView);
Hooks.on("updateScene", (scene, diff) => {
  if (game.user !== game.users?.activeGM) return;
  if (!isTheatreStage(scene) || !("width" in diff || "height" in diff)) return;
  ensureStageLight(scene, { recenter: true }).catch(error => {
    console.error("[theatre-of-mind] stage light recenter failed", error);
  });
});
