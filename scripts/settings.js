import { MODULE_ID } from "./core/constants.js";
import { applyDisplayFont, displayFontChoices } from "./features/displayFont.js";
import { refreshLocationTitle } from "./features/locations/title.js";

const SETTINGS_GROUPS = [
  {
    id: "quick",
    keys: [
      "hidePortraits",
      "effectsCalm"
    ]
  },
  {
    id: "performance",
    keys: [
      "performanceMode"
    ]
  },
  {
    id: "npcDock",
    gmOnly: true,
    keys: [
      "showActivePortraits",
      "npcDockWidth",
      "npcDockRows"
    ]
  },
  {
    id: "portraitLayout",
    keys: [
      "visualNovelMode",
      "resizeToFit",
      "adjustForSidebar",
      "gmForcePortraitHeight",
      "gmPortraitHeight",
      "portraitHeight",
      "portraitBottomOffset",
      "portraitNamesAlwaysVisible",
      "portraitNameVertical",
      "portraitNameFontSize"
    ]
  },
  {
    id: "typography",
    keys: [
      "displayFont",
      "displayFontCustom",
      "locationTitleTopOffset"
    ]
  },
  {
    id: "portraitVisuals",
    keys: [
      "portraitToneEnabled",
      "portraitToneStrength",
      "portraitFocusHighlightStrength",
      "portraitShadowDimStrength",
      "portraitBreathingEnabled",
      "portraitBreathingStrength",
      "portraitBreathingDurationMs",
      "portraitBlurEnabled",
      "portraitBlurStrength",
      "portraitBlurSpeed",
      "portraitFocusBlurEnabled",
      "portraitFocusBlurStrength",
      "portraitFocusPortraitBlurEnabled",
      "portraitFocusPortraitBlurStrength",
      "portraitFadeMs",
      "portraitMoveMs",
      "portraitDragAnimate",
      "portraitDragResetOnRelease",
      "portraitDragMinScale",
      "portraitDragMaxScale",
      "portraitDragMinTiltDeg",
      "portraitDragMaxTiltDeg",
      "portraitEasing"
    ]
  },
  {
    id: "access",
    keys: [
      "portraitUIToggleVisibility"
    ]
  },
  {
    id: "emotions",
    keys: [
      "emotionPanelVisibility",
      "emotionPanelScale",
      "emotionPanelPosition",
      "emotionColorIntensity",
      "emotionImageTransitionMs"
    ]
  }
];

function escapeAttributeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getRenderedSettingsElement(app, htmlOrElement) {
  if (htmlOrElement?.jquery) return htmlOrElement[0];
  if (htmlOrElement instanceof HTMLElement) return htmlOrElement;
  if (app?.element?.jquery) return app.element[0];
  if (app?.element instanceof HTMLElement) return app.element;
  return null;
}

function getSettingOrMenuConfig(key) {
  const fullKey = `${MODULE_ID}.${key}`;
  return game.settings?.settings?.get(fullKey) ?? game.settings?.menus?.get(fullKey) ?? null;
}

function findSettingsRow(root, key) {
  const fullKey = `${MODULE_ID}.${key}`;
  const escapedFullKey = escapeAttributeValue(fullKey);
  const target = root.querySelector([
    `[name="${escapedFullKey}"]`,
    `[id="${escapedFullKey}"]`,
    `[data-key="${escapedFullKey}"]`,
    `[data-setting="${escapedFullKey}"]`,
    `[data-setting-key="${escapedFullKey}"]`,
    `[data-setting-id="${escapedFullKey}"]`
  ].join(","));

  if (target) return target.closest(".form-group, .form-group-stacked, li, .setting") ?? target.parentElement;

  const config = getSettingOrMenuConfig(key);
  const labels = [config?.name, config?.label].filter(Boolean).map(String);
  if (!labels.length) return null;

  for (const row of root.querySelectorAll(".form-group, .form-group-stacked, li, .setting")) {
    const text = row.textContent || "";
    if (labels.some(label => text.includes(label))) return row;
  }

  return null;
}

function makeSettingsGroupHeader(groupId) {
  const header = document.createElement("div");
  header.className = "ginzzzu-settings-heading";
  header.dataset.groupId = groupId;

  const title = document.createElement("h3");
  title.textContent = game.i18n.localize(`GINZZZUPORTRAITS.SettingsGroups.${groupId}.title`);
  header.appendChild(title);

  const hint = game.i18n.localize(`GINZZZUPORTRAITS.SettingsGroups.${groupId}.hint`);
  if (hint && !hint.startsWith("GINZZZUPORTRAITS.")) {
    const description = document.createElement("p");
    description.textContent = hint;
    header.appendChild(description);
  }

  return header;
}

function organizeModuleSettingsConfig(app, htmlOrElement) {
  const root = getRenderedSettingsElement(app, htmlOrElement);
  if (!root) return;

  const allRows = SETTINGS_GROUPS
    .flatMap(group => group.keys)
    .map(key => findSettingsRow(root, key))
    .filter(Boolean);
  if (!allRows.length) return;

  for (const header of root.querySelectorAll(".ginzzzu-settings-heading")) {
    header.remove();
  }

  for (const group of SETTINGS_GROUPS) {
    const rows = group.keys
      .map(key => findSettingsRow(root, key))
      .filter(Boolean);
    if (!rows.length) continue;

    // The dock exists only for the GM, so its client settings mean nothing to players.
    if (group.gmOnly && !game.user?.isGM) {
      for (const row of rows) row.remove();
      continue;
    }

    const container = rows[0].parentElement;
    if (!container) continue;

    const header = makeSettingsGroupHeader(group.id);
    container.insertBefore(header, rows[0]);

    let marker = header;
    for (const row of rows) {
      if (row.parentElement !== container) continue;
      marker.after(row);
      marker = row;
    }
  }
}

function scheduleOrganizeModuleSettingsConfig(app, htmlOrElement) {
  window.setTimeout(() => organizeModuleSettingsConfig(app, htmlOrElement), 0);
}

// Settings for ginzzzu-portraits
Hooks.once("init", () => {
  // Helper to register
  const reg = (key, data) => game.settings.register(MODULE_ID, key, data);

  // === Hide Portraits for Client (клиент / Client) ===
  reg("hidePortraits", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.hidePortraits.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.hidePortraits.hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true
  });

  reg("performanceMode", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.performanceMode.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.performanceMode.hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true
  });

  reg("gmForcePortraitHeight", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.gmForcePortraitHeight.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.gmForcePortraitHeight.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  reg("gmPortraitHeight", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.gmPortraitHeight.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.gmPortraitHeight.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 0.8,
    range: { min: 0, max: 1, step: 0.01 },
    requiresReload: true
  });

  reg("portraitHeight", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitHeight.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitHeight.hint"),
    scope: "client",
    config: true,
    type: Number,
    default: 0.8,
    range: { min: 0, max: 1, step: 0.01 },
    requiresReload: true
  });

  reg("portraitBottomOffset", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitBottomOffset.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitBottomOffset.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 0,                    // отступ снизу в пикселях
    range: { min: 0, max: 800, step: 1 },
    requiresReload: true
  });

  reg("portraitNameVertical", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitNameVertical.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitNameVertical.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 50,              // по умолчанию середина
    range: { min: 0, max: 100, step: 1 },
    requiresReload: true
  });

  reg("portraitNameFontSize", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitNameFontSize.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitNameFontSize.hint"),
    scope: "client",
    config: true,
    type: Number,
    default: 25,
    range: { min: 10, max: 60, step: 1 },
    requiresReload: true
  });

  reg("portraitNamesAlwaysVisible", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitNamesAlwaysVisible.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitNamesAlwaysVisible.hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      none:  game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitNamesAlwaysVisible.option.none"),
      hover: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitNamesAlwaysVisible.option.hover"),
      always: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitNamesAlwaysVisible.option.always")
    },
    default: "hover",
    requiresReload: true
  });

  reg("displayFont", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.displayFont.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.displayFont.hint"),
    scope: "world",
    config: true,
    type: String,
    choices: displayFontChoices(),
    default: "cormorant",
    requiresReload: false,
    onChange: () => applyDisplayFont()
  });

  reg("displayFontCustom", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.displayFontCustom.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.displayFontCustom.hint"),
    scope: "world",
    config: true,
    type: String,
    default: "",
    requiresReload: false,
    onChange: () => applyDisplayFont()
  });

  reg("locationTitleTopOffset", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.locationTitleTopOffset.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.locationTitleTopOffset.hint"),
    scope: "client",
    config: true,
    type: Number,
    default: 48,
    range: { min: 0, max: 600, step: 1 },
    requiresReload: false,
    onChange: () => refreshLocationTitle()
  });

    // === Тон портретов в зависимости от темноты сцены (клиент / Client) ===
  reg("visualNovelMode", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.visualNovelMode.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.visualNovelMode.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  // === Тон портретов в зависимости от темноты сцены (клиент / Client) ===
  reg("resizeToFit", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.resizeToFit.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.resizeToFit.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  reg("adjustForSidebar", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.adjustForSidebar.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.adjustForSidebar.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

    // Show/hide active portrait mini-dock (client setting)
  reg("showActivePortraits", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.showActivePortraits.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.showActivePortraits.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  reg("portraitToneEnabled", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitToneEnabled.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitToneEnabled.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  reg("portraitToneStrength", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitToneStrength.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitToneStrength.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 0.6,
    range: { min: 0, max: 1, step: 0.05 },
    requiresReload: true
  });

    reg("portraitFocusHighlightStrength", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitFocusHighlightStrength.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitFocusHighlightStrength.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 0.5,
    range: { min: 0, max: 1, step: 0.05 },
    requiresReload: true
  });

  reg("portraitShadowDimStrength", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitShadowDimStrength.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitShadowDimStrength.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 0.5,
    range: { min: 0, max: 1, step: 0.05 },
    requiresReload: true
  });

  reg("portraitBreathingEnabled", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitBreathingEnabled.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitBreathingEnabled.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
    onChange: () => globalThis.GinzzzuPortraits?.applyPortraitBreathing?.()
  });

  reg("portraitBreathingStrength", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitBreathingStrength.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitBreathingStrength.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 0.5,
    range: { min: 0, max: 1.5, step: 0.05 },
    requiresReload: false,
    onChange: () => globalThis.GinzzzuPortraits?.applyPortraitBreathing?.()
  });

  reg("portraitBreathingDurationMs", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitBreathingDurationMs.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitBreathingDurationMs.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 10000,
    range: { min: 2000, max: 20000, step: 100 },
    requiresReload: false,
    onChange: () => globalThis.GinzzzuPortraits?.applyPortraitBreathing?.()
  });

  // === Панель эмоций на портретах ===
  reg("emotionPanelVisibility", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.emotionPanelVisibility.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.emotionPanelVisibility.hint"),
    scope: "world",
    config: true,
    type: String,
    // "gm" goes first: a world that still stores the removed "all" value shows it as selected.
    choices: {
      gm:   game.i18n.localize("GINZZZUPORTRAITS.Settings.emotionPanelVisibility.gm"),
      none: game.i18n.localize("GINZZZUPORTRAITS.Settings.emotionPanelVisibility.none")
    },
    default: "gm",
    requiresReload: true
  });

  // === Portrait UI Toggle Button Visibility ===
  reg("portraitUIToggleVisibility", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitUIToggleVisibility.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitUIToggleVisibility.hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      all: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitUIToggleVisibility.all"),
      players: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitUIToggleVisibility.players"),
      gm: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitUIToggleVisibility.gm"),
      none: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitUIToggleVisibility.none")
    },
    default: "all",
    requiresReload: true
  });

  reg("emotionPanelScale", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.emotionPanelScale.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.emotionPanelScale.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 1,
    range: { min: 0.6, max: 1.6, step: 0.05 },
    requiresReload: true
  });

  reg("emotionPanelPosition", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.emotionPanelPosition.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.emotionPanelPosition.hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      top:   game.i18n.localize("GINZZZUPORTRAITS.Settings.emotionPanelPosition.top"),
      left:  game.i18n.localize("GINZZZUPORTRAITS.Settings.emotionPanelPosition.left"),
      right: game.i18n.localize("GINZZZUPORTRAITS.Settings.emotionPanelPosition.right")
    },
    default: "top",
    requiresReload: true
  });

  // === Интенсивность цветовых изменений от эмоций (клиент) ===
  reg("emotionColorIntensity", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.emotionColorIntensity.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.emotionColorIntensity.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 1,
    range: { min: 0, max: 1, step: 0.01 },
    requiresReload: false
  });

  // === Скорость анимации смены изображения при эмоциях (мс, клиент) ===
  reg("emotionImageTransitionMs", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.emotionImageTransitionMs.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.emotionImageTransitionMs.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 320,
    range: { min: 0, max: 2000, step: 10 },
    requiresReload: false
  });

  // === Портреты: анимация (мир / World) ===
  reg("portraitFadeMs", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitFadeMs.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitFadeMs.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 300,
    range: { min: 0, max: 2000, step: 50 },
    requiresReload: true
  });

  reg("portraitMoveMs", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitMoveMs.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitMoveMs.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 450,
    range: { min: 0, max: 2000, step: 50 },
    requiresReload: true
  });

  reg("portraitDragAnimate", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitDragAnimate.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitDragAnimate.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false
  });

  reg("portraitDragResetOnRelease", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitDragResetOnRelease.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitDragResetOnRelease.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false
  });

  reg("portraitDragMinScale", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitDragMinScale.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitDragMinScale.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 0.55,
    range: { min: 0.1, max: 4, step: 0.05 },
    requiresReload: false
  });

  reg("portraitDragMaxScale", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitDragMaxScale.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitDragMaxScale.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 1.85,
    range: { min: 0.1, max: 4, step: 0.05 },
    requiresReload: false
  });

  reg("portraitDragMinTiltDeg", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitDragMinTiltDeg.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitDragMinTiltDeg.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: -45,
    range: { min: -180, max: 0, step: 1 },
    requiresReload: false
  });

  reg("portraitDragMaxTiltDeg", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitDragMaxTiltDeg.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitDragMaxTiltDeg.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 45,
    range: { min: 0, max: 180, step: 1 },
    requiresReload: false
  });

  reg("portraitEasing", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitEasing.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitEasing.hint"),
    scope: "world",
    config: true,
    type: String,
    default: "ease-out",
    requiresReload: true
  });

  // === Портреты: блюр фона (мир / World) ===
  reg("portraitBlurEnabled", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitBlurEnabled.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitBlurEnabled.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  reg("portraitBlurStrength", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitBlurStrength.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitBlurStrength.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 2,
    range: { min: 1, max: 30, step: 1 },
    requiresReload: false
  });

  reg("portraitBlurSpeed", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitBlurSpeed.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitBlurSpeed.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 1000,
    range: { min: 100, max: 2000, step: 50 },
    requiresReload: false
  });

  // === Портреты: блюр фокуса (мир / World) ===
  reg("portraitFocusBlurEnabled", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitFocusBlurEnabled.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitFocusBlurEnabled.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false
  });

  reg("portraitFocusBlurStrength", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitFocusBlurStrength.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitFocusBlurStrength.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 4,
    range: { min: 1, max: 30, step: 1 },
    requiresReload: false
  });

  // === Портреты: блюр портретов вне фокуса (мир / World) ===
  reg("portraitFocusPortraitBlurEnabled", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitFocusPortraitBlurEnabled.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitFocusPortraitBlurEnabled.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false
  });

  reg("portraitFocusPortraitBlurStrength", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitFocusPortraitBlurStrength.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.portraitFocusPortraitBlurStrength.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 1,
    range: { min: 1, max: 30, step: 1 },
    requiresReload: false
  });

  reg("npcDockWidth", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.npcDockWidth.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.npcDockWidth.hint"),
    scope: "client",
    config: true,
    type: Number,
    default: 40,
    range: { min: 10, max: 100, step: 1 },
    requiresReload: true
  });

  reg("npcDockRows", {
    name: game.i18n.localize("GINZZZUPORTRAITS.Settings.npcDockRows.name"),
    hint: game.i18n.localize("GINZZZUPORTRAITS.Settings.npcDockRows.hint"),
    scope: "client",
    config: true,
    type: Number,
    default: 1,
    range: { min: 1, max: 5, step: 1 },
    requiresReload: true
  });
});

function applyPerformanceModeClass() {
  try {
    const enabled = !!game.settings.get(MODULE_ID, "performanceMode");
    document.body?.classList.toggle("ginzzzu-performance-mode", enabled);
  } catch (_) {}
}

Hooks.once("ready", () => {
  applyPerformanceModeClass();
});

Hooks.on("updateSetting", (setting) => {
  if (setting?.key === `${MODULE_ID}.performanceMode`) {
    applyPerformanceModeClass();
  }
});

Hooks.on("renderSettingsConfig", (app, html) => {
  scheduleOrganizeModuleSettingsConfig(app, html);
});

Hooks.on("renderApplicationV2", (app, element) => {
  const appId = app?.id ?? app?.options?.id ?? "";
  const appName = app?.constructor?.name ?? "";
  if (appId !== "settings-config" && appName !== "SettingsConfig") return;
  scheduleOrganizeModuleSettingsConfig(app, element);
});
