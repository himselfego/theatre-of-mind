import { MODULE_ID } from "../../core/constants.js";
import { SETTING_KEY, fileToSrc, t } from "./shared.js";
import { getLibrary, LOCATIONS_CHANGED, saveLibrary } from "./store.js";
import { hideAllPersonas } from "../personas/stage.js";
import { revealLocationTitle, suppressLocationTitle } from "./title.js";
import {
  ensureTheatreSceneDocument,
  getTheatreScene,
  isTheatreStage,
  openTheatreScene,
  SCENE_HEIGHT,
  SCENE_NAME,
  SCENE_WIDTH
} from "../ensureTheatreScene.js";

const LOCATION_TRANSITION_SOCKET = "locationTransition";
const TRANSITION_TYPE = "wind";
const CAPTURE_WAIT_MS = 250;
const BACKGROUND_WAIT_MS = 8000;

let locationChangeQueue = Promise.resolve();
let remoteTransitionQueue = Promise.resolve();

function foundryGen() {
  return Number(game.release?.generation ?? 12);
}

function readImageSize(path) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({
      width: Math.max(1, img.naturalWidth || SCENE_WIDTH),
      height: Math.max(1, img.naturalHeight || SCENE_HEIGHT)
    });
    img.onerror = () => resolve({ width: SCENE_WIDTH, height: SCENE_HEIGHT });
    img.src = fileToSrc(path);
  });
}

async function resolveTheatreScene() {
  if (game.user?.isGM) {
    try {
      const scene = await ensureTheatreSceneDocument();
      if (scene) return scene;
    } catch (error) {
      console.error("[theatre-of-mind] ensure theatre scene failed", error);
    }
  }
  if (isTheatreStage(canvas?.scene)) return canvas.scene;
  return getTheatreScene();
}

function isLevelDocument(level) {
  return !!(level && typeof level.update === "function");
}

function theatreLevel(scene) {
  if (!scene) return null;
  const viewed = canvas?.level;
  if (isLevelDocument(viewed) && viewed.parent?.id === scene.id) return viewed;
  const fromGetter = [scene.initialLevel, scene.firstLevel].find(isLevelDocument);
  if (fromGetter) return fromGetter;
  const levels = scene.levels;
  if (!levels) return null;
  const initialId = typeof scene.initialLevel === "string" ? scene.initialLevel : "";
  if (initialId && typeof levels.get === "function") {
    const byId = levels.get(initialId);
    if (byId) return byId;
  }
  if (Array.isArray(levels.contents) && levels.contents.length) return levels.contents[0];
  if (typeof levels[Symbol.iterator] === "function") {
    const first = levels[Symbol.iterator]().next().value;
    if (first) return first;
  }
  return null;
}

function normalizeSrc(src) {
  return String(src || "").trim();
}

function backgroundSrcOf(scene) {
  const level = theatreLevel(scene);
  if (level) return normalizeSrc(level.background?.src);
  return normalizeSrc(scene?.background?.src ?? scene?.img);
}

function srcMatches(scene, src) {
  return backgroundSrcOf(scene) === normalizeSrc(src);
}

async function setLevelBackgroundSrc(level, path) {
  try {
    await level.update({ "background.src": path });
  } catch {
    await level.update({ background: { src: path } });
  }
}

async function writeLevelBackground(scene, src) {
  const path = src || null;
  const level = theatreLevel(scene);
  if (level) {
    await setLevelBackgroundSrc(level, path);
    return;
  }
  await scene.createEmbeddedDocuments("Level", [{
    name: SCENE_NAME,
    background: { src: path }
  }]);
}

async function writeLegacyBackground(scene, src) {
  const path = src || null;
  if (foundryGen() >= 13) {
    await scene.update({ background: { src: path } });
    return;
  }
  await scene.update({ img: path || "" });
}

async function writeSceneSize(scene, width, height) {
  const patch = {};
  if (scene.width !== width) patch.width = width;
  if (scene.height !== height) patch.height = height;
  if (Object.keys(patch).length) await scene.update(patch);
}

async function writeSceneBackground(src, width, height) {
  const scene = await resolveTheatreScene();
  if (!scene) {
    ui.notifications.error(t("noTheatreScene"));
    return false;
  }
  try {
    if (foundryGen() >= 14) await writeLevelBackground(scene, src);
    else await writeLegacyBackground(scene, src);
  } catch (error) {
    console.error("[theatre-of-mind] scene background update failed", error);
    ui.notifications.error(t("applyFailed"));
    return false;
  }
  try {
    await writeSceneSize(scene, width, height);
  } catch (error) {
    console.error("[theatre-of-mind] scene size update failed", error);
  }
  return true;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function otherUsersActive() {
  return (game.users?.contents ?? []).some(user => user.active && user.id !== game.user?.id);
}

function onTheatreStage() {
  return !!(canvas?.ready && isTheatreStage(canvas.scene));
}

function transitionDuration() {
  const fromType = Number(CONFIG.Canvas?.sceneTransitions?.wind?.defaultDuration);
  if (Number.isFinite(fromType) && fromType > 0) return fromType;
  const fromContainer = Number(canvas?.transition?.defaultDuration);
  if (Number.isFinite(fromContainer) && fromContainer > 0) return fromContainer;
  return 1500;
}

function setWindViewTransition() {
  if (!canvas) return;
  canvas._viewOptions = {
    ...(canvas._viewOptions ?? {}),
    transition: { type: TRANSITION_TYPE, duration: transitionDuration() }
  };
}

function clearWindViewTransition() {
  const options = canvas?._viewOptions;
  if (!options?.transition) return;
  const next = { ...options };
  delete next.transition;
  canvas._viewOptions = next;
}

function beginCanvasDrawCoalesce({ quietMs = 0 } = {}) {
  if (canvas?._tomCoalesce) return canvas._tomCoalesce;
  const origDraw = canvas?.draw;
  let latestScene;
  let sawDraw = false;
  let lastCall = 0;
  let restored = false;
  if (typeof origDraw === "function") {
    canvas.draw = async function coalescedDraw(scene) {
      sawDraw = true;
      lastCall = Date.now();
      latestScene = scene;
      return canvas;
    };
  }
  const handle = {
    async flush() {
      if (restored) return;
      if (quietMs) {
        const waitForDrawUntil = Date.now() + 2000;
        while (!sawDraw && Date.now() < waitForDrawUntil) await sleep(16);
        while (sawDraw && Date.now() - lastCall < quietMs) await sleep(16);
      }
      restored = true;
      delete canvas._tomCoalesce;
      if (typeof origDraw === "function") canvas.draw = origDraw;
      if (!sawDraw || typeof origDraw !== "function") return;
      await origDraw.call(canvas, latestScene);
      await awaitTransitionPlay();
    }
  };
  canvas._tomCoalesce = handle;
  return handle;
}

async function awaitTransitionPlay() {
  for (let i = 0; i < 45; i++) {
    const playing = canvas.transition?.promise;
    if (playing) {
      await playing;
      return;
    }
    await sleep(16);
  }
}

function waitForPaint() {
  return new Promise(resolve => {
    const renderer = canvas?.app?.renderer;
    if (!renderer?.once) {
      requestAnimationFrame(() => resolve());
      return;
    }
    const timer = setTimeout(resolve, 300);
    renderer.once("postrender", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForBackgroundSrc(src, timeoutMs = BACKGROUND_WAIT_MS) {
  const matches = () => srcMatches(canvas?.scene, src);
  if (matches()) {
    await waitForPaint();
    return;
  }
  await new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      Hooks.off("updateLevel", onUpdate);
      Hooks.off("updateScene", onUpdate);
      clearTimeout(timer);
      resolve();
    };
    const onUpdate = () => {
      if (matches()) finish();
    };
    Hooks.on("updateLevel", onUpdate);
    Hooks.on("updateScene", onUpdate);
    const timer = setTimeout(finish, timeoutMs);
  });
  await waitForPaint();
}

async function waitForActiveId(activeId, timeoutMs = 2000) {
  const wanted = String(activeId || "");
  if (getLibrary().activeId === wanted) return;
  await new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      Hooks.off(LOCATIONS_CHANGED, onChange);
      Hooks.off("updateSetting", onSetting);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (getLibrary().activeId === wanted) finish();
    };
    const onSetting = setting => {
      if (setting?.key === `${MODULE_ID}.${SETTING_KEY}`) onChange();
    };
    Hooks.on(LOCATIONS_CHANGED, onChange);
    Hooks.on("updateSetting", onSetting);
    const timer = setTimeout(finish, timeoutMs);
  });
}

async function preloadBackground(path) {
  if (!path) return;
  try {
    if (typeof foundry?.canvas?.loadTexture === "function") {
      await foundry.canvas.loadTexture(path);
      return;
    }
  } catch {}
  try {
    const loader = foundry?.canvas?.TextureLoader?.loader;
    if (typeof loader?.loadTexture === "function") {
      await loader.loadTexture(path);
      return;
    }
  } catch {}
  await readImageSize(path);
}

function emitLocationTransition(src, activeId) {
  try {
    game.socket?.emit(`module.${MODULE_ID}`, {
      type: LOCATION_TRANSITION_SOCKET,
      src: src || "",
      activeId: activeId || ""
    });
  } catch (error) {
    console.error("[theatre-of-mind] location transition socket failed", error);
  }
}

async function commitActiveId(activeId) {
  const library = getLibrary();
  if (library.activeId === activeId) return;
  library.activeId = activeId;
  await saveLibrary(library);
}

async function changeLocationBackground({ src, width, height, activeId }) {
  suppressLocationTitle();
  try {
    await Promise.all([hideAllPersonas(), sleep(180)]);
    if (src) await preloadBackground(src);
    if (onTheatreStage()) setWindViewTransition();
    emitLocationTransition(src, activeId);
    if (onTheatreStage() && otherUsersActive()) await sleep(CAPTURE_WAIT_MS);

    const coalesce = onTheatreStage() ? beginCanvasDrawCoalesce() : null;
    try {
      const ok = await writeSceneBackground(src, width, height);
      if (ok) await commitActiveId(activeId);
      if (!ok) return;
    } finally {
      try {
        await coalesce?.flush();
      } catch (error) {
        console.error("[theatre-of-mind] location transition draw failed", error);
      }
    }
  } finally {
    clearWindViewTransition();
    revealLocationTitle();
  }
  await openTheatreScene();
}

function enqueueLocationChange(task) {
  const next = locationChangeQueue.then(task, () => task());
  locationChangeQueue = next.catch(error => {
    console.error("[theatre-of-mind] location change failed", error);
  });
  return next;
}

export function bindRemoteLocationTransition() {
  if (!game.socket) return;
  game.socket.on(`module.${MODULE_ID}`, data => {
    if (data?.type !== LOCATION_TRANSITION_SOCKET) return;
    remoteTransitionQueue = remoteTransitionQueue
      .then(() => playRemoteLocationTransition(data))
      .catch(error => {
        console.error("[theatre-of-mind] remote location transition failed", error);
        revealLocationTitle();
      });
  });
}

async function playRemoteLocationTransition(data) {
  if (!onTheatreStage()) return;
  suppressLocationTitle();
  const coalesce = beginCanvasDrawCoalesce({ quietMs: 180 });
  try {
    setWindViewTransition();
    await preloadBackground(data?.src);
    await waitForBackgroundSrc(data?.src);
    await sleep(80);
    await waitForActiveId(data?.activeId);
  } finally {
    try {
      await coalesce.flush();
    } catch (error) {
      console.error("[theatre-of-mind] remote location transition draw failed", error);
    }
    clearWindViewTransition();
    revealLocationTitle();
  }
}

export async function applyLocation(locationId) {
  if (!game.user?.isGM) return;
  return enqueueLocationChange(async () => {
    const location = getLibrary().locations.find(item => item.id === locationId);
    if (!location?.image) return ui.notifications.warn(t("needImage"));
    const size = await readImageSize(location.image);
    await changeLocationBackground({
      src: location.image,
      width: size.width,
      height: size.height,
      activeId: locationId
    });
  });
}

export async function clearLocation() {
  if (!game.user?.isGM) return;
  return enqueueLocationChange(() => changeLocationBackground({
    src: "",
    width: SCENE_WIDTH,
    height: SCENE_HEIGHT,
    activeId: ""
  }));
}

export async function toggleLocation(locationId) {
  if (getLibrary().activeId === locationId) return clearLocation();
  return applyLocation(locationId);
}
