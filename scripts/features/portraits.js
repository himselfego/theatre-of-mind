import { MODULE_ID, FLAG_PORTRAIT_HEIGHT_MULTIPLIER, FLAG_EMOTION_HEIGHT_MULTIPLIER, FLAG_PORTRAIT_BREATHING_MULTIPLIER } from "../core/constants.js";
import { PersonaEditorApp } from "./personas/editor.js";
import {
  PORTRAIT_KEYBINDINGS,
  isPortraitControlKeyActive
} from "../keybindings.js";
import { PERSONAS_CHANGED, getPersona } from "./personas/store.js";
import {
  CAST_CHANGED,
  getCast,
  getCastItem,
  getEmotionHeightMultiplier,
  getFocusedPersonaId,
  getPersonaImage,
  getPersonaStageName,
  getShownPersonaIds,
  hidePersona,
  isTheatreStage,
  reorderCast,
  setCastFlip,
  setCastTransform,
  setFocusedPersona,
  togglePersona
} from "./personas/stage.js";
import { getPersonaSubject } from "./personas/subject.js";

(()=>{
  async function configurePortrait(ev, subject) {
    if (!game.user?.isGM) return;
    ev?.preventDefault?.();
    const id = typeof subject === "string" ? subject : subject?.id;
    if (!id) return;
    new PersonaEditorApp({ personaId: id }).render({ force: true });
  }

  // ---- Adaptive tone (по темноте сцены) ----
function _toneClamp01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function _toneSmoothstep(edge0, edge1, value) {
  const t = _toneClamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - (2 * t));
}

function _toneRound(value) {
  return Number(value.toFixed(4));
}

const TONE_NEUTRAL_DARKNESS = 0.1;
const toneStateByRoot = new WeakMap();

function _toneCompute(darkness, strength01) {
  const d = _toneClamp01(darkness);
  const s = _toneClamp01(strength01);

  if (d <= TONE_NEUTRAL_DARKNESS || s <= 0) {
    return {
      brightness: 1,
      contrast: 1,
      saturate: 1,
      hueDeg: 0,
      bluePreHueDeg: 0,
      blueTint: 0,
      bluePostHueDeg: 0,
      skipFilterTransition: true
    };
  }

  const dusk = _toneSmoothstep(0.12, 0.70, d) * s;
  const night = _toneSmoothstep(0.55, 1.00, d) * s;
  const deepNight = _toneSmoothstep(0.78, 1.00, d) * s;

  const brightness = 1 - (0.20 * dusk) - (0.16 * night) - (0.04 * deepNight);
  const contrast = 1 + (0.08 * dusk) - (0.03 * deepNight);
  const saturate = 1 - (0.04 * dusk) - (0.08 * night);
  const hueDeg = (-2 * dusk) - (10 * night);
  const blueTint = (0.03 * dusk) + (0.10 * night) + (0.04 * deepNight);
  const roundedHueDeg = _toneRound(hueDeg);
  const roundedBlueTint = _toneRound(blueTint);
  const hasBlueTint = roundedBlueTint > 0;

  return {
    brightness: _toneRound(brightness),
    contrast: _toneRound(contrast),
    saturate: _toneRound(saturate),
    hueDeg: roundedHueDeg,
    bluePreHueDeg: hasBlueTint ? 180 : 0,
    blueTint: roundedBlueTint,
    bluePostHueDeg: hasBlueTint ? _toneRound(roundedHueDeg - 180) : roundedHueDeg,
    skipFilterTransition: false
  };
}

function _toneGetDarknessLevel() {
  const readNumber = (getter) => {
    try {
      const value = getter();
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
    } catch (e) {
      return null;
    }
  };

  const candidates = [
    () => canvas?.darknessLevel,
    () => canvas?.environment?.darknessLevel,
    () => canvas?.scene?.environment?.darknessLevel,
    () => canvas?.scene?.environment?.darkness,
    () => canvas?.scene?.darkness
  ];

  for (const getter of candidates) {
    const darkness = readNumber(getter);
    if (darkness !== null) return darkness;
  }

  return 0;
}

function _toneApplyToRootVars(root = document.getElementById("ginzzzu-portrait-layer")) {
  if (!root) return;
  const enabled = game.settings.get(MODULE_ID, "portraitToneEnabled");
  const previousState = toneStateByRoot.get(root);

  if (!enabled) {
    if (previousState?.enabled === false) return;
    root.style.removeProperty("--tone-brightness");
    root.style.removeProperty("--tone-contrast");
    root.style.removeProperty("--tone-saturate");
    root.style.removeProperty("--tone-hue");
    root.style.removeProperty("--tone-blue-pre-hue");
    root.style.removeProperty("--tone-blue-tint");
    root.style.removeProperty("--tone-blue-post-hue");
    root.style.removeProperty("--tone-filter-transition");
    delete root.dataset.toneNeutral;
    toneStateByRoot.set(root, { enabled: false, neutral: true, signature: "disabled" });
    return;
  }

  const strength = Math.max(0, Math.min(1, Number(game.settings.get(MODULE_ID, "portraitToneStrength")) || 0));
  const d = _toneGetDarknessLevel();
  const { brightness, contrast, saturate, hueDeg, bluePreHueDeg, blueTint, bluePostHueDeg, skipFilterTransition } = _toneCompute(d, strength);
  const wasNeutral = previousState?.neutral ?? (root.dataset.toneNeutral === "true");
  const isNeutral = skipFilterTransition;
  const skipThisTransition = wasNeutral || isNeutral;
  const filterTransition = skipThisTransition ? "0ms linear" : `${_ANIM.moveMs}ms ${_ANIM.easing}`;
  const signature = [
    brightness,
    contrast,
    saturate,
    hueDeg,
    bluePreHueDeg,
    blueTint,
    bluePostHueDeg,
    filterTransition,
    isNeutral
  ].join("|");

  // PF2e may trigger lightingRefresh repeatedly while a token moves. Avoid
  // invalidating portrait styles when the effective scene tone is unchanged.
  if (previousState?.enabled === true && previousState.signature === signature) return;

  root.style.setProperty("--tone-brightness", String(brightness));
  root.style.setProperty("--tone-contrast",   String(contrast));
  root.style.setProperty("--tone-saturate",   String(saturate));
  root.style.setProperty("--tone-hue",        `${hueDeg}deg`);
  root.style.setProperty("--tone-blue-pre-hue", `${bluePreHueDeg}deg`);
  root.style.setProperty("--tone-blue-tint",  String(blueTint));
  root.style.setProperty("--tone-blue-post-hue", `${bluePostHueDeg}deg`);
  root.style.setProperty("--tone-filter-transition", filterTransition);
  root.dataset.toneNeutral = isNeutral ? "true" : "false";
  toneStateByRoot.set(root, { enabled: true, neutral: isNeutral, signature });
}

let toneRefreshFrame = null;

function _scheduleToneRefresh() {
  const root = document.getElementById("ginzzzu-portrait-layer");
  if (!root?.querySelector(".ginzzzu-portrait-wrapper")) return;
  if (toneRefreshFrame !== null) return;
  toneRefreshFrame = requestAnimationFrame(() => {
    toneRefreshFrame = null;
    _toneApplyToRootVars();
  });
}

  // ---- Геометрия «рамки» портретов и анимации ----
const FRAME = {
  heightVh: 80,     // фикс. высота рамки
  widthVw: 50,      // желаемая ширина рамки
  minWidthPx: 160,
  maxWidthPx: 520,
  targetBand: 0.98, // используем 98% ширины экрана (чтоб максимум места)
  gapBase: 24,
  gapMin: 8,

  bottomPx: 4,      // ← отступ от нижней кромки ЭКРАНА (сделай 0–8px)
  sidePadPx: 8      // ← небольшой боковой запас, чтобы точно не «липло» к краю
};


  const ANIM = {
    get fadeMs() {
      return game.settings.get(MODULE_ID, "portraitFadeMs");
    },
    get moveMs() {
      return game.settings.get(MODULE_ID, "portraitMoveMs");
    },
    get easing() {
      return game.settings.get(MODULE_ID, "portraitEasing");
    }
  };

  // Wrap ANIM getters so they respect reduced motion
  const _ANIM = {
    get fadeMs() { return ANIM.fadeMs; },
    get moveMs() { return ANIM.moveMs; },
    get easing()  { return ANIM.easing ?? "ease"; }
  };

  const PORTRAIT_IMG_ANCHOR = "translateX(-50%)";

  function applyPortraitImageBox(el, extra = {}) {
    if (!el) return;
    el.style.removeProperty("inset");
    Object.assign(el.style, {
      position: "absolute",
      top: "0",
      right: "auto",
      bottom: "auto",
      left: "50%",
      width: "auto",
      height: "100%",
      maxWidth: "none",
      maxHeight: "100%",
      objectFit: "contain",
      objectPosition: "center bottom",
      ...extra
    });
  }

  let _blurRemovalTimeout = null;

  function isPortraitUiHidden(root = document.getElementById("ginzzzu-portrait-layer")) {
    return !!root?.classList?.contains("ginzzzu-portrait-ui-hidden");
  }

  function clearPortraitBlur(root = document.getElementById("ginzzzu-portrait-layer")) {
    if (!root) return;

    if (_blurRemovalTimeout !== null) {
      clearTimeout(_blurRemovalTimeout);
      _blurRemovalTimeout = null;
    }

    root.classList.remove("ginzzzu-portrait-blur-active", "ginzzzu-portrait-focus-blur-active");
    root.style.removeProperty("--ginzzzu-blur-strength-value");
    root.style.removeProperty("--ginzzzu-blur-speed-value");
  }

  function setPortraitUiHidden(root, hidden) {
    if (!root) return;

    root.classList.toggle("ginzzzu-portrait-ui-hidden", !!hidden);

    if (hidden) {
      root.querySelectorAll("#ginzzzu-portrait-names .ginzzzu-portrait-name.visible").forEach((badge) => {
        badge.classList.remove("visible");
      });
      clearPortraitBlur(root);
      return;
    }

    if (getActivePortraits().length > 0) {
      _applyPortraitFocus();
    }
  }

  // Simple image loader with timeout. Resolves with a decoded off-DOM image.
  function _loadDecodedImageElement(src, timeoutMs = 60000, { useCors = true } = {}) {
    return new Promise((resolve, reject) => {
      if (!src) return reject(new Error("No src"));
      const img = new Image();
      let timer = null;
      let done = false;
      const onDone = (err, value = img) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        img.onload = img.onerror = null;
        if (err) reject(err); else resolve(value);
      };
      img.onload = () => {
        if (typeof img.decode === "function") {
          img.decode().catch(() => {}).then(() => onDone(null, img));
        } else {
          onDone(null, img);
        }
      };
      img.onerror = (e) => onDone(new Error("Image load error"));
      // try set crossOrigin to allow CORS'd images where possible
      if (useCors) { try { img.crossOrigin = "anonymous"; } catch {} }
      try { img.decoding = "async"; } catch {}
      try { img.loading = "eager"; } catch {}
      timer = setTimeout(() => onDone(new Error("Image preload timeout")), timeoutMs);
      img.src = src;
      if (img.complete) {
        Promise.resolve().then(() => {
          if (done) return;
          if (img.naturalWidth || img.naturalHeight) img.onload?.();
          else onDone(new Error("Image load error"));
        });
      }
    });
  }

  function _preloadImage(src, timeoutMs = 60000) {
    return _loadDecodedImageElement(src, timeoutMs, { useCors: true })
      .catch(() => _loadDecodedImageElement(src, timeoutMs, { useCors: false }))
      .then(() => src);
  }

  function _copyPortraitImageState(sourceImg, targetImg, nextSrc) {
    targetImg.className = sourceImg.className || "ginzzzu-portrait";
    targetImg.alt = sourceImg.alt || "Portrait";
    targetImg.draggable = false;
    try { targetImg.decoding = "async"; } catch {}
    try { targetImg.style.cssText = sourceImg.style.cssText || ""; } catch {}
    applyPortraitImageBox(targetImg);
    for (const [key, value] of Object.entries(sourceImg.dataset || {})) {
      targetImg.dataset[key] = value;
    }
    targetImg.dataset.src = nextSrc;
  }

  function nextAnimationFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  function runWhenBrowserIdle(callback, timeout = 600) {
    if (typeof globalThis.requestIdleCallback === "function") {
      globalThis.requestIdleCallback(callback, { timeout });
    } else {
      setTimeout(callback, 0);
    }
  }

  function scheduleAfterAnimationSettles(durationMs, callback, settleMs = 180) {
    const delay = Math.max(0, Number(durationMs) || 0) + Math.max(0, Number(settleMs) || 0);
    setTimeout(() => runWhenBrowserIdle(callback), delay);
  }

  const PORTRAIT_BREATHING_ANIMATION_KEY = "__ginzzzuPortraitBreathingAnimation";
  const PORTRAIT_BREATHING_DELAY_SPREAD_MS = 2400;
  let portraitAnimationActivityFrame = null;

  function isTextEntryElement(element) {
    if (!(element instanceof Element)) return false;
    return element.matches(
      "input:not([type='button']):not([type='checkbox']):not([type='radio']):not([type='range']), textarea, [contenteditable]:not([contenteditable='false']), .ProseMirror"
    );
  }

  function syncPortraitAnimationActivity() {
    portraitAnimationActivityFrame = null;
    const suspended = isTextEntryElement(document.activeElement);
    document.body?.classList.toggle("ginzzzu-text-entry-active", suspended);

    const root = document.getElementById("ginzzzu-portrait-layer");
    if (!root) return;

    for (const wrapper of root.querySelectorAll(".ginzzzu-portrait-wrapper")) {
      const animation = wrapper[PORTRAIT_BREATHING_ANIMATION_KEY];
      if (!animation) continue;
      try {
        if (suspended && animation.playState === "running") animation.pause();
        else if (!suspended && animation.playState === "paused") animation.play();
      } catch (e) {}
    }
  }

  function schedulePortraitAnimationActivitySync() {
    if (portraitAnimationActivityFrame !== null) return;
    portraitAnimationActivityFrame = requestAnimationFrame(syncPortraitAnimationActivity);
  }

  function registerPortraitAnimationActivityHandlers() {
    document.addEventListener("focusin", schedulePortraitAnimationActivitySync, { passive: true });
    document.addEventListener("focusout", schedulePortraitAnimationActivitySync, { passive: true });
    syncPortraitAnimationActivity();
  }

  function clampNumber(value, min, max, fallback = min) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function snapToDevicePixel(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    const dpr = clampNumber(globalThis.devicePixelRatio, 0.25, 8, 1);
    return Math.round(number * dpr) / dpr;
  }

  function getPortraitBreathingSettings() {
    const read = (key, fallback) => {
      try {
        return game.settings.get(MODULE_ID, key);
      } catch (e) {
        return fallback;
      }
    };

    const enabled = !!read("portraitBreathingEnabled", true);
    const strength = clampNumber(read("portraitBreathingStrength", 0.5), 0, 1.5, 0.5);
    return {
      enabled: enabled && strength > 0,
      strength,
      durationMs: clampNumber(read("portraitBreathingDurationMs", 10000), 2000, 20000, 10000),
      delaySpreadMs: PORTRAIT_BREATHING_DELAY_SPREAD_MS
    };
  }

  function getPortraitBreathingMultiplier(actorId) {
    if (!actorId) return 1;
    try {
      const actor = getPersonaSubject(actorId);
      const raw = actor ? foundry.utils.getProperty(actor, FLAG_PORTRAIT_BREATHING_MULTIPLIER) : null;
      return clampNumber(raw ?? 1, 0, 3, 1);
    } catch (e) {
      return 1;
    }
  }

  function stopPortraitBreathing(wrapper) {
    const animation = wrapper?.[PORTRAIT_BREATHING_ANIMATION_KEY];
    if (animation) {
      try { animation.cancel(); } catch (e) {}
      delete wrapper[PORTRAIT_BREATHING_ANIMATION_KEY];
    }

    if (!wrapper) return;
    delete wrapper.dataset.breathSignature;
    wrapper.style.removeProperty("translate");
    wrapper.style.removeProperty("scale");
    // Clean up values left by versions that animated the combined transform.
    wrapper.style.removeProperty("--ginzzzu-breathe-y");
    wrapper.style.removeProperty("--ginzzzu-breathe-scale");
  }

  function applyPortraitBreathingToWrapper(wrapper, settings, index, total, { reroll = false } = {}) {
    if (!wrapper) return;
    const speedMultiplier = getPortraitBreathingMultiplier(wrapper.dataset.actorId);
    if (!settings?.enabled || speedMultiplier <= 0) {
      stopPortraitBreathing(wrapper);
      return;
    }

    if (reroll || !wrapper.dataset.breathSeed) {
      wrapper.dataset.breathSeed = String(Math.random());
    }

    const seed = clampNumber(wrapper.dataset.breathSeed, 0, 1, 0);
    const spread = total > 1 ? settings.delaySpreadMs : 0;
    const delayMs = spread > 0 ? -Math.round(seed * spread) : 0;
    const durationMs = Math.max(600, Math.round(settings.durationMs / speedMultiplier));
    const liftPx = 0.5 + (settings.strength * 3);
    const scale = 1 + (settings.strength * 0.036);
    const signature = [
      settings.strength.toFixed(3),
      durationMs,
      speedMultiplier.toFixed(3),
      liftPx.toFixed(3),
      scale.toFixed(5)
    ].join("|");

    if (wrapper.dataset.breathSignature === signature && wrapper[PORTRAIT_BREATHING_ANIMATION_KEY]) {
      return;
    }

    stopPortraitBreathing(wrapper);
    wrapper.dataset.breathSignature = signature;
    wrapper.style.setProperty("translate", "0 0");
    wrapper.style.setProperty("scale", "1");

    try {
      wrapper[PORTRAIT_BREATHING_ANIMATION_KEY] = wrapper.animate(
        [
          { translate: "0 0", scale: "1" },
          { translate: `0 ${liftPx.toFixed(3)}px`, scale: scale.toFixed(5) },
          { translate: "0 0", scale: "1" }
        ],
        {
          duration: durationMs,
          delay: delayMs,
          iterations: Infinity,
          easing: "ease-in-out"
        }
      );
      if (isTextEntryElement(document.activeElement)) {
        wrapper[PORTRAIT_BREATHING_ANIMATION_KEY].pause();
      }
    } catch (e) {
      wrapper.style.removeProperty("translate");
      wrapper.style.removeProperty("scale");
    }
  }

  function applyPortraitBreathing(options = {}) {
    const root = options.root || getDomHud();
    if (!root) return;

    const wrappers = Array.from(root.querySelectorAll(".ginzzzu-portrait-wrapper"));
    const settings = getPortraitBreathingSettings();
    wrappers.forEach((wrapper, index) => {
      applyPortraitBreathingToWrapper(wrapper, settings, index, wrappers.length, options);
    });
  }

  // ---- DOM HUD внутри #interface ----
  function getDomHud() {
    // Check if portraits are disabled for this client
    if (game.settings.get(MODULE_ID, "hidePortraits")) {
      return null;
    }

    let root = document.getElementById("ginzzzu-portrait-layer");
    if (root) {
      return root;
    }

    const iface = document.getElementById("interface");
    if (!iface) {
      console.warn("[threeO-portraits] #interface not found; abort DOM HUD");
      return null;
    }

    root = document.createElement("div");
    root.id = "ginzzzu-portrait-layer";

    const nameMode = game.settings.get(MODULE_ID, "portraitNamesAlwaysVisible") || "hover";

    // Класс для режима "всегда показывать имена"
    if (nameMode === "always") {
      root.classList.add("ginzzzu-show-names-always");
    }

    // слой на весь интерфейс; flex-ряд у низа по центру
    Object.assign(root.style, {
      position: "absolute",
      inset: "0",
      zIndex: "1",
      pointerEvents: "none",
      display: "flex",
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "center",
      gap: "24px",
      paddingBottom: `${getBottomOffsetPx()}px`,  // ← берём из настройки
      // paddingLeft/Right будут синхронизироваться ниже с учётом #sidebar
    });

    const rail = document.createElement("div");
    rail.id = "ginzzzu-portrait-rail";
    if (game.settings.get(MODULE_ID, "visualNovelMode")) {
      Object.assign(rail.style, {
        position: "absolute",
        left: "0",
        right: "0",
        top: "0",
        bottom: `${getBottomOffsetPx()}px`,
        display: "flex",
        flexDirection: "row",
        alignItems: "end",
        justifyContent: "center",        // центрируем ряд; отступы делаем через margin
        gap: "inherit",
        pointerEvents: "none",
        overflowX: "hidden",              // не скроллить — будем сжимать/перекрывать
        overflowY: "hidden",
        WebkitOverflowScrolling: "auto",
        // paddingLeft/Right будут синхронизироваться ниже с учётом #sidebar
      });
    } else {
      Object.assign(rail.style, {
        position: "absolute",
        left: "0",
        right: "0",
        top: "0",
        bottom: `${getBottomOffsetPx()}px`,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",        // центрируем ряд; отступы делаем через margin
        gap: "inherit",
        pointerEvents: "none",
        overflowX: "hidden",              // не скроллить — будем сжимать/перекрывать
        overflowY: "hidden",
        WebkitOverflowScrolling: "auto",
        // paddingLeft/Right будут синхронизироваться ниже с учётом #sidebar
      });
    }
    root.appendChild(rail);

    // Names container: badges live here so they can float above portrait wrappers
    let namesContainer = document.getElementById("ginzzzu-portrait-names");
    if (!namesContainer) {
      namesContainer = document.createElement("div");
      namesContainer.id = "ginzzzu-portrait-names";
      Object.assign(namesContainer.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        zIndex: "100000"
      });
      root.appendChild(namesContainer);
    }

    // Установить paddingLeft/paddingRight с учётом ширины #sidebar
    syncSidePadding(root, rail);

    // === Toggle button: allow players & GM to hide portrait UI (make semi-transparent + disable clicks) ===
    try {
      const visibility = game.settings.get(MODULE_ID, 'portraitUIToggleVisibility') || 'all';
      const isGMUser = !!game.user?.isGM;
      let shouldShow = false;

      if (visibility === 'all') {
        shouldShow = true;
      } else if (visibility === 'players') {
        shouldShow = !isGMUser;
      } else if (visibility === 'gm') {
        shouldShow = isGMUser;
      }

      const btn = document.createElement('button');
      btn.id = 'ginzzzu-portrait-ui-toggle-btn';
      if (!shouldShow) {
        btn.className = 'hidden';
      }
      btn.setAttribute('aria-pressed', 'false');
      const toggleLabel = game.i18n?.localize('GINZZZUPORTRAITS.PortraitUIToggle.togglePortraitUI') || 'Toggle portrait UI';
      btn.title = toggleLabel;
      btn.innerHTML = '<i class="fas fa-eye-slash" aria-hidden="true"></i>';
      btn.style.pointerEvents = 'auto';

      function updateToggleButtonIcon(el, hidden) {
        try {
          el.setAttribute('aria-pressed', hidden ? 'true' : 'false');
          const hideLabel = game.i18n?.localize('GINZZZUPORTRAITS.PortraitUIToggle.hideUI') || 'Hide portrait UI';
          const showLabel = game.i18n?.localize('GINZZZUPORTRAITS.PortraitUIToggle.showUI') || 'Show portrait UI';
          el.title = hidden ? showLabel : hideLabel;
          el.innerHTML = hidden ? '<i class="fas fa-eye" aria-hidden="true"></i>' : '<i class="fas fa-eye-slash" aria-hidden="true"></i>';
        } catch (e) {}
      }

      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        try {
          const isHidden = !isPortraitUiHidden(root);
          setPortraitUiHidden(root, isHidden);
          updateToggleButtonIcon(btn, isHidden);
        } catch (e) { console.error('[ginzzzu-portraits] toggle button error:', e); }
      }, { passive: true });

      setPortraitUiHidden(root, false);
      updateToggleButtonIcon(btn, false);
      root.appendChild(btn);
    } catch (e) {
      console.warn('[ginzzzu-portraits] failed to create UI toggle button:', e);
    }

    _toneApplyToRootVars(root);
    document.getElementById("interface").appendChild(root);
    return root;
  }

    // Position all name badges to match their wrappers; called after layout changes
    function updateNamePositions() {
      const root = getDomHud();
      if (!root) return;
      const namesContainer = root.querySelector('#ginzzzu-portrait-names');
      if (!namesContainer) return;

      const wrappers = Array.from(root.querySelectorAll('.ginzzzu-portrait-wrapper'));
      const badgesByActorId = new Map(
        Array.from(namesContainer.querySelectorAll('.ginzzzu-portrait-name[data-actor-id]'))
          .map(badge => [badge.dataset.actorId, badge])
      );
      for (const wrapper of wrappers) {
        const actorId = wrapper.dataset.actorId;
        if (!actorId) continue;
        const badge = badgesByActorId.get(actorId);
        if (!badge) continue;
        // Horizontal: center above wrapper
        try {
          const rect = wrapper.getBoundingClientRect();
          const centerX = rect.left + (rect.width / 2);
          badge.style.left = `${centerX}px`;
        } catch (e) {}

        // Vertical placement: try to reuse wrapper variable if present
        const nameTopVar = wrapper.style.getPropertyValue('--threeo-portrait-name-top') || '50vh';
        // badge bottom should equal calc(100vh - nameTopVar)
        badge.style.bottom = `calc(100vh - ${nameTopVar})`;

        // font-size propagation
        const fontSize = wrapper.style.getPropertyValue('--threeo-portrait-name-font-size');
        if (fontSize) badge.style.fontSize = fontSize;
      }
    }

  // Получить ширину правой панели (если есть)
  function getSidebarWidth() {
    if (!game.settings.get(MODULE_ID, "adjustForSidebar"))
      return 0;
    try {
      const sb = document.getElementById("sidebar");
      if (!sb) return 0;
      const r = sb.getBoundingClientRect();
      return Math.max(0, Math.round(r.width || 0));
    } catch (e) { return 0; }
  }

  // Синхронизировать правый отступ root/rail с текущей шириной sideBar
  function syncSidePadding(root, rail) {
    const sidebarW = getSidebarWidth();
    const leftPad = FRAME.sidePadPx;
    const rightPad = FRAME.sidePadPx + sidebarW;
    if (root) {
      root.style.paddingLeft = `${leftPad}px`;
      root.style.paddingRight = `${rightPad}px`;
    }
    if (rail) {
      rail.style.paddingLeft = `${leftPad}px`;
      rail.style.paddingRight = `${rightPad}px`;
    }
  }

  function getBottomOffsetPx() {
    try {
      let v = Number(game.settings.get(MODULE_ID, "portraitBottomOffset") ?? 0);
      if (!Number.isFinite(v)) v = 0;
      return Math.max(0, v);
    } catch (e) {
      // fallback на значение из FRAME, если что-то пошло не так
      return FRAME.bottomPx ?? 0;
    }
  }

  // Кэш DOM-элементов: actorId -> <img>
  function domStore() {
    if (!globalThis.__ginzzzuDomPortraits) globalThis.__ginzzzuDomPortraits = new Map();
    return globalThis.__ginzzzuDomPortraits;
  }

  const PORTRAIT_DRAG = {
    startThresholdPx: 6,
    detachRatio: 0.22,
    minDetachPx: 44,
    maxTiltDeg: 9,
    targetBufferRatio: 0.08,
    defaultMinScale: 0.55,
    defaultMaxScale: 1.85,
    defaultMinTiltDeg: -45,
    defaultMaxTiltDeg: 45,
    wheelScaleSpeed: 0.00075,
    pointerScaleSpeed: 0.004,
    pointerRotateSpeedDeg: 0.18
  };

  let activePortraitDrag = null;
  let pendingSharedPortraitSequence = null;
  let namePositionFrame = null;
  let nameFollowUntil = 0;
  let lastPortraitDragSocketAt = 0;
  const remotePortraitDrags = new Map();
  const pendingRemoteSwapDrags = new Map();
  const portraitManualTransforms = new Map();
  const portraitManualZIndexes = new Map();
  let portraitLayerOrder = [];

  function scheduleNamePositionsUpdate() {
    if (namePositionFrame !== null) return;
    namePositionFrame = requestAnimationFrame(() => {
      namePositionFrame = null;
      try { updateNamePositions(); } catch (e) {}
      const root = getDomHud();
      const now = performance?.now?.() ?? Date.now();
      if (
        now < nameFollowUntil ||
        root?.querySelector?.(".ginzzzu-portrait-name-dragging, .ginzzzu-portrait-name-returning")
      ) {
        scheduleNamePositionsUpdate();
      }
    });
  }

  function followNamePositionsFor(durationMs = 0) {
    const now = performance?.now?.() ?? Date.now();
    nameFollowUntil = Math.max(nameFollowUntil, now + Math.max(0, Number(durationMs) || 0));
    scheduleNamePositionsUpdate();
  }

  function getNumericSetting(key, fallback) {
    try {
      const value = Number(game.settings.get(MODULE_ID, key));
      return Number.isFinite(value) ? value : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function normalizeRange(min, max, fallbackMin, fallbackMax, hardMin, hardMax) {
    let normalizedMin = clampNumber(min, hardMin, hardMax);
    let normalizedMax = clampNumber(max, hardMin, hardMax);

    if (!Number.isFinite(normalizedMin)) normalizedMin = fallbackMin;
    if (!Number.isFinite(normalizedMax)) normalizedMax = fallbackMax;
    if (normalizedMin > normalizedMax) [normalizedMin, normalizedMax] = [normalizedMax, normalizedMin];

    return { min: normalizedMin, max: normalizedMax };
  }

  function getPortraitDragScaleRange() {
    return normalizeRange(
      getNumericSetting("portraitDragMinScale", PORTRAIT_DRAG.defaultMinScale),
      getNumericSetting("portraitDragMaxScale", PORTRAIT_DRAG.defaultMaxScale),
      PORTRAIT_DRAG.defaultMinScale,
      PORTRAIT_DRAG.defaultMaxScale,
      0.1,
      4
    );
  }

  function getPortraitDragTiltRange() {
    return normalizeRange(
      getNumericSetting("portraitDragMinTiltDeg", PORTRAIT_DRAG.defaultMinTiltDeg),
      getNumericSetting("portraitDragMaxTiltDeg", PORTRAIT_DRAG.defaultMaxTiltDeg),
      PORTRAIT_DRAG.defaultMinTiltDeg,
      PORTRAIT_DRAG.defaultMaxTiltDeg,
      -180,
      180
    );
  }

  function clampPortraitScale(value) {
    const { min, max } = getPortraitDragScaleRange();
    return clampNumber(value, min, max);
  }

  function clampPortraitTilt(value) {
    const { min, max } = getPortraitDragTiltRange();
    const tilt = Number(value);
    return clampNumber(Number.isFinite(tilt) ? tilt : 0, min, max);
  }

  function getPortraitRail(root = getDomHud()) {
    if (!root) return null;
    return root.querySelector("#ginzzzu-portrait-rail") || root;
  }

  function shouldIgnorePortraitDragTarget(target) {
    if (!target?.closest) return false;
    return !!target.closest(".threeo-emo-toolbar, button, input, select, textarea, a, [data-no-portrait-drag]");
  }

  function updatePortraitReorderCursor(wrapper, actorId = wrapper?.dataset?.actorId) {
    if (!wrapper) return;
    wrapper.classList.toggle("ginzzzu-portrait-reorderable", canUserReorderPortrait(actorId, game.user));
  }

  function getPortraitNameBadge(actorId, root = getDomHud()) {
    if (!actorId || !root) return null;
    const namesContainer = root.querySelector("#ginzzzu-portrait-names");
    return namesContainer?.querySelector?.(`.ginzzzu-portrait-name[data-actor-id="${actorId}"]`) || null;
  }

  function getPortraitDragActor(actorId) {
    if (!actorId) return null;
    try { return getPersonaSubject(actorId) || null; } catch (e) { return null; }
  }

  function getUserById(userOrId = game.user) {
    if (!userOrId) return null;
    if (typeof userOrId !== "string") return userOrId;
    try { return game.users?.get(userOrId) || null; } catch (e) { return null; }
  }

  function isPortraitDragSyncEnabled() {
    try {
      return game.settings.get(MODULE_ID, "portraitDragAnimate") !== false;
    } catch (e) {
      return true;
    }
  }

  function shouldResetPortraitDragPositionOnRelease() {
    try {
      return game.settings.get(MODULE_ID, "portraitDragResetOnRelease") !== false;
    } catch (e) {
      return true;
    }
  }

  function normalizePortraitManualTransform(transform) {
    const hasTilt = transform && Object.prototype.hasOwnProperty.call(transform, "tilt");
    const hasScale = transform && Object.prototype.hasOwnProperty.call(transform, "scale");
    const x = Number(transform?.x ?? 0);
    const y = Number(transform?.y ?? 0);
    const tilt = Number(transform?.tilt);
    const scale = Number(transform?.scale);
    return {
      x: Number.isFinite(x) ? Math.round(x) : 0,
      y: Number.isFinite(y) ? Math.round(y) : 0,
      tilt: hasTilt && Number.isFinite(tilt) ? Math.round(clampPortraitTilt(tilt) * 100) / 100 : 0,
      scale: hasScale && Number.isFinite(scale)
        ? Math.round(clampPortraitScale(scale) * 1000) / 1000
        : 1
    };
  }

  // Positions are in pixels on this client, but stored and sent as fractions of the screen,
  // because clients have different resolutions.
  function manualTransformToShared(transform) {
    const { x, y, tilt, scale } = normalizePortraitManualTransform(transform);
    const toFraction = (pixels, size) => Math.round((pixels / Math.max(1, size)) * 100000) / 100000;
    return {
      screenX: toFraction(x, window.innerWidth),
      screenY: toFraction(y, window.innerHeight),
      tilt,
      scale
    };
  }

  function manualTransformFromShared(shared) {
    return normalizePortraitManualTransform({
      x: (Number(shared?.screenX) || 0) * window.innerWidth,
      y: (Number(shared?.screenY) || 0) * window.innerHeight,
      tilt: shared?.tilt ?? 0,
      scale: shared?.scale ?? 1
    });
  }

  function isZeroPortraitManualTransform(transform) {
    const normalized = normalizePortraitManualTransform(transform);
    return normalized.x === 0 && normalized.y === 0 && normalized.tilt === 0 && normalized.scale === 1;
  }

  function getPortraitManualTransform(actorId) {
    return normalizePortraitManualTransform(portraitManualTransforms.get(actorId));
  }

  function getAppliedPortraitManualTransform(wrapper, actorId = wrapper?.dataset?.actorId) {
    const x = Number(wrapper?.dataset?.manualTransformX);
    const y = Number(wrapper?.dataset?.manualTransformY);
    const tilt = Number(wrapper?.dataset?.manualTransformTilt);
    const scale = Number(wrapper?.dataset?.manualTransformScale);
    if (Number.isFinite(x) || Number.isFinite(y) || Number.isFinite(tilt) || Number.isFinite(scale)) {
      return {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        tilt: Number.isFinite(tilt) ? tilt : 0,
        scale: Number.isFinite(scale) ? scale : 1
      };
    }
    return getPortraitManualTransform(actorId);
  }

  function getPortraitLayerZIndex(actorId, fallback = "") {
    const zIndex = portraitManualZIndexes.get(actorId);
    return Number.isFinite(zIndex) ? String(zIndex) : fallback;
  }

  function getPortraitLayerWrappers(root = getDomHud()) {
    if (!root) return [];
    const rail = getPortraitRail(root);
    const scope = rail || root;
    return Array.from(scope.querySelectorAll(".ginzzzu-portrait-wrapper"))
      .filter(wrapper => String(wrapper?.dataset?.actorId || "").trim());
  }

  function applyPortraitLayerOrder({
    root = getDomHud(),
    promoteActorId = null
  } = {}) {
    const wrappers = getPortraitLayerWrappers(root);
    if (!wrappers.length) {
      portraitLayerOrder = [];
      portraitManualZIndexes.clear();
      return null;
    }

    const currentIds = wrappers
      .map(wrapper => String(wrapper.dataset.actorId || "").trim())
      .filter(Boolean);
    const currentSet = new Set(currentIds);

    portraitLayerOrder = normalizePortraitSequence(portraitLayerOrder)
      .filter(actorId => currentSet.has(actorId));

    for (const actorId of currentIds) {
      if (!portraitLayerOrder.includes(actorId)) portraitLayerOrder.push(actorId);
    }

    const promotedId = String(promoteActorId || "").trim();
    if (promotedId && currentSet.has(promotedId)) {
      portraitLayerOrder = portraitLayerOrder.filter(actorId => actorId !== promotedId);
      portraitLayerOrder.push(promotedId);
    }

    const zByActorId = new Map();
    portraitLayerOrder.forEach((actorId, index) => zByActorId.set(actorId, index + 1));

    for (const actorId of Array.from(portraitManualZIndexes.keys())) {
      if (!currentSet.has(actorId)) portraitManualZIndexes.delete(actorId);
    }

    for (const wrapper of wrappers) {
      const actorId = String(wrapper.dataset.actorId || "").trim();
      if (!actorId) continue;
      const zIndex = zByActorId.get(actorId) || 1;
      portraitManualZIndexes.set(actorId, zIndex);
      wrapper.dataset.baseZ = String(zIndex);
      if (!wrapper.classList.contains("ginzzzu-portrait-focused")) {
        wrapper.style.zIndex = String(zIndex);
      }
    }

    return promotedId ? (zByActorId.get(promotedId) ?? null) : null;
  }

  function removePortraitLayer(actorId) {
    const id = String(actorId || "").trim();
    if (!id) return;
    portraitLayerOrder = portraitLayerOrder.filter(existingId => existingId !== id);
    portraitManualZIndexes.delete(id);
    applyPortraitLayerOrder();
  }

  function setPortraitManualZIndex(actorId, zIndex = null, { root = getDomHud() } = {}) {
    const id = String(actorId || "").trim();
    if (!id) return null;

    const promotedZ = applyPortraitLayerOrder({ root, promoteActorId: id });
    if (Number.isFinite(promotedZ)) return promotedZ;

    const z = Number(zIndex);
    if (Number.isFinite(z)) portraitManualZIndexes.set(id, z);
    return Number.isFinite(z) ? z : null;
  }

  function applyPortraitManualTransform(actorId, transform, {
    root = getDomHud(),
    scheduleNames = true,
    animate = false
  } = {}) {
    const id = String(actorId || "").trim();
    if (!id) return;

    const normalized = normalizePortraitManualTransform(transform);
    if (isZeroPortraitManualTransform(normalized)) portraitManualTransforms.delete(id);
    else portraitManualTransforms.set(id, normalized);

    const wrapper = getWrapperByActorId(id, root);
    if (!wrapper) return;

    wrapper.dataset.manualTransformX = String(normalized.x);
    wrapper.dataset.manualTransformY = String(normalized.y);
    wrapper.dataset.manualTransformTilt = String(normalized.tilt);
    wrapper.dataset.manualTransformScale = String(normalized.scale);

    if (animate) {
      wrapper.style.transition = `transform ${_ANIM.moveMs}ms ${_ANIM.easing}`;
      void wrapper.offsetWidth;
    }

    if (isZeroPortraitManualTransform(normalized)) {
      wrapper.style.removeProperty("--ginzzzu-manual-x");
      wrapper.style.removeProperty("--ginzzzu-manual-y");
      wrapper.style.removeProperty("--ginzzzu-manual-tilt");
      wrapper.style.removeProperty("--ginzzzu-manual-scale");
    } else {
      wrapper.style.setProperty("--ginzzzu-manual-x", `${normalized.x}px`);
      wrapper.style.setProperty("--ginzzzu-manual-y", `${normalized.y}px`);
      wrapper.style.setProperty("--ginzzzu-manual-tilt", `${normalized.tilt}deg`);
      wrapper.style.setProperty("--ginzzzu-manual-scale", String(normalized.scale));
    }

    if (scheduleNames) {
      if (animate) {
        const delay = Math.max(0, Number(_ANIM.moveMs) || 0) + 80;
        followNamePositionsFor(delay);
        setTimeout(() => scheduleNamePositionsUpdate(), delay);
      } else {
        scheduleNamePositionsUpdate();
      }
    }
  }

  function getPortraitDragFinalManualTransform(state) {
    const base = normalizePortraitManualTransform(state?.manualTransform);
    return normalizePortraitManualTransform({
      x: base.x + (Number(state?.lastDx) || 0),
      y: base.y + (Number(state?.lastDy) || 0) + (Number(state?.lastLift) || 0),
      tilt: base.tilt + (Number(state?.lastTilt) || 0),
      scale: base.scale * (Number(state?.dragScale) || 1)
    });
  }

  function getPortraitDragFinalScale(state) {
    const base = normalizePortraitManualTransform(state?.manualTransform);
    const { min, max } = getPortraitDragScaleRange();
    return clampNumber(
      base.scale * (Number(state?.dragScale) || 1),
      min,
      max
    );
  }

  function setPortraitDragFinalScale(state, finalScale) {
    if (!state) return;
    const base = normalizePortraitManualTransform(state.manualTransform);
    const nextFinalScale = clampPortraitScale(Number(finalScale));
    state.dragScale = nextFinalScale / Math.max(0.001, base.scale);
  }

  function setPortraitDragScaleMultiplier(state, dragScale) {
    if (!state) return;
    const base = normalizePortraitManualTransform(state.manualTransform);
    const multiplier = Number(dragScale);
    state.dragScale = Number.isFinite(multiplier) ? multiplier : 1;

    if (state.dragScale === 1) return;

    const finalScale = base.scale * state.dragScale;
    const { min, max } = getPortraitDragScaleRange();
    if (finalScale < min || finalScale > max) {
      setPortraitDragFinalScale(state, finalScale);
    }
  }

  function getPortraitAutoTiltForX(x, width) {
    return clampNumber(
      ((Number(x) || 0) / Math.max(1, Number(width) || 1)) * PORTRAIT_DRAG.maxTiltDeg,
      -PORTRAIT_DRAG.maxTiltDeg,
      PORTRAIT_DRAG.maxTiltDeg
    );
  }

  function getPortraitDragTiltOffset(state) {
    if (Number.isFinite(Number(state?.dragTiltOffset))) return Number(state.dragTiltOffset);

    const base = normalizePortraitManualTransform(state?.manualTransform);
    const width = state?.startRect?.width || 1;
    return clampPortraitTilt(base.tilt) - getPortraitAutoTiltForX(base.x, width);
  }

  function setPortraitDragFinalTilt(state, finalTilt, dx = state?.lastDx || 0) {
    if (!state) return;

    const base = normalizePortraitManualTransform(state.manualTransform);
    const width = state?.startRect?.width || 1;
    const finalX = (Number(base.x) || 0) + (Number(dx) || 0);
    const autoTilt = getPortraitAutoTiltForX(finalX, width);
    state.dragTiltOffset = clampPortraitTilt(finalTilt) - autoTilt;
  }

  function canUserReorderPortrait(actorId, userOrId = game.user) {
    const user = getUserById(userOrId);
    return !!user?.isGM && !!getPortraitDragActor(actorId);
  }

  function collectPortraitDragSlots(rail, draggedWrapper) {
    if (!rail) return [];

    return Array.from(rail.querySelectorAll(".ginzzzu-portrait-wrapper"))
      .map((wrapper, index) => {
        const rect = wrapper.getBoundingClientRect();
        return {
          wrapper,
          index,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          centerX: rect.left + (rect.width / 2),
          isDragged: wrapper === draggedWrapper
        };
      });
  }

  function setPortraitDragTarget(state, targetWrapper) {
    if (!state) return;
    if (state.targetWrapper === targetWrapper) return;
    state.targetWrapper?.classList?.remove("ginzzzu-portrait-drag-target");
    state.targetWrapper = targetWrapper || null;
    state.targetWrapper?.classList?.add("ginzzzu-portrait-drag-target");
  }

  function setPortraitNameDragVisual(state, dx, dy, lift) {
    const badge = state?.nameBadge || getPortraitNameBadge(state?.actorId, state?.root);
    if (!badge) return;

    state.nameBadge = badge;
    badge.classList.add("ginzzzu-portrait-name-dragging");
    badge.classList.remove("ginzzzu-portrait-name-returning");
    badge.classList.toggle("ginzzzu-portrait-name-remote-dragging", !!state.remote);
    scheduleNamePositionsUpdate();
  }

  function clearPortraitNameDragVisual(state, { animateBack = false } = {}) {
    const badge = state?.nameBadge || getPortraitNameBadge(state?.actorId, state?.root);
    if (!badge) return;

    if (animateBack) {
      badge.classList.remove("ginzzzu-portrait-name-dragging");
      badge.classList.remove("ginzzzu-portrait-name-remote-dragging");
      badge.classList.add("ginzzzu-portrait-name-returning");
      followNamePositionsFor(Math.max(0, Number(_ANIM.moveMs) || 0) + 80);
    } else {
      badge.classList.add("ginzzzu-portrait-name-dragging");
    }

    if (!animateBack) {
      requestAnimationFrame(() => {
        if (badge.isConnected) {
          badge.classList.remove("ginzzzu-portrait-name-dragging");
          badge.classList.remove("ginzzzu-portrait-name-remote-dragging");
        }
      });
    } else {
      const delay = Math.max(0, Number(_ANIM.moveMs) || 0) + 80;
      setTimeout(() => {
        if (badge.isConnected) {
          badge.classList.remove("ginzzzu-portrait-name-returning");
        }
      }, delay);
    }
  }

  function applyPortraitDragVisual(state, dx, dy, { targetWrapper = null, detached = false, detachThreshold = null } = {}) {
    if (!state?.wrapper) return;

    const threshold = Math.max(1, detachThreshold ?? state.detachThreshold ?? PORTRAIT_DRAG.minDetachPx);
    const lift = -Math.min(12, 12 * (Math.abs(dx) / threshold));
    const baseTransform = normalizePortraitManualTransform(state.manualTransform);
    const finalX = (Number(baseTransform.x) || 0) + (Number(dx) || 0);
    const targetTilt = clampPortraitTilt(
      getPortraitAutoTiltForX(finalX, state.startRect.width) + getPortraitDragTiltOffset(state)
    );
    const tilt = targetTilt - (Number(baseTransform.tilt) || 0);

    state.lastDx = dx;
    state.lastDy = dy;
    state.lastLift = lift;
    state.lastTilt = tilt;
    state.detached = !!detached;
    state.dragScale = Number.isFinite(Number(state.dragScale)) ? Number(state.dragScale) : 1;

    state.wrapper.classList.toggle("ginzzzu-portrait-detached", !!detached);
    setPortraitDragTarget(state, targetWrapper);

    state.wrapper.style.setProperty("--ginzzzu-drag-x", `${Math.round(dx)}px`);
    state.wrapper.style.setProperty("--ginzzzu-drag-y", `${Math.round(dy)}px`);
    state.wrapper.style.setProperty("--ginzzzu-drag-lift", `${lift.toFixed(2)}px`);
    state.wrapper.style.setProperty("--ginzzzu-drag-tilt", `${tilt.toFixed(2)}deg`);
    state.wrapper.style.setProperty("--ginzzzu-drag-scale", String(state.dragScale));

    setPortraitNameDragVisual(state, dx, dy, lift);
  }

  function getPortraitDragPayload(state, phase, extra = {}) {
    const width = Math.max(1, state?.startRect?.width || 1);
    const height = Math.max(1, state?.startRect?.height || 1);

    return {
      type: "portraitDragPreview",
      phase,
      actorId: state.actorId,
      userId: game.user?.id,
      sceneId: canvas?.scene?.id,
      dxRatio: (state.lastDx || 0) / width,
      dyRatio: (state.lastDy || 0) / height,
      dragScale: Number(state.dragScale) || 1,
      dragTiltOffset: getPortraitDragTiltOffset(state),
      detached: !!state.detached,
      targetActorId: state.targetWrapper?.dataset?.actorId || null,
      ...extra
    };
  }

  function emitPortraitDragPreview(state, phase, { force = false, ...extra } = {}) {
    if (!state || !game.socket) return;
    if (!isPortraitDragSyncEnabled()) return;

    const now = performance?.now?.() ?? Date.now();
    if (!force && phase === "move" && now - lastPortraitDragSocketAt < 33) return;

    lastPortraitDragSocketAt = now;
    try {
      game.socket.emit(`module.${MODULE_ID}`, getPortraitDragPayload(state, phase, extra));
    } catch (e) {
      console.error("[threeO-portraits] portrait drag preview emit failed:", e);
    }
  }

  function getRemotePortraitDragKey(data) {
    return `${data.sceneId || ""}:${data.userId || ""}:${data.actorId || ""}`;
  }

  function getWrapperByActorId(actorId, root = getDomHud()) {
    if (!actorId || !root) return null;
    try {
      return root.querySelector(`.ginzzzu-portrait-wrapper[data-actor-id="${actorId}"]`);
    } catch (e) {
      return null;
    }
  }

  function beginRemotePortraitDrag(data) {
    const root = getDomHud();
    const rail = getPortraitRail(root);
    const wrapper = getWrapperByActorId(data.actorId, root);
    if (!root || !rail || !wrapper) return null;

    clearPendingRemoteSwapDrag(data.actorId, { animateBack: false });
    setPortraitManualZIndex(data.actorId, null, { root });

    const key = getRemotePortraitDragKey(data);
    const existing = remotePortraitDrags.get(key);
    if (existing) clearPortraitDragVisual(existing, { animateBack: false });

    const startRect = wrapper.getBoundingClientRect();
    const state = {
      actorId: data.actorId,
      userId: data.userId,
      root,
      rail,
      wrapper,
      pointerId: null,
      startX: 0,
      startY: 0,
      lastDx: 0,
      lastDy: 0,
      dragScale: 1,
      startRect,
      startCenterX: startRect.left + (startRect.width / 2),
      detachThreshold: Math.max(
        PORTRAIT_DRAG.minDetachPx,
        startRect.width * PORTRAIT_DRAG.detachRatio
      ),
      slots: collectPortraitDragSlots(rail, wrapper),
      originalTransition: wrapper.style.transition,
      manualTransform: getAppliedPortraitManualTransform(wrapper, data.actorId),
      dragging: true,
      detached: false,
      targetWrapper: null,
      remote: true
    };

    wrapper.classList.add("ginzzzu-portrait-dragging", "ginzzzu-portrait-remote-dragging");
    wrapper.style.setProperty("--ginzzzu-remote-drag-duration", "90ms");
    wrapper.style.transition = [
      "--ginzzzu-drag-x 90ms linear",
      "--ginzzzu-drag-y 90ms linear",
      "--ginzzzu-drag-lift 90ms linear",
      "--ginzzzu-drag-tilt 90ms linear",
      "--ginzzzu-drag-scale 90ms linear"
    ].join(", ");
    setPortraitNameDragVisual(state, 0, 0, 0);
    remotePortraitDrags.set(key, state);
    return state;
  }

  function applyRemotePortraitDragPreview(data) {
    if (!data?.actorId || data.userId === game.user?.id) return;
    if (data.sceneId && data.sceneId !== canvas?.scene?.id) return;
    if (!getPortraitDragActor(data.actorId)) return;
    if (!canUserReorderPortrait(data.actorId, data.userId)) return;

    const key = getRemotePortraitDragKey(data);
    let state = remotePortraitDrags.get(key);
    if (!isPortraitDragSyncEnabled()) {
      if (state) {
        remotePortraitDrags.delete(key);
        clearPortraitDragVisual(state, { animateBack: false });
      }
      return;
    }

    if (data.phase === "start") {
      beginRemotePortraitDrag(data);
      return;
    }

    if (!state) state = beginRemotePortraitDrag(data);
    if (!state) return;

    if (data.phase === "end" || data.phase === "cancel") {
      remotePortraitDrags.delete(key);
      const keptPosition = data.phase === "end" && !!data.kept && data.manualTransform;
      const resetPosition = data.phase === "end" && !!data.reset && data.manualTransform;
      if (keptPosition || resetPosition) {
        if (Number.isFinite(Number(data.zIndex))) {
          setPortraitManualZIndex(data.actorId, Number(data.zIndex), { root: state.root });
        }
        commitRemotePortraitDragManualTransform(state, manualTransformFromShared(data.manualTransform));
        return;
      }

      if (data.phase === "end") {
        const dx = Number(data.dxRatio || 0) * Math.max(1, state.startRect.width);
        const dy = Number(data.dyRatio || 0) * Math.max(1, state.startRect.height);
        setPortraitDragScaleMultiplier(state, data.dragScale);
        if (Number.isFinite(Number(data.dragTiltOffset))) {
          state.dragTiltOffset = Number(data.dragTiltOffset);
        }
        applyPortraitDragVisual(state, dx, dy, {
          targetWrapper: null,
          detached: !!data.detached,
          detachThreshold: state.detachThreshold
        });
      }
      if (data.swapped) {
        holdRemotePortraitSwapDrag(state);
        return;
      }
      clearPortraitDragVisual(state, {
        animateBack: data.phase === "cancel"
      });
      return;
    }

    const dx = Number(data.dxRatio || 0) * Math.max(1, state.startRect.width);
    const dy = Number(data.dyRatio || 0) * Math.max(1, state.startRect.height);
    setPortraitDragScaleMultiplier(state, data.dragScale);
    if (Number.isFinite(Number(data.dragTiltOffset))) {
      state.dragTiltOffset = Number(data.dragTiltOffset);
    }
    applyPortraitDragVisual(state, dx, dy, {
      targetWrapper: null,
      detached: !!data.detached,
      detachThreshold: state.detachThreshold
    });
  }

  function findPortraitDragTarget(state) {
    if (!state?.slots?.length || !state.wrapper) return null;

    const direction = Math.sign(state.lastDx);
    if (!direction) return null;

    const dragCenterX = state.startCenterX + state.lastDx;

    let best = null;
    let bestDistance = Infinity;

    for (const slot of state.slots) {
      if (slot.isDragged) continue;

      const isOnDragSide = direction > 0
        ? slot.centerX > state.startCenterX
        : slot.centerX < state.startCenterX;
      if (!isOnDragSide) continue;

      const buffer = Math.min(slot.width * PORTRAIT_DRAG.targetBufferRatio, 24);
      const overlaps = dragCenterX >= slot.left && dragCenterX <= slot.right;
      const crossed = direction > 0
        ? dragCenterX >= slot.centerX - buffer
        : dragCenterX <= slot.centerX + buffer;
      if (!overlaps && !crossed) continue;

      const distance = Math.abs(dragCenterX - slot.centerX);
      if (distance < bestDistance) {
        best = slot.wrapper;
        bestDistance = distance;
      }
    }

    return best;
  }

  function swapPortraitWrappers(a, b) {
    if (!a || !b || a === b || a.parentNode !== b.parentNode) return false;

    const parent = a.parentNode;
    const aNext = a.nextSibling;
    const bNext = b.nextSibling;

    if (aNext === b) {
      parent.insertBefore(b, a);
    } else if (bNext === a) {
      parent.insertBefore(a, b);
    } else {
      parent.insertBefore(a, bNext);
      parent.insertBefore(b, aNext);
    }

    return true;
  }

  function clearPortraitDragProperties(wrapper, {
    position = true,
    residual = true
  } = {}) {
    if (!wrapper) return;

    if (position) {
      wrapper.style.removeProperty("--ginzzzu-remote-drag-duration");
      wrapper.style.removeProperty("--ginzzzu-drag-x");
      wrapper.style.removeProperty("--ginzzzu-drag-y");
      wrapper.style.removeProperty("--ginzzzu-drag-lift");
    }

    if (residual) {
      wrapper.style.removeProperty("--ginzzzu-drag-tilt");
      wrapper.style.removeProperty("--ginzzzu-drag-scale");
    }
  }

  function holdRemotePortraitSwapDrag(state) {
    if (!state?.wrapper || !state.actorId) return;

    const actorId = String(state.actorId);
    const previous = pendingRemoteSwapDrags.get(actorId);
    if (previous && previous !== state) clearPendingRemoteSwapDrag(actorId, { animateBack: false });

    setPortraitDragTarget(state, null);
    state.wrapper.classList.remove(
      "ginzzzu-portrait-drag-pending",
      "ginzzzu-portrait-dragging",
      "ginzzzu-portrait-remote-dragging",
      "ginzzzu-portrait-detached"
    );
    const holdMs = Math.max(4000, (Number(_ANIM.moveMs) || 0) + 1200);
    state.pendingSwapTimeout = setTimeout(() => {
      clearPendingRemoteSwapDrag(actorId, { animateBack: false });
    }, holdMs);

    pendingRemoteSwapDrags.set(actorId, state);
    followNamePositionsFor(holdMs);
  }

  function clearPendingRemoteSwapDrag(actorId, { animateBack = false } = {}) {
    const id = String(actorId || "");
    const state = pendingRemoteSwapDrags.get(id);
    if (!state) return null;

    pendingRemoteSwapDrags.delete(id);
    if (state.pendingSwapTimeout) {
      clearTimeout(state.pendingSwapTimeout);
      state.pendingSwapTimeout = null;
    }
    clearPortraitDragVisual(state, { animateBack });
    return state;
  }

  function preparePendingRemoteSwapDragsForSequence(wrappers) {
    if (!pendingRemoteSwapDrags.size || !wrappers?.length) return [];

    const actorIds = new Set(
      wrappers
        .map(wrapper => String(wrapper?.dataset?.actorId || ""))
        .filter(Boolean)
    );
    const states = [];

    for (const [actorId, state] of Array.from(pendingRemoteSwapDrags.entries())) {
      if (!actorIds.has(actorId)) continue;

      pendingRemoteSwapDrags.delete(actorId);
      if (state.pendingSwapTimeout) {
        clearTimeout(state.pendingSwapTimeout);
        state.pendingSwapTimeout = null;
      }

      if (state.wrapper) {
        state.wrapper.style.transition = "none";
        void state.wrapper.offsetWidth;
      }
      clearPortraitDragProperties(state.wrapper, { residual: false });
      clearPortraitNameDragVisual(state, { animateBack: false });
      states.push(state);
    }

    return states;
  }

  function settlePendingRemoteSwapDragTransform(state) {
    const wrapper = state?.wrapper;
    if (!wrapper?.isConnected) return;

    const duration = Math.max(0, Number(_ANIM.moveMs) || 0);
    wrapper.style.transition = [
      `--ginzzzu-drag-tilt ${duration}ms ${_ANIM.easing}`,
      `--ginzzzu-drag-scale ${duration}ms ${_ANIM.easing}`
    ].join(", ");
    void wrapper.offsetWidth;
    clearPortraitDragProperties(wrapper, { position: false });
  }

  function finishPendingRemoteSwapDragsAfterSequence(states) {
    if (!states?.length) return;

    const delay = Math.max(0, Number(_ANIM.moveMs) || 0) + 80;
    for (const state of states) {
      settlePendingRemoteSwapDragTransform(state);
    }
    followNamePositionsFor(delay);
    setTimeout(() => {
      for (const state of states) {
        const wrapper = state?.wrapper;
        if (!wrapper?.isConnected) continue;
        wrapper.style.transition = state.originalTransition || `transform ${_ANIM.moveMs}ms ${_ANIM.easing}`;
      }
      scheduleNamePositionsUpdate();
    }, delay);
  }

  function commitRemotePortraitDragManualTransform(state, transform) {
    if (!state?.wrapper) return;

    const wrapper = state.wrapper;
    const duration = Math.max(0, Number(_ANIM.moveMs) || 0);
    const delay = duration + 80;

    setPortraitDragTarget(state, null);
    wrapper.classList.remove(
      "ginzzzu-portrait-drag-pending",
      "ginzzzu-portrait-dragging",
      "ginzzzu-portrait-remote-dragging",
      "ginzzzu-portrait-detached"
    );
    wrapper.style.transition = `transform ${duration}ms ${_ANIM.easing}`;
    void wrapper.offsetWidth;

    applyPortraitManualTransform(state.actorId, transform, {
      root: state.root,
      scheduleNames: false
    });
    clearPortraitDragProperties(wrapper);
    clearPortraitNameDragVisual(state, { animateBack: false });
    followNamePositionsFor(delay);

    setTimeout(() => {
      if (wrapper.isConnected) {
        wrapper.style.transition = state.originalTransition || `transform ${_ANIM.moveMs}ms ${_ANIM.easing}`;
      }
      scheduleNamePositionsUpdate();
    }, delay);
  }

  function clearPortraitDragVisual(state, { animateBack = false } = {}) {
    if (!state?.wrapper) return;

    const wrapper = state.wrapper;
    const shouldAnimateBack = animateBack;
    setPortraitDragTarget(state, null);
    if (!state.remote) state.root?.classList?.remove("ginzzzu-portrait-drag-active");
    wrapper.classList.remove(
      "ginzzzu-portrait-drag-pending",
      "ginzzzu-portrait-dragging",
      "ginzzzu-portrait-remote-dragging",
      "ginzzzu-portrait-detached"
    );

    if (shouldAnimateBack) {
      wrapper.style.transition = state.originalTransition || `transform ${_ANIM.moveMs}ms ${_ANIM.easing}`;
      void wrapper.offsetWidth;
    } else {
      wrapper.style.transition = "none";
    }

    clearPortraitDragProperties(wrapper);
    clearPortraitNameDragVisual(state, { animateBack: shouldAnimateBack });

    if (!shouldAnimateBack) {
      requestAnimationFrame(() => {
        if (wrapper.isConnected) {
          wrapper.style.transition = state.originalTransition || `transform ${_ANIM.moveMs}ms ${_ANIM.easing}`;
        }
      });
    }

    if (shouldAnimateBack) {
      const delay = Math.max(0, Number(_ANIM.moveMs) || 0) + 80;
      followNamePositionsFor(delay);
      setTimeout(() => scheduleNamePositionsUpdate(), delay);
    } else {
      scheduleNamePositionsUpdate();
    }
  }

  function resetPortraitManualTransform(actorId, {
    root = getDomHud(),
    animate = true
  } = {}) {
    const id = String(actorId || "").trim();
    if (!id || !root || !canUserReorderPortrait(id, game.user)) return false;

    const wrapper = getWrapperByActorId(id, root);
    if (!wrapper || isZeroPortraitManualTransform(getAppliedPortraitManualTransform(wrapper, id))) {
      return false;
    }

    const resetTransform = normalizePortraitManualTransform(null);
    const zIndex = setPortraitManualZIndex(id, null, { root });
    setSyncedPortraitManualTransform(id, resetTransform, {
      applyLocal: true,
      animate,
      zIndex
    });
    return true;
  }

  function finishPortraitDrag(ev, { cancelled = false } = {}) {
    const state = activePortraitDrag;
    if (!state) return;
    if (ev && ev.pointerId != null && ev.pointerId !== state.pointerId) return;

    activePortraitDrag = null;

    window.removeEventListener("pointermove", _onPortraitPointerMove);
    window.removeEventListener("pointerup", _onPortraitPointerUp);
    window.removeEventListener("pointercancel", _onPortraitPointerCancel);
    window.removeEventListener("wheel", _onPortraitWheel);

    try { state.wrapper.releasePointerCapture?.(state.pointerId); } catch (e) {}

    const keepPositionKeyActive = isPortraitControlKeyActive(PORTRAIT_KEYBINDINGS.KEEP_DRAG_POSITION, ev);
    const canSwap = !cancelled && state.dragging && state.detached && state.targetWrapper?.isConnected;
    const shouldSwap = canSwap && !keepPositionKeyActive;
    const resetOnRelease = shouldResetPortraitDragPositionOnRelease();
    const shouldKeepPosition = !cancelled && state.dragging && !shouldSwap && (
      resetOnRelease ? keepPositionKeyActive : !keepPositionKeyActive
    );
    const shouldResetPosition = !cancelled && state.dragging && !shouldSwap && !shouldKeepPosition;
    const finalManualTransform = shouldKeepPosition
      ? getPortraitDragFinalManualTransform(state)
      : (shouldResetPosition ? normalizePortraitManualTransform(null) : null);
    const manualZIndex = (shouldKeepPosition || shouldResetPosition)
      ? setPortraitManualZIndex(state.actorId, null, { root: state.root })
      : null;
    const firstRects = shouldSwap ? collectFirstRects() : null;
    const targetWrapper = state.targetWrapper;

    if (ev && state.dragging) {
      ev.preventDefault?.();
      ev.stopPropagation?.();
    }

    if (state.dragging) {
      emitPortraitDragPreview(state, cancelled ? "cancel" : "end", {
        force: true,
        swapped: shouldSwap,
        kept: shouldKeepPosition,
        reset: shouldResetPosition,
        manualTransform: finalManualTransform && manualTransformToShared(finalManualTransform),
        zIndex: manualZIndex
      });
    }

    if (shouldKeepPosition) {
      applyPortraitManualTransform(state.actorId, finalManualTransform, {
        root: state.root,
        scheduleNames: false
      });
      clearPortraitDragVisual(state, { animateBack: false });
      setSyncedPortraitManualTransform(state.actorId, finalManualTransform, {
        applyLocal: false,
        zIndex: manualZIndex
      });
    } else if (shouldResetPosition) {
      applyPortraitManualTransform(state.actorId, getPortraitDragFinalManualTransform(state), {
        root: state.root,
        scheduleNames: false
      });
      clearPortraitDragVisual(state, { animateBack: false });
      requestAnimationFrame(() => {
        setSyncedPortraitManualTransform(state.actorId, finalManualTransform, {
          applyLocal: true,
          animate: true,
          zIndex: manualZIndex
        });
      });
    } else {
      clearPortraitDragVisual(state, { animateBack: state.dragging && !shouldSwap });
    }

    if (shouldSwap && swapPortraitWrappers(state.wrapper, targetWrapper)) {
      relayoutDomHud(firstRects);
      setSharedPortraitSequence(getCurrentPortraitSequence());
    } else if (pendingSharedPortraitSequence) {
      const sequence = pendingSharedPortraitSequence;
      pendingSharedPortraitSequence = null;
      applySharedPortraitSequence(sequence, { animate: true });
    }
  }

  function beginPortraitDrag(state) {
    if (!state || state.dragging) return;
    state.dragging = true;
    setPortraitManualZIndex(state.actorId, null, { root: state.root });
    state.wrapper.classList.remove("ginzzzu-portrait-drag-pending");
    state.wrapper.classList.add("ginzzzu-portrait-dragging");
    state.wrapper.style.transition = "none";
    setPortraitNameDragVisual(state, 0, 0, 0);
    emitPortraitDragPreview(state, "start", { force: true });
  }

  function updatePortraitDrag(ev) {
    const state = activePortraitDrag;
    if (!state || ev.pointerId !== state.pointerId) return;

    const transformKeyActive = isPortraitControlKeyActive(PORTRAIT_KEYBINDINGS.TRANSFORM_DRAG, ev);

    if (state.altTransformDragActive && !transformKeyActive) {
      state.startX = ev.clientX - (Number(state.lastDx) || 0);
      state.startY = ev.clientY - (Number(state.lastDy) || 0);
      state.altTransformDragActive = false;
    }

    let dx = ev.clientX - state.startX;
    let dy = ev.clientY - state.startY;
    const distance = Math.hypot(dx, dy);

    if (!state.dragging && distance < PORTRAIT_DRAG.startThresholdPx) return;
    beginPortraitDrag(state);

    ev.preventDefault();
    ev.stopPropagation();

    const detachThreshold = Math.max(
      PORTRAIT_DRAG.minDetachPx,
      state.startRect.width * PORTRAIT_DRAG.detachRatio
    );
    state.detachThreshold = detachThreshold;

    if (transformKeyActive) {
      if (!state.altTransformDragActive) {
        const currentDx = Number(state.lastDx);
        const currentDy = Number(state.lastDy);
        state.altTransformDragActive = true;
        state.altStartX = ev.clientX;
        state.altStartY = ev.clientY;
        state.altStartFinalScale = getPortraitDragFinalScale(state);
        state.altStartTiltOffset = getPortraitDragTiltOffset(state);
        state.altBaseDx = Number.isFinite(currentDx) ? currentDx : dx;
        state.altBaseDy = Number.isFinite(currentDy) ? currentDy : dy;
      }

      dx = Number(state.altBaseDx) || 0;
      dy = Number(state.altBaseDy) || 0;

      const scaleFactor = Math.exp((state.altStartY - ev.clientY) * PORTRAIT_DRAG.pointerScaleSpeed);
      setPortraitDragFinalScale(state, state.altStartFinalScale * scaleFactor);

      const baseTransform = normalizePortraitManualTransform(state.manualTransform);
      const finalX = (Number(baseTransform.x) || 0) + dx;
      const autoTilt = getPortraitAutoTiltForX(finalX, state.startRect.width);
      const nextTilt = clampPortraitTilt(
        autoTilt +
        (Number(state.altStartTiltOffset) || 0) +
        ((ev.clientX - state.altStartX) * PORTRAIT_DRAG.pointerRotateSpeedDeg)
      );
      setPortraitDragFinalTilt(state, nextTilt, dx);
    }

    state.lastDx = dx;
    state.lastDy = dy;
    const targetWrapper = !transformKeyActive && Math.abs(dx) >= detachThreshold ? findPortraitDragTarget(state) : null;
    const detached = !transformKeyActive && (Math.abs(dx) >= detachThreshold || !!targetWrapper);

    applyPortraitDragVisual(state, dx, dy, { targetWrapper, detached, detachThreshold });
    emitPortraitDragPreview(state, "move");
  }

  function _onPortraitPointerMove(ev) {
    updatePortraitDrag(ev);
  }

  function _onPortraitPointerUp(ev) {
    finishPortraitDrag(ev);
  }

  function _onPortraitPointerCancel(ev) {
    finishPortraitDrag(ev, { cancelled: true });
  }

  function updatePortraitDragScale(ev) {
    const state = activePortraitDrag;
    if (!state) return;

    beginPortraitDrag(state);
    ev.preventDefault?.();
    ev.stopPropagation?.();

    const currentFinalScale = getPortraitDragFinalScale(state);
    const factor = Math.exp(-(Number(ev.deltaY) || 0) * PORTRAIT_DRAG.wheelScaleSpeed);

    setPortraitDragFinalScale(state, currentFinalScale * factor);
    applyPortraitDragVisual(state, state.lastDx || 0, state.lastDy || 0, {
      targetWrapper: state.targetWrapper,
      detached: !!state.detached,
      detachThreshold: state.detachThreshold
    });
    emitPortraitDragPreview(state, "move", { force: true });
  }

  function _onPortraitWheel(ev) {
    updatePortraitDragScale(ev);
  }

  function _onPortraitPointerDown(ev) {
    if (ev.button !== 0 || isPortraitControlKeyActive(PORTRAIT_KEYBINDINGS.ACTION_MODIFIER, ev)) return;
    if (shouldIgnorePortraitDragTarget(ev.target)) return;

    const wrapper = ev.currentTarget?.closest?.(".ginzzzu-portrait-wrapper");
    if (!wrapper) return;
    const img = wrapper.querySelector("img.ginzzzu-portrait");
    if (!img?.dataset?.actorId) return;
    const actorId = img.dataset.actorId;

    if (!canUserReorderPortrait(actorId, game.user)) return;

    if (activePortraitDrag) {
      finishPortraitDrag(null, { cancelled: true });
    }

    const root = getDomHud();
    const rail = getPortraitRail(root);
    if (!root || !rail) return;

    const startRect = wrapper.getBoundingClientRect();

    activePortraitDrag = {
      actorId,
      root,
      rail,
      wrapper,
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      lastDx: 0,
      lastDy: 0,
      dragScale: 1,
      startRect,
      startCenterX: startRect.left + (startRect.width / 2),
      detachThreshold: Math.max(
        PORTRAIT_DRAG.minDetachPx,
        startRect.width * PORTRAIT_DRAG.detachRatio
      ),
      slots: collectPortraitDragSlots(rail, wrapper),
      originalTransition: wrapper.style.transition,
      manualTransform: getAppliedPortraitManualTransform(wrapper, actorId),
      dragging: false,
      detached: false,
      targetWrapper: null
    };

    root.classList.add("ginzzzu-portrait-drag-active");
    wrapper.classList.add("ginzzzu-portrait-drag-pending");

    try { wrapper.setPointerCapture?.(ev.pointerId); } catch (e) {}

    window.addEventListener("pointermove", _onPortraitPointerMove, { passive: false });
    window.addEventListener("pointerup", _onPortraitPointerUp, { passive: false });
    window.addEventListener("pointercancel", _onPortraitPointerCancel, { passive: false });
    window.addEventListener("wheel", _onPortraitWheel, { passive: false });
  }

  function _onPortraitDoubleClick(ev) {
    if (ev.type !== "dblclick" || ev.button !== 0) return;
    if (shouldResetPortraitDragPositionOnRelease()) return;
    if (isPortraitControlKeyActive(PORTRAIT_KEYBINDINGS.ACTION_MODIFIER, ev)) return;
    if (shouldIgnorePortraitDragTarget(ev.target)) return;

    const wrapper = ev.currentTarget?.closest?.(".ginzzzu-portrait-wrapper");
    const actorId = String(wrapper?.dataset?.actorId || "").trim();
    if (!wrapper || !actorId) return;

    const root = document.getElementById("ginzzzu-portrait-layer");
    if (!resetPortraitManualTransform(actorId, { root, animate: true })) return;

    ev.preventDefault();
    ev.stopPropagation();
  }

  function insertPortraitWrapperBySharedOrder(rail, wrapper) {
    const actorId = wrapper?.dataset?.actorId;
    const sequence = getSharedPortraitSequence();

    if (!rail || !actorId || !sequence.length || !sequence.includes(actorId)) {
      rail?.appendChild(wrapper);
      return;
    }

    const ownIndex = sequence.indexOf(actorId);
    const existingWrappers = Array.from(rail.querySelectorAll(".ginzzzu-portrait-wrapper"));
    const before = existingWrappers.find(existing => {
      const otherId = existing.dataset.actorId;
      const otherIndex = sequence.indexOf(otherId);
      return otherIndex !== -1 && otherIndex > ownIndex;
    });

    if (before) rail.insertBefore(wrapper, before);
    else rail.appendChild(wrapper);
  }

    // --- Фокус портрета (middle-click) ---

  // actorId того, кто сейчас "в фокусе" (или null, если никого)
  let _focusedActorId = null;

  function _getAllWrappers() {
    const root = getDomHud();
    if (!root) return [];
    return Array.from(root.querySelectorAll(".ginzzzu-portrait-wrapper"));
  }

  function _getDisplayName(actorId) {
    return globalThis.GinzzzuPortraits.getActorDisplayName(actorId);
  }

  function refreshPortraitDisplayNames() {
  const nameMode = game.settings.get(MODULE_ID, "portraitNamesAlwaysVisible") || "hover";
  const showNames = nameMode !== "none";

  const root = getDomHud();
  const wrappers = root ? Array.from(root.querySelectorAll(".ginzzzu-portrait-wrapper")) : [];
  const namesContainer = root ? root.querySelector('#ginzzzu-portrait-names') : null;
  const badgesByActorId = new Map(
    namesContainer
      ? Array.from(namesContainer.querySelectorAll('.ginzzzu-portrait-name[data-actor-id]')).map(badge => [badge.dataset.actorId, badge])
      : []
  );
  const alwaysShowNames = !!root?.classList?.contains('ginzzzu-show-names-always');
  for (const wrapper of wrappers) {
    const actorId = wrapper.dataset.actorId || "";
    const displayName = _getDisplayName(actorId);
    const rawName = wrapper.dataset.rawName ?? "";
    const safeName = String(displayName || rawName);

    updatePortraitReorderCursor(wrapper, actorId);
    wrapper.dataset.displayName = safeName;
    let badge = badgesByActorId.get(actorId) || null;

    if (!safeName || !showNames) {
      // Имя пустое или режим "не показывать" — удаляем плашку
      if (badge) {
        badge.remove();
        badge = null;
        badgesByActorId.delete(actorId);
      }
    } else if (safeName && !badge && namesContainer) {
      // Имя появилось и показ разрешён — создаём плашку in names container
      badge = document.createElement("div");
      badge.className = "ginzzzu-portrait-name";
      badge.dataset.actorId = actorId;
      const inner = document.createElement('span');
      inner.className = 'ginzzzu-portrait-name-inner';
      inner.textContent = safeName;
      badge.appendChild(inner);
      namesContainer.appendChild(badge);
      badgesByActorId.set(actorId, badge);

      // attach hover handlers from the wrapper if present
      try {
        const wrapperEl = root.querySelector(`.ginzzzu-portrait-wrapper[data-actor-id="${actorId}"]`);
        if (wrapperEl) {
          wrapperEl.addEventListener('mouseenter', () => badge.classList.add('visible'), { passive: true });
          wrapperEl.addEventListener('mouseleave', () => {
            if (getDomHud()?.classList?.contains('ginzzzu-show-names-always')) return;
            badge.classList.remove('visible');
          }, { passive: true });
        }
      } catch (e) {}
    }

    if (badge) {
      // Update inner text element, create if missing
      let innerEl = badge.querySelector('.ginzzzu-portrait-name-inner');
      if (!innerEl) {
        innerEl = document.createElement('span');
        innerEl.className = 'ginzzzu-portrait-name-inner';
        // clear stray text nodes
        badge.textContent = '';
        badge.appendChild(innerEl);
      }
      innerEl.textContent = safeName;
      badge.classList.toggle('flipped', wrapper.classList.contains("ginzzzu-portrait-flipped"));
      // Ensure visible state for always-show mode
      if (alwaysShowNames) {
        badge.classList.add('visible');
      } else {
        badge.classList.remove('visible');
      }
    }

    // alt тоже освежим
    const img = wrapper.querySelector("img.ginzzzu-portrait");
    if (img) {
      img.dataset.rawName = rawName;
      img.alt = safeName || "Portrait";
    }
  }
}


  function _getFocusShadowParams() {
    // 0..1 – сила подсветки
    let focusS = Number(game.settings.get(MODULE_ID, "portraitFocusHighlightStrength") ?? 0.5);
    let shadowS = Number(game.settings.get(MODULE_ID, "portraitShadowDimStrength") ?? 0.5);
    focusS  = Math.max(0, Math.min(1, focusS));
    shadowS = Math.max(0, Math.min(1, shadowS));

    // Подбираем коэффициенты так, чтобы при s=0.5 примерно попасть
    // в старые значения (brightness 1.12 / 0.7, saturate 1.05 / 0.8)
    const focusBrightness = 1 + 0.24 * focusS;  // 0..+0.24
    const focusSaturate   = 1 + 0.10 * focusS;  // 0..+0.10

    const dimBrightness   = 1 - 0.60 * shadowS; // 1..0.4
    const dimSaturate     = 1 - 0.40 * shadowS; // 1..0.6

    return { focusBrightness, focusSaturate, dimBrightness, dimSaturate };
  }


  function _applyPortraitFocus() {
    const wrappers = _getAllWrappers();
    if (!wrappers.length) return;

    // Берём значения из настроек (0..1)
    const {
      focusBrightness,
      focusSaturate,
      dimBrightness,
      dimSaturate
    } = _getFocusShadowParams();

    const focusPortraitBlurEnabled = game.settings.get(MODULE_ID, "portraitFocusPortraitBlurEnabled");
    const portraitBlurStrength = focusPortraitBlurEnabled
      ? Math.max(1, Math.min(30, Number(game.settings.get(MODULE_ID, "portraitFocusPortraitBlurStrength")) || 8))
      : 0;

    for (const wrapper of wrappers) {
      const img = wrapper.querySelector("img.ginzzzu-portrait");
      if (!img) continue;

      const actorId = img.dataset.actorId;

      // Сохраняем базовый filter и zIndex (чтобы можно было откатить)
      if (!img.dataset.baseFilter) {
        img.dataset.baseFilter = img.style.filter || "";
      }
      if (!wrapper.dataset.baseZ) {
        wrapper.dataset.baseZ = wrapper.style.zIndex || "";
      }

      if (_focusedActorId && actorId === _focusedActorId) {
        // Активный портрет: выше по z-index и чуть ярче/насыщеннее
        wrapper.classList.add("ginzzzu-portrait-focused");
        wrapper.classList.remove("ginzzzu-portrait-dimmed");
        wrapper.style.zIndex = "9999";

        img.style.filter = `${img.dataset.baseFilter} brightness(${focusBrightness}) saturate(${focusSaturate})`;

      } else if (_focusedActorId) {
        // Остальные — в "тень", но без изменения размера
        wrapper.classList.remove("ginzzzu-portrait-focused");
        wrapper.classList.add("ginzzzu-portrait-dimmed");
        wrapper.style.zIndex = getPortraitLayerZIndex(actorId, wrapper.dataset.baseZ || wrapper.style.zIndex);

        // Build filter string with blur if enabled
        let filterStr = `${img.dataset.baseFilter} brightness(${dimBrightness}) saturate(${dimSaturate})`;
        if (focusPortraitBlurEnabled && portraitBlurStrength > 0) {
          filterStr += ` blur(${portraitBlurStrength}px)`;
        }
        img.style.filter = filterStr;

      } else {
        // Фокуса нет — вернуть всё как было
        wrapper.classList.remove("ginzzzu-portrait-focused", "ginzzzu-portrait-dimmed");

        if (wrapper.dataset.baseZ) {
          wrapper.style.zIndex = getPortraitLayerZIndex(actorId, wrapper.dataset.baseZ);
        }
        if (img.dataset.baseFilter) {
          img.style.filter = img.dataset.baseFilter;
        }
      }
    }

    // === Apply focus blur effect to background ===
    const root = getDomHud();
    if (!root) return;
    if (isPortraitUiHidden(root)) {
      clearPortraitBlur(root);
      return;
    }

    const focusBlurEnabled = game.settings.get(MODULE_ID, "portraitFocusBlurEnabled");
    const blurEnabled = game.settings.get(MODULE_ID, "portraitBlurEnabled");

    if (_focusedActorId && focusBlurEnabled) {
      // When focus is active and focus blur is enabled, apply focus blur effect
      const focusBlurStrength = Math.max(1, Math.min(30, Number(game.settings.get(MODULE_ID, "portraitFocusBlurStrength")) || 16));

      // Check if base blur is also enabled, if so add both strengths
      if (blurEnabled) {
        const baseBlurStrength = Math.max(1, Math.min(30, Number(game.settings.get(MODULE_ID, "portraitBlurStrength")) || 8));
        const totalBlurStrength = baseBlurStrength + focusBlurStrength;
        root.style.setProperty("--ginzzzu-blur-strength-value", `${totalBlurStrength}px`);
      } else {
        // Base blur disabled, use only focus blur strength
        root.style.setProperty("--ginzzzu-blur-strength-value", `${focusBlurStrength}px`);
      }

      root.classList.add("ginzzzu-portrait-blur-active");
      root.classList.add("ginzzzu-portrait-focus-blur-active");
    } else if (blurEnabled) {
      // No focus blur to add: keep the base blur strength
      const baseBlurStrength = Math.max(1, Math.min(30, Number(game.settings.get(MODULE_ID, "portraitBlurStrength")) || 8));
      root.style.setProperty("--ginzzzu-blur-strength-value", `${baseBlurStrength}px`);
      root.classList.add("ginzzzu-portrait-blur-active");
      root.classList.remove("ginzzzu-portrait-focus-blur-active");
    } else {
      // All blur effects disabled or conditions not met
      root.classList.remove("ginzzzu-portrait-blur-active");
      root.classList.remove("ginzzzu-portrait-focus-blur-active");
      root.style.removeProperty("--ginzzzu-blur-strength-value");
      root.style.removeProperty("--ginzzzu-blur-speed-value");
    }
  }

  // --- Флип портрета (горизонтальное отражение) ---

  // Обновляем визуальный флип через класс на wrapper
  function _updateImgTransformForFlip(img) {
    if (!img) return;
    const wrapper = img.closest(".ginzzzu-portrait-wrapper");
    if (!wrapper) return;

    const isFlipped = img.dataset.flipped === "1";

    // Mirror badge text back so it's readable (badges live in names container)
    let badge = null;
    try {
      const root = getDomHud();
      const namesContainer = root ? root.querySelector('#ginzzzu-portrait-names') : null;
      badge = namesContainer ? namesContainer.querySelector(`.ginzzzu-portrait-name[data-actor-id="${img.dataset.actorId}"]`) : null;
    } catch (e) {}

    const wrapperAlreadyFlipped = wrapper.classList.contains("ginzzzu-portrait-flipped") === isFlipped;
    const badgeAlreadyFlipped = !badge || badge.classList.contains("flipped") === isFlipped;
    if (wrapperAlreadyFlipped && badgeAlreadyFlipped) return;

    // навешиваем/снимаем класс, сам transform перенесём в CSS
    if (!wrapperAlreadyFlipped) wrapper.classList.toggle("ginzzzu-portrait-flipped", isFlipped);
    if (badge && !badgeAlreadyFlipped) badge.classList.toggle('flipped', isFlipped);
  }


  // локальное применение флипа по actorId (без записи в сцену)
  function _setLocalFlipByActorId(actorId, isFlipped) {
    if (!actorId) return;
    const map = domStore();
    const img = map.get(actorId);
    if (!img) return;

    const nextValue = isFlipped ? "1" : "0";
    if (img.dataset.flipped !== nextValue) img.dataset.flipped = nextValue;
    _updateImgTransformForFlip(img);
  }

  // общий флип с синхронизацией через флаг сцены
  function setSharedPortraitFlip(actorId, isFlipped) {
    _setLocalFlipByActorId(actorId, isFlipped);
    setCastFlip(actorId, !!isFlipped).catch(e => {
      console.error("[threeO-portraits] setSharedPortraitFlip error:", e);
    });
  }

function _onPortraitClick(ev) {
  if (ev.type !== "contextmenu") return;
  if (ev.button !== 2) return;
  if (!game.user?.isGM) return;

  ev.preventDefault();
  ev.stopPropagation();

  const wrapper = ev.currentTarget.closest(".ginzzzu-portrait-wrapper");
  if (!wrapper) return;
  const img = wrapper.querySelector("img.ginzzzu-portrait");
  if (!img) return;

  const actorId = img.dataset.actorId;
  if (!actorId) return;
  if (!getPersona(actorId)) return;

  const current = img.dataset.flipped === "1";
  const next = !current;
  setSharedPortraitFlip(actorId, next);
}


  function setPortraitFocusByActorId(actorIdOrNull) {
    _focusedActorId = actorIdOrNull || null;
    applyPortraitLayerOrder();
    _applyPortraitFocus();
  }

  function setSharedPortraitFocus(actorIdOrNull) {
    const value = actorIdOrNull || null;
    setPortraitFocusByActorId(value);
    if (!game.user?.isGM) return;
    setFocusedPersona(value || "").catch(e => {
      console.error("[threeO-portraits] setSharedPortraitFocus error:", e);
    });
  }

  function _onPortraitAuxClick(ev) {
    if (!game.user?.isGM) return;
    // реагируем только на отпускание средней кнопки (auxclick)
    if (ev.type !== "auxclick") return;

    const button = ev.button;
    if (button !== 1) return;

    ev.preventDefault();
    ev.stopPropagation();

    const wrapper = ev.currentTarget.closest(".ginzzzu-portrait-wrapper");
    if (!wrapper) return;
    const img = wrapper.querySelector("img.ginzzzu-portrait");
    if (!img) return;

    const actorId = img.dataset.actorId;
    if (!actorId) return;

    if (_focusedActorId === actorId) {
      // повторный клик по тому же — снять подсветку
      setSharedPortraitFocus(null);      // см. ниже
    } else {
      setSharedPortraitFocus(actorId);   // см. ниже
    }
  }

  function _onPortraitActionModifierClick(ev) {
    // Configured action modifier + LMB hides the portrait.
    if (ev.type !== "click") return;
    if (ev.button !== 0) return;
    if (!isPortraitControlKeyActive(PORTRAIT_KEYBINDINGS.ACTION_MODIFIER, ev)) return;

    ev.preventDefault();
    ev.stopPropagation();

    const wrapper = ev.currentTarget && ev.currentTarget.closest
      ? ev.currentTarget.closest(".ginzzzu-portrait-wrapper")
      : null;
    if (!wrapper) return;
    const img = wrapper.querySelector("img.ginzzzu-portrait");
    if (!img) return;

    const actorId = img.dataset.actorId;
    if (!actorId) return;
    if (!game.user?.isGM) return;

    hidePersona(actorId).catch(e => {
      console.error("[ginzzzu-portraits] modifier-click hide portrait failed:", e);
    });
  }



  // FIRST: текущие позиции всех портретов (для FLIP)
  function collectFirstRects() {
    const root = getDomHud();
    if (!root) return new Map();
    const rail = root.querySelector("#ginzzzu-portrait-rail") || root;
    const imgs = Array.from(rail.querySelectorAll("img.ginzzzu-portrait"));
    const m = new Map();
    imgs.forEach(el => m.set(el, el.getBoundingClientRect()));
    return m;
  }

  // Применить «жёсткую» геометрию рамки и общий зазор
  function applyGeometry(imgs, vw) {
    // вычисляем базовую ширину рамки из процента и ограничений
    const wantWpx = Math.min(FRAME.maxWidthPx, Math.max(FRAME.minWidthPx, Math.floor((FRAME.widthVw / 100) * vw)));
    // учёт левого и правого паддинга (правый включает текущую ширину #sidebar)
    const sidebarW = getSidebarWidth();
    const leftPad = FRAME.sidePadPx;
    const rightPad = FRAME.sidePadPx + sidebarW;
    const bandW = Math.floor(vw * FRAME.targetBand) - leftPad - rightPad;

    const n = imgs.length || 0;
    let widthPx = wantWpx;
    let gapPx = FRAME.gapBase;

    if (n <= 1) {
      gapPx = 0;
    } else {
      // если разрешено менять width, заранее ограничим его, чтобы не было слишком явного переползания
      if (game.settings.get(MODULE_ID, "visualNovelMode") === false && game.settings.get(MODULE_ID, "resizeToFit")) {
        const possibleAtMinGap = Math.floor((bandW - (n - 1) * FRAME.gapMin) / n);
        widthPx = Math.max(FRAME.minWidthPx, Math.min(wantWpx, possibleAtMinGap));
      }

      // Попытка вместить ряд, регулируя gap. idealGap может быть отрицательным (перекрытие).
      const idealGap = Math.floor((bandW - n * widthPx) / (n - 1));
      // Максимальное допустимое перекрытие (процент ширины)
      const maxOverlap = Math.max(0, Math.floor(widthPx)); // до 100% ширины
      const minGapAllowed = -maxOverlap;

      if (idealGap >= FRAME.gapMin) {
        // поместилось с нормальным/положительным gap
        gapPx = Math.min(idealGap, FRAME.gapBase);
      } else if (idealGap >= minGapAllowed) {
        // поместилось, но потребовалось перекрытие (отрицательный gap)
        gapPx = idealGap;
      } else {
        // Даже при максимальном перекрытии не влазит -> уменьшаем widthPx так, чтобы влазило с максимально допустимым перекрытием
        const widthFit = Math.floor((bandW - (n - 1) * minGapAllowed) / n);
        // Не даём width падать ниже минимумов
        widthPx = Math.max(FRAME.minWidthPx, Math.min(wantWpx, widthFit));
        // Пересчитаем ограничения перекрытия для нового width
        const maxOverlap2 = Math.max(0, Math.floor(widthPx * 0.6));
        const minGapAllowed2 = -maxOverlap2;
        const idealGap2 = Math.floor((bandW - n * widthPx) / (n - 1));
        gapPx = Math.max(idealGap2, minGapAllowed2);
      }
    }

    // Применяем стили (CSS gap используем только для положительного spacing, отрицательные — через margin-left)
    const root = getDomHud();
    const rail = root.querySelector("#ginzzzu-portrait-rail") || root;
    // Обновим padding с учётом возможной динамической ширины sidebar (на случай изменения)
    syncSidePadding(root, rail);
    root.style.gap = `${Math.max(0, gapPx)}px`;
    rail.style.gap = `${Math.max(0, gapPx)}px`;

    let porHeight = game.settings.get(MODULE_ID, "portraitHeight");

    if (game.settings.get(MODULE_ID, "gmForcePortraitHeight")) {
      porHeight = game.settings.get(MODULE_ID, "gmPortraitHeight");
    }

    // актуализируем нижний паддинг по настройке
    const bottomOffsetPx = getBottomOffsetPx();
    rail.style.bottom = `${bottomOffsetPx}px`;

    // Коэффициент «доступной высоты» (0..1) относительно всего окна
    const viewportH = Math.max(
      document.documentElement.clientHeight || 0,
      window.innerHeight || 0
    ) || 1;

    const usableFraction = Math.max(
      0,
      Math.min(1, (viewportH - bottomOffsetPx) / viewportH)
    );

    // Итоговая высота портрета = (настройка) * (доступная доля экрана)
    const effectivePorHeight = porHeight * usableFraction;
    const baseHeightPx = snapToDevicePixel(effectivePorHeight * viewportH);


    // Настройки плашки имени
    let nameV = 50;
    try {
      nameV = Number(game.settings.get(MODULE_ID, "portraitNameVertical") ?? 50);
    } catch (e) {
      nameV = 50;
    }
    nameV = Math.max(0, Math.min(100, nameV));

    let nameFontSize = 25;
    try {
      nameFontSize = Number(game.settings.get(MODULE_ID, "portraitNameFontSize") ?? 25);
    } catch (e) {
      nameFontSize = 25;
    }
    if (!Number.isFinite(nameFontSize)) nameFontSize = 25;
    nameFontSize = Math.max(8, Math.min(72, nameFontSize));

    const subjectById = new Map();
    imgs.forEach((el, i) => {
      const wrapper = el.parentElement;
      if (!wrapper) return;

      // Получаем множитель высоты из актёра
      const actorId = el?.dataset?.actorId;
      let heightMultiplier = 1;
      if (actorId) {
        try {
          let actor = subjectById.get(actorId);
          if (!subjectById.has(actorId)) {
            actor = getPersonaSubject(actorId);
            subjectById.set(actorId, actor);
          }
          if (actor) {
            // Сначала получаем базовый множитель портрета
            const portraitMultiplier = foundry.utils.getProperty(actor, FLAG_PORTRAIT_HEIGHT_MULTIPLIER);
            let baseMultiplier = 1;
            if (typeof portraitMultiplier === "number" && Number.isFinite(portraitMultiplier)) {
              baseMultiplier = Math.max(0, portraitMultiplier);
            }

            // Затем проверяем множитель эмоции
            const emotionHeightMultiplier = foundry.utils.getProperty(actor, FLAG_EMOTION_HEIGHT_MULTIPLIER);
            if (typeof emotionHeightMultiplier === "number" && Number.isFinite(emotionHeightMultiplier)) {
              // Если эмоция активна, множим оба множителя
              heightMultiplier = Math.max(0, baseMultiplier * emotionHeightMultiplier);
            } else {
              // Если эмоции нет, используем только базовый множитель портрета
              heightMultiplier = baseMultiplier;
            }
          }
        } catch (e) {
          // ignore and use default
        }
      }

      const finalHeightPx = snapToDevicePixel(baseHeightPx * heightMultiplier);

      // Вычисляем offset для компенсации изменения высоты портрета
      // Базовая и актуальная высоты выровнены по физическим пикселям экрана.
      // Компенсирующий offset: только положительный (если портрет больше — панель сдвигается вниз)
      const heightOffsetPx = snapToDevicePixel(Math.max(0, (finalHeightPx - baseHeightPx) / 2));
      const snappedWidthPx = snapToDevicePixel(widthPx);

      wrapper.style.height    = `${finalHeightPx}px`;
      wrapper.style.maxHeight = `${finalHeightPx}px`;
      wrapper.style.width     = `${snappedWidthPx}px`;
      wrapper.style.maxWidth  = `${snappedWidthPx}px`;
      wrapper.style.flex      = "0 0 auto";
      wrapper.style.marginLeft = (i === 0) ? "0px" : `${gapPx}px`;

      // Передаём offset в CSS-переменную для компенсации высоты
      wrapper.style.setProperty("--portrait-height-offset-y", `${heightOffsetPx}px`);

      // Передаём настройки имени в CSS-переменные
      wrapper.style.setProperty("--threeo-portrait-name-top", `${nameV}vh`);
      wrapper.style.setProperty("--threeo-portrait-name-font-size", `${nameFontSize}px`);


      const baseZ = String(i + 1);
      wrapper.dataset.baseZ = baseZ;

      // если портрет сейчас не в фокусе — применяем базовый zIndex;
      // фокусный оставляем выдвинутым вперёд
      const img = wrapper.querySelector("img.ginzzzu-portrait");
      const picActorId = img?.dataset.actorId;
      if (!_focusedActorId || !picActorId || picActorId !== _focusedActorId) {
        wrapper.style.zIndex = getPortraitLayerZIndex(picActorId, baseZ);
      }
    });

    applyPortraitLayerOrder({ root });

    // после перераскладки обновим "тени"/подсветку (на случай изменения порядка)
    _applyPortraitFocus();
    applyPortraitBreathing({ root });
    // обновим позиции именных плашек
    try { updateNamePositions(); } catch (e) {}
  }


  // FLIP-анимация сдвига через Web Animations API
  function animateFlip(imgs, firstRects, lastRects) {
    // Pre-calculate all transforms before starting animations
    const animations = imgs.map(el => {
      const first = firstRects.get(el);
      const last = lastRects.get(el);
      if (!first || !last) return null;

      const dx = first.left - last.left;
      const dy = first.top - last.top;

      // Get base transform
      const base = getComputedStyle(el).transform;
      const baseTransform = (base && base !== "none") ? base : "none";
      // If the wrapper (or ancestor) is flipped horizontally (scaleX < 0),
      // the horizontal delta should be inverted so the visual direction
      // of the animation matches the actual layout change.
      let dxAdj = dx;
      try {
        const wrapper = el.closest && el.closest('.ginzzzu-portrait-wrapper');
        if (wrapper) {
          const wcs = getComputedStyle(wrapper).transform;
          if (wcs && wcs !== 'none') {
            const m = wcs.match(/matrix(3d)?\(([^)]+)\)/);
            if (m && m[2]) {
              const parts = m[2].split(',').map(s => parseFloat(s.trim()));
              // For both matrix() and matrix3d(), the first element is scaleX (or contains it)
              const scaleX = Number.isFinite(parts[0]) ? parts[0] : 1;
              if (scaleX < 0) dxAdj = -dxAdj;
            }
          }
        }
      } catch (e) {
        // ignore and use unadjusted dx
      }

      // Prepare transforms
      const fromTransform = baseTransform === "none"
        ? `translate(${dxAdj}px, ${dy}px)`
        : `${baseTransform} translate(${dxAdj}px, ${dy}px)`;
      const toTransform = baseTransform === "none"
        ? "none"
        : baseTransform;

      return { el, fromTransform, toTransform };
    }).filter(Boolean);

    // Start all animations
    const runningAnimations = [];
    animations.forEach(({el, fromTransform, toTransform}) => {
      const animation = el.animate(
        [
          { transform: fromTransform },
          { transform: toTransform }
        ],
        {
          duration: _ANIM.moveMs,
          easing: _ANIM.easing,
          fill: "none",
          composite: "replace"
        }
      );
      runningAnimations.push(animation);
    });

    scheduleAfterAnimationSettles(_ANIM.moveMs, () => {
      runningAnimations.forEach(animation => {
        try { animation.cancel(); } catch (e) {}
      });
    });
  }

  // Перераскладка ряда с FLIP
  function relayoutDomHud(firstRects /* Map<Element, DOMRect> | undefined */) {
    const root = getDomHud();
    if (!root) return;
    const rail = root.querySelector("#ginzzzu-portrait-rail") || root;

    const imgs = Array.from(rail.querySelectorAll("img.ginzzzu-portrait"));
    const n = imgs.length;
    if (!n) return;

    if (!firstRects) firstRects = collectFirstRects();

    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);

    // 1) применяем геометрию (это изменит layout)
    applyGeometry(imgs, vw);

    // 2) снимаем LAST
    const lastRects = new Map();
    imgs.forEach(el => lastRects.set(el, el.getBoundingClientRect()));

    // 3) анимируем сдвиг
    animateFlip(imgs, firstRects, lastRects);
  }

  const portraitOpenToken = new Map();

  function beginPortraitOpen(actorId) {
    const token = (portraitOpenToken.get(actorId) || 0) + 1;
    portraitOpenToken.set(actorId, token);
    return token;
  }

  function isPortraitOpenCurrent(actorId, token) {
    return portraitOpenToken.get(actorId) === token;
  }

  function portraitWrapperSelector(actorId) {
    const id = String(actorId || "");
    const safe = (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(id) : id.replace(/["\\]/g, "");
    return `.ginzzzu-portrait-wrapper[data-actor-id="${safe}"]`;
  }

  function getPortraitWrappers(actorId, root = getDomHud()) {
    if (!root || !actorId) return [];
    return Array.from(root.querySelectorAll(portraitWrapperSelector(actorId)));
  }

  function shouldShowPortrait(actorId) {
    try {
      if (game.settings.get(MODULE_ID, "hidePortraits")) return false;
    } catch {}
    return isTheatreStage() && getShownPersonaIds().includes(actorId);
  }

  function removePortraitNameBadges(actorId, root = getDomHud()) {
    const namesContainer = root?.querySelector("#ginzzzu-portrait-names");
    if (!namesContainer || !actorId) return;
    const id = String(actorId);
    const safe = (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(id) : id.replace(/["\\]/g, "");
    namesContainer.querySelectorAll(`.ginzzzu-portrait-name[data-actor-id="${safe}"]`).forEach(badge => badge.remove());
  }

  // Показ одного портрета (создание/обновление DOM + FLIP других)
  async function openLocalPortrait({ actorId, img, name, relayout = true }) {
    if (!actorId || !img) return;

    const token = beginPortraitOpen(actorId);
    const root = getDomHud();
    if (!root) return;
    _toneApplyToRootVars(root);
    const rail = root.querySelector("#ginzzzu-portrait-rail") || root;

    const map = domStore();
    const existing = map.get(actorId);

    const rawName = typeof name === "string" ? name : "";
    const displayName = _getDisplayName(actorId);
    const safeName = String(displayName || rawName);

    // Уже есть с тем же src — ничего не делаем
    if (existing) {
      const wrapper = existing.closest(".ginzzzu-portrait-wrapper");
      if (wrapper && wrapper.dataset.src === img && wrapper.dataset.threeoPortraitClosing !== "1") {
        for (const extra of getPortraitWrappers(actorId, root)) {
          if (extra !== wrapper) extra.remove();
        }
        existing.style.opacity = "1";
        existing.style.transform = PORTRAIT_IMG_ANCHOR;
        setPortraitManualZIndex(actorId, null, { root });
        applyPortraitManualTransform(actorId, getPortraitManualTransform(actorId), { root });
        return;
      }
    }

    // FIRST до изменения DOM (для плавного сдвига остальных)
    const firstRects = relayout ? collectFirstRects() : null;

    if (existing) { try { existing.remove(); } catch {} ; map.delete(actorId); }

    // Preload image before inserting into DOM to avoid flashing broken images
    let finalSrc = img;
    try {
      await _preloadImage(img);
    } catch (e) {
      console.warn("[threeO-portraits] image preload failed for", img, " — using placeholder");
      finalSrc = "icons/svg/mystery-man.svg";
      // attempt to preload placeholder (best-effort)
      try { await _preloadImage(finalSrc); } catch {}
    }

    if (!isPortraitOpenCurrent(actorId, token) || !shouldShowPortrait(actorId)) return;

    const liveExisting = map.get(actorId);
    if (liveExisting) {
      const liveWrapper = liveExisting.closest(".ginzzzu-portrait-wrapper");
      if (liveWrapper && liveWrapper.dataset.src === img && liveWrapper.dataset.threeoPortraitClosing !== "1") {
        return;
      }
    }

        const el = document.createElement("img");
        el.className = "ginzzzu-portrait";
        el.alt = safeName || "Portrait";
        el.src = finalSrc;
        el.draggable = false;
        el.dataset.actorId = actorId;
        el.dataset.src = img;
        el.dataset.rawName = rawName;

        // Создаем обертку для изображения
        const wrapper = document.createElement("div");
        wrapper.className = "ginzzzu-portrait-wrapper";
        wrapper.dataset.actorId = actorId;
        wrapper.dataset.rawName = rawName;
        wrapper.dataset.displayName = safeName;
        wrapper.dataset.src = img;  // Сохраняем src на wrapper для сравнения

        // позволяем кликать по портрету
        Object.assign(wrapper.style, {
          pointerEvents: "auto",
          transition: `transform ${_ANIM.moveMs}ms ${_ANIM.easing}`
        });
        wrapper.style.setProperty("--ginzzzu-flip-duration", `${Math.max(0, Number(_ANIM.moveMs) || 0)}ms`);
        wrapper.style.setProperty("--ginzzzu-flip-easing", _ANIM.easing || "ease-out");
        updatePortraitReorderCursor(wrapper, actorId);

        const nameMode = game.settings.get(MODULE_ID, "portraitNamesAlwaysVisible") || "hover";

        // Имя — только если оно не пустое и режим не "none"; badges live in names container
        if (safeName && nameMode !== "none") {
          try {
            const namesRoot = getDomHud();
            const namesContainer = namesRoot ? namesRoot.querySelector('#ginzzzu-portrait-names') : null;
            if (namesContainer) {
              removePortraitNameBadges(actorId, namesRoot);
              const nameBadge = document.createElement("div");
              nameBadge.className = "ginzzzu-portrait-name";
              nameBadge.dataset.actorId = actorId;
              const inner = document.createElement('span');
              inner.className = 'ginzzzu-portrait-name-inner';
              inner.textContent = safeName;
              nameBadge.appendChild(inner);
              namesContainer.appendChild(nameBadge);

              // Hover handlers on wrapper to show/hide badge
              wrapper.addEventListener('mouseenter', () => {
                nameBadge.classList.add('visible');
              }, { passive: true });
              wrapper.addEventListener('mouseleave', () => {
                const rootEl = getDomHud();
                if (rootEl && rootEl.classList.contains('ginzzzu-show-names-always')) return;
                nameBadge.classList.remove('visible');
              }, { passive: true });
            }
          } catch (e) {}
        }

        wrapper.appendChild(el);


    // Базовые стили: рамка фикс. размера; картинка вписывается; плавное появление и «подъём»
    const visualNovelMode = game.settings.get(MODULE_ID, "visualNovelMode");
    applyPortraitImageBox(el, {
      filter: "drop-shadow(0 12px 30px rgba(0,0,0,0.6)) brightness(var(--tone-brightness,1)) contrast(var(--tone-contrast,1)) saturate(var(--tone-saturate,1)) hue-rotate(var(--tone-blue-pre-hue,0deg)) sepia(var(--tone-blue-tint,0)) hue-rotate(var(--tone-blue-post-hue,0deg))",
      transition: `opacity ${_ANIM.fadeMs}ms ${_ANIM.easing}, transform ${_ANIM.moveMs}ms ${_ANIM.easing}, filter var(--tone-filter-transition, ${_ANIM.moveMs}ms ${_ANIM.easing})`,
      pointerEvents: "none",
      opacity: "0",
      transform: visualNovelMode ? PORTRAIT_IMG_ANCHOR : `${PORTRAIT_IMG_ANCHOR} translateY(12px)`,
      ...(visualNovelMode ? {} : { borderRadius: "10px" })
    });
    el.dataset.baseTransform = PORTRAIT_IMG_ANCHOR;
    // Сохраняем базовый filter, чтобы при фокусе/дефокусе можно было вернуться
    el.dataset.baseFilter = el.style.filter || "";

    // начальное состояние флипа:
    // 1) пробуем взять из флагов актёра (как в системе ThreeO)
    // 2) если нет — читаем старый флаг сцены (для совместимости)
    try {
      el.dataset.flipped = getCastItem(actorId)?.flip ? "1" : "0";
    } catch (e) {
      el.dataset.flipped = el.dataset.flipped || "0";
    }

    wrapper.addEventListener("auxclick", _onPortraitAuxClick);
    wrapper.addEventListener("contextmenu", _onPortraitClick);
    wrapper.addEventListener("click", _onPortraitActionModifierClick);
    wrapper.addEventListener("dblclick", _onPortraitDoubleClick);
    wrapper.addEventListener("pointerdown", _onPortraitPointerDown);
    wrapper.addEventListener("dragstart", ev => ev.preventDefault());

    wrapper.appendChild(el);
    for (const extra of getPortraitWrappers(actorId, root)) extra.remove();
    insertPortraitWrapperBySharedOrder(rail, wrapper);
    map.set(actorId, el);
    setPortraitManualZIndex(actorId, null, { root });
    applyPortraitManualTransform(actorId, getPortraitManualTransform(actorId), { root, scheduleNames: false });

    // === Подключение панели эмоций к HUD-портрету ===
    if (globalThis.GinzzzuPortraitEmotions?.attachToolbarToHudWrapper) {
      globalThis.GinzzzuPortraitEmotions.attachToolbarToHudWrapper(wrapper, actorId);
    }

    // Перераскладка с учётом нового (FLIP для остальных)
    if (relayout) relayoutDomHud(firstRects);
    // Ensure badges are positioned after layout
    requestAnimationFrame(() => updateNamePositions());

    // Apply blur effect if enabled
    applyBlur();

    if (visualNovelMode) {
      // Ждем полной загрузки изображения в DOM перед анимацией
      el.onload = () => {
        requestAnimationFrame(() => {
          el.style.opacity = "1";
          el.style.transform = PORTRAIT_IMG_ANCHOR;
          el.dataset.baseTransform = PORTRAIT_IMG_ANCHOR;
          _updateImgTransformForFlip(el);
        });
      };
    } else {
      // Ждем полной загрузки изображения в DOM перед анимацией
      el.onload = () => {
        requestAnimationFrame(() => {
          el.style.opacity = "1";
          el.style.transform = PORTRAIT_IMG_ANCHOR;
          el.dataset.baseTransform = PORTRAIT_IMG_ANCHOR;
          _updateImgTransformForFlip(el);
        });
      };
    }

    const revealPortrait = el.onload;
    let revealStarted = false;
    el.onload = () => {
      if (revealStarted) return;
      revealStarted = true;
      revealPortrait?.();
    };
    el.onerror = el.onload;
    if (el.complete) el.onload();
  }

  // Скрытие одного портрета и отключение эмоций (удаление DOM + FLIP остальных)
  function closeLocalPortrait(actorId) {
    const map = domStore();
    const el = map.get(actorId);
    const root = getDomHud();
    const wrappers = getPortraitWrappers(actorId, root);
    if (el) {
      const mapped = el.closest(".ginzzzu-portrait-wrapper");
      if (mapped && !wrappers.includes(mapped)) wrappers.push(mapped);
    }
    if (!el && !wrappers.length) return;
    if (wrappers.some(wrapper => wrapper.dataset.threeoPortraitClosing === "1")) return;

    beginPortraitOpen(actorId);

    for (const wrapper of wrappers) {
      wrapper.dataset.threeoPortraitClosing = "1";
      wrapper.dataset.threeoEmotionTransitionToken = `closing:${Date.now()}:${Math.random()}`;
    }

    if (_focusedActorId === actorId) {
      setPortraitFocusByActorId(null);
    }

    const closingImages = wrappers.length
      ? wrappers.flatMap(wrapper => Array.from(wrapper.querySelectorAll("img.ginzzzu-portrait")))
      : (el ? [el] : []);
    for (const image of closingImages) {
      image.style.transform = `${PORTRAIT_IMG_ANCHOR} translateY(12px)`;
      image.style.opacity = "0";
    }

    const timeout = Math.max(_ANIM.fadeMs, _ANIM.moveMs) + 80;
    setTimeout(() => {
      const live = wrappers.filter(wrapper => wrapper.isConnected);
      if (!live.length && !el?.isConnected) {
        map.delete(actorId);
        removePortraitLayer(actorId);
        return;
      }

      // FIRST прямо перед удалением: ряд ещё занимает место уходящего, остальные не прыгнули.
      const firstRects = collectFirstRects();
      try {
        for (const wrapper of live) wrapper.remove();
        if (!live.length && el?.isConnected) el.remove();
      } catch {}
      try { removePortraitNameBadges(actorId, root); } catch (e) {}
      const currentEl = map.get(actorId);
      const removedCurrentPortrait = !currentEl || currentEl === el || live.some(wrapper => wrapper.contains(currentEl));
      if (removedCurrentPortrait) {
        map.delete(actorId);
        removePortraitLayer(actorId);
      }
      relayoutDomHud(firstRects);
      removeBlur();
    }, timeout);
  }

  async function _applyEmotionImageWithTransition(wrapper, imgEl, newSrc) {
      if (!wrapper || !imgEl || !newSrc || wrapper.dataset.threeoPortraitClosing === "1") return;

      const duration = Number(game.settings.get(MODULE_ID, "emotionImageTransitionMs")) || 0;
      const lockKey = "threeoEmotionTransitionToken";
      const token = String(Date.now()) + ":" + Math.random();
      wrapper.dataset[lockKey] = token;
      const loadTimeoutMs = Math.max(8000, Math.min(20000, duration + 8000));

      let preparedImg = null;
      try {
        preparedImg = await _loadDecodedImageElement(newSrc, loadTimeoutMs);
      } catch (e) {
        console.warn("[threeO-portraits] preload failed for emotion image", newSrc, e);
        if (wrapper.dataset[lockKey] === token) delete wrapper.dataset[lockKey];
        return;
      }

      if (wrapper.dataset[lockKey] !== token || !imgEl.isConnected) return;

      // If no transition requested, replace only after the new decoded element is ready.
      if (!duration) {
        _copyPortraitImageState(imgEl, preparedImg, newSrc);
        await nextAnimationFrame();
        if (wrapper.dataset[lockKey] !== token || !imgEl.isConnected) return;
        let activeImg = preparedImg;
        try {
          imgEl.replaceWith(preparedImg);
        } catch {
          imgEl.src = newSrc;
          imgEl.dataset.src = newSrc;
          activeImg = imgEl;
        }
        const actorIdForMap = preparedImg.dataset.actorId || imgEl.dataset.actorId;
        if (actorIdForMap) domStore().set(actorIdForMap, activeImg);
        if (wrapper.dataset[lockKey] === token) delete wrapper.dataset[lockKey];
        return;
      }

      const half = Math.max(1, Math.floor(duration / 2));

      // Preserve inline transition & transform so we can restore them later
      const prevTransition = imgEl.style.transition || "";
      const prevTransform = imgEl.style.transform || "";
      const prevOpacity = imgEl.style.opacity || "";
      // Ensure we add opacity + transform transitions without removing other transitions
      const opacityTransition = `opacity ${half}ms ${_ANIM.easing}`;
      const transformTransition = `transform ${half}ms ${_ANIM.easing}`;
      imgEl.style.transition = prevTransition ? `${prevTransition}, ${opacityTransition}, ${transformTransition}` : `${opacityTransition}, ${transformTransition}`;

      // Ensure will-change set for smoother animation (minimal touch)
      const prevWillChange = imgEl.style.willChange || "";
      try { imgEl.style.willChange = prevWillChange ? `${prevWillChange}, opacity, transform` : "opacity, transform"; } catch (e) {}

      // Helper: wait for opacity transition or timeout
      const awaitOpacity = (timeoutMs) => new Promise((resolve) => {
        let done = false;
        const onEnd = (ev) => {
          if (ev && ev.propertyName && ev.propertyName !== "opacity") return;
          if (done) return;
          done = true;
          clearTimeout(timer);
          imgEl.removeEventListener("transitionend", onEnd);
          resolve();
        };
        imgEl.addEventListener("transitionend", onEnd);
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          imgEl.removeEventListener("transitionend", onEnd);
          resolve();
        }, timeoutMs + 50);
      });

      // Start fade-out
      // If opacity is not explicitly set, compute current computed value then set it inline to ensure transition works
      try {
        const comp = window.getComputedStyle(imgEl).opacity;
        imgEl.style.opacity = comp ?? "1";
      } catch (e) {}

      // Compose a subtle "pose" transform for fade-out so the character appears to shift/pose
      let baseTransform = imgEl.dataset.baseTransform || getComputedStyle(imgEl).transform || "none";
      const extraOut = "translate3d(0,-6px,0) scale(1.03)";
      const composedOut = baseTransform && baseTransform !== "none" ? `${baseTransform} ${extraOut}` : extraOut;

      // Trigger paint then change opacity + transform to start fade-out pose
      await new Promise((r) => requestAnimationFrame(r));
      imgEl.style.transform = composedOut;
      imgEl.style.opacity = "0";

      // Wait for fade-out to complete
      await awaitOpacity(half + 20);

      // If another transition started or the portrait was rebuilt meanwhile, abort to avoid stomping it
      if (wrapper.dataset[lockKey] !== token || !imgEl.isConnected) {
        // Do not make an image visible again while its portrait is closing.
        if (wrapper.dataset.threeoPortraitClosing !== "1") {
          imgEl.style.transition = prevTransition;
          imgEl.style.transform = prevTransform;
          if (prevOpacity) imgEl.style.opacity = prevOpacity;
          else imgEl.style.removeProperty("opacity");
          try { imgEl.style.willChange = prevWillChange; } catch (e) {}
        }
        return;
      }

      // Instead of swapping src on the same <img> (which on some clients briefly shows
      // the new image before the fade-out completes), create an overlay image and
      // cross-fade it in. This keeps the old image visible during out-animation.
      const actorIdForMap = imgEl.dataset.actorId;
      const map = domStore();

      // Use the already decoded off-DOM image as the overlay, avoiding a second src load.
      const newImgEl = preparedImg;
      _copyPortraitImageState(imgEl, newImgEl, newSrc);
      // start hidden
      newImgEl.style.opacity = "0";
      newImgEl.style.pointerEvents = "none";
      newImgEl.style.willChange = "transform, opacity";

      // Insert overlay right after the current image so positioning/stacking stays consistent
      try {
        imgEl.parentElement.insertBefore(newImgEl, imgEl.nextSibling);
      } catch (e) {
        imgEl.parentElement.appendChild(newImgEl);
      }

      // Ensure the new element uses the same transition settings we just prepared
      newImgEl.style.transition = imgEl.style.transition || prevTransition;

      // Helper to await opacity transition on arbitrary element
      const awaitOpacityOn = (el, timeoutMs) => new Promise((resolve) => {
        let done = false;
        const onEnd = (ev) => {
          if (ev && ev.propertyName && ev.propertyName !== "opacity") return;
          if (done) return;
          done = true;
          clearTimeout(timer);
          el.removeEventListener("transitionend", onEnd);
          resolve();
        };
        el.addEventListener("transitionend", onEnd);
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          el.removeEventListener("transitionend", onEnd);
          resolve();
        }, timeoutMs + 50);
      });

      // Let the browser commit the hidden overlay before starting its transition.
      await nextAnimationFrame();
      await nextAnimationFrame();

      if (wrapper.dataset[lockKey] !== token) {
        try { newImgEl.remove(); } catch (e) {}
        if (wrapper.dataset.threeoPortraitClosing !== "1") {
          imgEl.style.transition = prevTransition;
          imgEl.style.transform = prevTransform;
          if (prevOpacity) imgEl.style.opacity = prevOpacity;
          else imgEl.style.removeProperty("opacity");
          try { imgEl.style.willChange = prevWillChange; } catch (e) {}
        }
        return;
      }

      // For fade-in, use a slightly different 'settle' pose so it looks like a changed stance
      const extraIn = "translate3d(0,6px,0) scale(0.985)";
      const composedIn = baseTransform && baseTransform !== "none" ? `${baseTransform} ${extraIn}` : extraIn;

      // Fade in overlay while keeping the old image faded-out.
      newImgEl.style.transform = composedIn;
      newImgEl.style.opacity = "1";

      // Wait for fade-in to complete on the overlay
      await awaitOpacityOn(newImgEl, half + 20);

      if (wrapper.dataset[lockKey] !== token) {
        try { newImgEl.remove(); } catch (e) {}
        if (wrapper.dataset.threeoPortraitClosing !== "1") {
          imgEl.style.transition = prevTransition;
          imgEl.style.transform = prevTransform;
          if (prevOpacity) imgEl.style.opacity = prevOpacity;
          else imgEl.style.removeProperty("opacity");
          try { imgEl.style.willChange = prevWillChange; } catch (e) {}
        }
        return;
      }

      // Replace map entry and remove old element
      try {
        imgEl.remove();
      } catch (e) {}
      if (actorIdForMap) map.set(actorIdForMap, newImgEl);

      // Restore transition/will-change on the new element
      newImgEl.style.transition = prevTransition;
      try { newImgEl.style.willChange = prevWillChange; } catch (e) {}

      // Restore prior transform after a tiny delay to avoid abruptly snapping
      setTimeout(() => {
        try { newImgEl.style.transform = prevTransform; } catch (e) {}
      }, 20);

      // Clear lock token
      if (wrapper.dataset[lockKey] === token) delete wrapper.dataset[lockKey];
    }

  // ---- Реакция всех клиентов на смену флага актёра ----
  let hudSyncChain = Promise.resolve();
  let hudSyncQueued = false;

  function requestHudSync() {
    if (hudSyncQueued) return hudSyncChain;
    hudSyncQueued = true;
    hudSyncChain = hudSyncChain
      .then(async () => {
        hudSyncQueued = false;
        await syncHudFromCast();
      })
      .catch(err => {
        hudSyncQueued = false;
        console.error("[threeO-portraits] HUD sync failed:", err);
      });
    return hudSyncChain;
  }

  async function syncHudFromCast() {
    try {
      if (game.settings.get(MODULE_ID, "hidePortraits")) {
        closeAllLocalPortraits();
        return;
      }
    } catch {}
    if (!isTheatreStage()) {
      closeAllLocalPortraits();
      return;
    }

    const cast = getCast();
    const desired = getShownPersonaIds();
    const desiredSet = new Set(desired);
    const current = getActivePortraits();
    const toClose = current.filter(id => !desiredSet.has(id));
    const closing = toClose.length > 0;

    const portraitHeightSignature = (persona, item) => {
      const base = Number(persona?.portraitHeightMultiplier);
      const emotion = getEmotionHeightMultiplier(persona, item);
      return `${Number.isFinite(base) ? base : 1}:${emotion}`;
    };

    let willInsert = false;
    let heightChanged = false;
    for (const item of cast) {
      const persona = getPersona(item.personaId);
      if (!persona) continue;
      const wrappers = getPortraitWrappers(persona.id);
      const wrapper = wrappers.find(node => node.dataset.threeoPortraitClosing !== "1") || null;
      const img = getPersonaImage(persona, item);
      if (!wrapper || wrapper.dataset.src !== img) willInsert = true;
      else if (wrapper.dataset.tomHeightSig && wrapper.dataset.tomHeightSig !== portraitHeightSignature(persona, item)) {
        heightChanged = true;
      }
    }

    const liveRailIds = () => {
      const root = getDomHud();
      const rail = root?.querySelector("#ginzzzu-portrait-rail") || root;
      if (!rail) return [];
      return Array.from(rail.querySelectorAll(".ginzzzu-portrait-wrapper"))
        .filter(wrapper => wrapper.dataset.threeoPortraitClosing !== "1")
        .map(wrapper => wrapper.dataset.actorId);
    };

    const wantedIds = cast.map(item => item.personaId).filter(id => desiredSet.has(id));
    const railIds = liveRailIds();
    const orderMismatch = !closing
      && railIds.length === wantedIds.length
      && wantedIds.some((id, index) => railIds[index] !== id);

    const needsFlip = !closing && (willInsert || orderMismatch || heightChanged);
    const firstRects = needsFlip ? collectFirstRects() : null;

    for (const id of toClose) closeLocalPortrait(id);

    for (const item of cast) {
      const persona = getPersona(item.personaId);
      if (!persona) continue;
      await openLocalPortrait({
        actorId: persona.id,
        img: getPersonaImage(persona, item),
        name: getPersonaStageName(persona, item),
        relayout: false
      });
      const wrapper = getPortraitWrappers(persona.id).find(node => node.dataset.threeoPortraitClosing !== "1");
      if (wrapper) wrapper.dataset.tomHeightSig = portraitHeightSignature(persona, item);
      applyPortraitManualTransform(persona.id, manualTransformFromShared(item.transform), { animate: false });
      _setLocalFlipByActorId(persona.id, !!item.flip);
      globalThis.GinzzzuPortraitEmotions?.applyEmotionToHudDom?.(persona.id);
    }

    if (!closing) {
      const root = getDomHud();
      const rail = root?.querySelector("#ginzzzu-portrait-rail") || root;
      if (rail) {
        const wrappers = Array.from(rail.querySelectorAll(".ginzzzu-portrait-wrapper"))
          .filter(wrapper => wrapper.dataset.threeoPortraitClosing !== "1");
        const byActorId = new Map(wrappers.map(wrapper => [wrapper.dataset.actorId, wrapper]));
        const ordered = [];
        for (const item of cast) {
          const wrapper = byActorId.get(item.personaId);
          if (wrapper) ordered.push(wrapper);
        }
        for (const wrapper of wrappers) {
          if (!ordered.includes(wrapper)) ordered.push(wrapper);
        }
        if (ordered.some((wrapper, index) => wrappers[index] !== wrapper)) {
          for (const wrapper of ordered) rail.appendChild(wrapper);
        }
      }
    }

    if (!closing) {
      _focusedActorId = getFocusedPersonaId() || null;
      applyPortraitLayerOrder();
      _applyPortraitFocus();
    }

    if (needsFlip) relayoutDomHud(firstRects);
  }

  Hooks.on(CAST_CHANGED, () => requestHudSync());
  Hooks.on(PERSONAS_CHANGED, () => {
    if (!isTheatreStage()) return;
    for (const item of getCast()) {
      const persona = getPersona(item.personaId);
      if (!persona) continue;
      const wrapper = document.querySelector(`.ginzzzu-portrait-wrapper[data-actor-id="${persona.id}"]`);
      if (!wrapper) continue;
      const imgEl = wrapper.querySelector("img.ginzzzu-portrait");
      const nextImg = getPersonaImage(persona, item);
      if (imgEl && nextImg && wrapper.dataset.src !== nextImg) {
        wrapper.dataset.src = nextImg;
        _applyEmotionImageWithTransition(wrapper, imgEl, nextImg);
      }
      wrapper.dataset.rawName = persona.name || "";
      wrapper.dataset.displayName = getPersonaStageName(persona, item);
    }
    refreshPortraitDisplayNames();
    relayoutDomHud();
    applyPortraitBreathing();
  });

let portraitSocketHandlersRegistered = false;

function registerPortraitSocketHandlers() {
  if (portraitSocketHandlersRegistered || !game.socket) return;
  portraitSocketHandlersRegistered = true;

  game.socket.on(`module.${MODULE_ID}`, (data) => {
    if (!data) return;

    if (data.type === "portraitDragPreview") {
      applyRemotePortraitDragPreview(data);
      return;
    }

    if (data.type === "portraitManualTransform") {
      const actorId = String(data.actorId || "");
      const userId = String(data.userId || "");
      if (data.userId === game.user?.id) return;
      if (data.sceneId && data.sceneId !== canvas?.scene?.id) return;
      if (!actorId || !userId || !canUserReorderPortrait(actorId, userId)) return;

      if (Number.isFinite(Number(data.zIndex))) {
        setPortraitManualZIndex(actorId, Number(data.zIndex));
      }
      applyPortraitManualTransform(actorId, manualTransformFromShared(data.transform), {
        animate: !!data.animate
      });
    }
  });
}

Hooks.once("ready", async () => {
  registerPortraitSocketHandlers();

  try {
    if (game.settings.get(MODULE_ID, "hidePortraits")) {
      return;
    }

    registerPortraitAnimationActivityHandlers();
    await requestHudSync();
    _toneApplyToRootVars();
    setTimeout(() => relayoutDomHud(), 0);
  } catch (e) {
    console.error(e);
  }

  registerPortraitSocketHandlers();
});

  // Регистрация хукoв и слушателей, которые используют внутренние функции — внутри IIFE
  Hooks.on("canvasReady", () => {
    _toneApplyToRootVars();
    try {
      requestHudSync();
    } catch (e) {
      console.error("[threeO-portraits] canvasReady sync error:", e);
    }
  });

  Hooks.on("updateScene", (scene, diff) => {
    if (scene.id !== canvas?.scene?.id) return;

    if ("darkness" in diff || "environment" in diff) {
      _toneApplyToRootVars();
    }

    const modFlags = diff.flags?.[MODULE_ID];
    const castChanged = !!(
      (modFlags && Object.prototype.hasOwnProperty.call(modFlags, "cast")) ||
      foundry.utils.hasProperty(diff, `flags.${MODULE_ID}.cast`)
    );
    const focusChanged = !!(
      (modFlags && Object.prototype.hasOwnProperty.call(modFlags, "focusedPersonaId")) ||
      foundry.utils.hasProperty(diff, `flags.${MODULE_ID}.focusedPersonaId`)
    );
    if (castChanged) requestHudSync();
    else if (focusChanged) {
      setPortraitFocusByActorId(getFocusedPersonaId() || null);
    }
  });

  Hooks.on("lightingRefresh", _scheduleToneRefresh);

  // Перераскладка при изменении размера окна
  // Use a debounced handler so rapid resizes trigger a single relayout.
  let __threeo_portraits_resizeTimer = null;
  function _onWindowResizeDebounced() {
    if (__threeo_portraits_resizeTimer) clearTimeout(__threeo_portraits_resizeTimer);
    __threeo_portraits_resizeTimer = setTimeout(() => {
      try {
        const root = getDomHud();
        if (root) {
          const rail = root.querySelector("#ginzzzu-portrait-rail") || root;
          // Ensure padding accounts for current sidebar width before relayout
          syncSidePadding(root, rail);
        }
        // Re-apply adaptive tone vars (in case viewport change affects lighting perception)
        _toneApplyToRootVars();
        relayoutDomHud();
        // Stored positions are fractions of the screen: recalculate them for the new size.
        requestHudSync();
      } catch (e) {
        console.error("[threeO-portraits] resize handler error:", e);
      }
    }, 120);
  }
  window.addEventListener("resize", _onWindowResizeDebounced, { passive: true });
  Hooks.on("canvasReady", () => relayoutDomHud());
  Hooks.on("collapseSidebar", function(a, collapsed) {
    setTimeout(() => relayoutDomHud(), 500);
  });

  // ---- Тоггл из чарника ----
  async function togglePortrait(actorOrId) {
    if (!game.user?.isGM) return;
    const id = typeof actorOrId === "string" ? actorOrId : actorOrId?.id;
    if (!id) return;
    await togglePersona(id);
  }

  function getActorDisplayName(actorOrId) {
    const id = typeof actorOrId === "string" ? actorOrId : actorOrId?.id;
    return getPersonaStageName(getPersona(id), getCastItem(id));
  }


  function closeAllLocalPortraits() {
    const ids = Array.from(domStore().keys());
    ids.forEach(id => closeLocalPortrait(id));
  }

  function getActivePortraits() {
    const ids = Array.from(domStore().keys());
    return ids;
  }

  // === Blur Effect Management ===
  // Track timeout for blur removal to allow cancellation on rapid show/hide

  function applyBlur() {
    const root = getDomHud();
    if (!root) return;
    if (isPortraitUiHidden(root)) {
      clearPortraitBlur(root);
      return;
    }

    // Cancel any pending blur removal timeout
    if (_blurRemovalTimeout !== null) {
      clearTimeout(_blurRemovalTimeout);
      _blurRemovalTimeout = null;
    }

    const blurEnabled = game.settings.get(MODULE_ID, "portraitBlurEnabled");
    if (!blurEnabled) return;

    const blurStrength = Math.max(1, Math.min(30, Number(game.settings.get(MODULE_ID, "portraitBlurStrength")) || 8));
    const blurSpeed = Math.max(100, Math.min(2000, Number(game.settings.get(MODULE_ID, "portraitBlurSpeed")) || 400));

    root.style.setProperty("--ginzzzu-blur-strength-value", `${blurStrength}px`);
    root.style.setProperty("--ginzzzu-blur-speed-value", `${blurSpeed}ms`);
    root.classList.add("ginzzzu-portrait-blur-active");
  }

  function removeBlur() {
    const root = getDomHud();
    if (!root) return;
    if (isPortraitUiHidden(root)) {
      clearPortraitBlur(root);
      return;
    }

    // Check if there are any active portraits left
    const activePortraits = getActivePortraits();
    if (activePortraits.length > 0) {
      // Still have portraits, keep blur
      return;
    }

    // Cancel any pending removal timeout to avoid conflicts
    if (_blurRemovalTimeout !== null) {
      clearTimeout(_blurRemovalTimeout);
      _blurRemovalTimeout = null;
    }

    // Smoothly transition blur back to 0px
    root.style.setProperty("--ginzzzu-blur-strength-value", "0px");

    // Remove class after transition completes to reset everything
    const blurSpeed = Math.max(100, Math.min(2000, Number(game.settings.get(MODULE_ID, "portraitBlurSpeed")) || 400));
    _blurRemovalTimeout = setTimeout(() => {
      root.classList.remove("ginzzzu-portrait-blur-active");
      root.style.removeProperty("--ginzzzu-blur-strength-value");
      root.style.removeProperty("--ginzzzu-blur-speed-value");
      _blurRemovalTimeout = null;
    }, blurSpeed);
  }

  // Экспорт
  globalThis.GinzzzuPortraits = {
  togglePortrait,
  configurePortrait,
  getActorDisplayName,
  preloadPortraitImage: (src) => {
    if (typeof src !== "string" || !src.trim()) return;
    _preloadImage(src.trim(), 10000).catch(() => {});
  },
  closeAllLocalPortraits,
  getActivePortraits,
  applyPortraitBreathing
  };


function normalizePortraitSequence(sequence) {
  if (!Array.isArray(sequence)) return [];

  const seen = new Set();
  const normalized = [];

  for (const actorId of sequence) {
    const id = String(actorId || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

function getSharedPortraitSequence() {
  try {
    return normalizePortraitSequence(getCast().map(item => item.personaId));
  } catch (e) {
    return [];
  }
}

function getCurrentPortraitSequence() {
  const root = getDomHud();
  if (!root) return [];

  const rail = getPortraitRail(root);
  const imgs = Array.from(rail.querySelectorAll("img.ginzzzu-portrait"));

  return normalizePortraitSequence(imgs.map(img => img.dataset.actorId).filter(Boolean));
}

function getShownPortraitActorIds() {
  return getShownPersonaIds();
}

function sanitizeSharedPortraitSequence(sequence) {
  const current = getCurrentPortraitSequence();
  const allowedIds = new Set([...getShownPortraitActorIds(), ...current]);
  const sanitized = normalizePortraitSequence(sequence).filter(actorId => allowedIds.has(actorId));

  for (const actorId of current) {
    if (!sanitized.includes(actorId)) sanitized.push(actorId);
  }

  return sanitized;
}

function applySharedPortraitSequence(sequence = getSharedPortraitSequence(), { animate = true } = {}) {
  const normalized = normalizePortraitSequence(sequence);

  const root = getDomHud();
  if (!root || !normalized.length) return false;

  if (activePortraitDrag) {
    pendingSharedPortraitSequence = normalized;
    return false;
  }

  const rail = getPortraitRail(root);
  if (!rail) return false;

  const wrappers = Array.from(rail.querySelectorAll(".ginzzzu-portrait-wrapper"));
  if (!wrappers.length) return false;

  const byActorId = new Map(wrappers.map(wrapper => [wrapper.dataset.actorId, wrapper]));
  const ordered = normalized
    .map(actorId => byActorId.get(actorId))
    .filter(Boolean);

  const orderedSet = new Set(ordered);
  for (const wrapper of wrappers) {
    if (!orderedSet.has(wrapper)) ordered.push(wrapper);
  }

  const changed = ordered.some((wrapper, index) => wrappers[index] !== wrapper);
  if (!changed) {
    const pendingSwapStates = preparePendingRemoteSwapDragsForSequence(ordered);
    finishPendingRemoteSwapDragsAfterSequence(pendingSwapStates);
    applyPortraitLayerOrder({ root });
    scheduleNamePositionsUpdate();
    return false;
  }

  const firstRects = animate ? collectFirstRects() : null;
  const pendingSwapStates = preparePendingRemoteSwapDragsForSequence(ordered);
  for (const wrapper of ordered) {
    rail.appendChild(wrapper);
  }

  if (animate) relayoutDomHud(firstRects);
  else relayoutDomHud();

  finishPendingRemoteSwapDragsAfterSequence(pendingSwapStates);

  scheduleNamePositionsUpdate();
  return true;
}

function setSharedPortraitSequence(sequence) {
  if (!game.user?.isGM) return;

  const sanitized = sanitizeSharedPortraitSequence(sequence);
  if (JSON.stringify(sanitized) === JSON.stringify(getSharedPortraitSequence())) return;

  reorderCast(sanitized).catch(e => {
    console.error("[threeO-portraits] setSharedPortraitSequence error:", e);
  });
}

function setSyncedPortraitManualTransform(actorId, transform, {
  applyLocal = false,
  animate = false,
  zIndex = null
} = {}) {
  const id = String(actorId || "").trim();
  if (!id) return;
  if (!canUserReorderPortrait(id)) return;

  const normalized = normalizePortraitManualTransform(transform);

  if (applyLocal) {
    if (Number.isFinite(Number(zIndex))) setPortraitManualZIndex(id, Number(zIndex));
    applyPortraitManualTransform(id, normalized, { animate });
  }

  const shared = manualTransformToShared(normalized);

  try {
    game.socket?.emit?.(`module.${MODULE_ID}`, {
      type: "portraitManualTransform",
      actorId: id,
      userId: game.user?.id,
      sceneId: canvas?.scene?.id,
      transform: shared,
      animate: !!animate,
      zIndex: Number.isFinite(Number(zIndex)) ? Number(zIndex) : null
    });
  } catch (e) {
    console.error("[threeO-portraits] portrait transform socket emit failed:", e);
  }

  setCastTransform(id, shared).catch(e => {
    console.error("[threeO-portraits] setCastTransform error:", e);
  });
}

Hooks.once("ready", () => {
  requestAnimationFrame(() => applySharedPortraitSequence(getSharedPortraitSequence(), { animate: false }));
});

})();
