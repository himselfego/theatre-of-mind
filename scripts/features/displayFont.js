import { MODULE_ID } from "../core/constants.js";

export const DISPLAY_FONT_DEFAULT = "cormorant";

export const DISPLAY_FONT_PRESETS = {
  cormorant: { family: '"Cormorant Garamond", serif' },
  prata: { family: '"Prata", serif' },
  yeseva: { family: '"Yeseva One", cursive' },
  forum: { family: '"Forum", serif' },
  playfair: { family: '"Playfair Display", serif' },
  marck: { family: '"Marck Script", cursive' },
  pacifico: { family: '"Pacifico", cursive' },
  modesto: { family: '"Modesto Condensed", serif' },
  custom: { family: "" }
};

const GOOGLE_FONTS_HREF = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Forum&family=Marck+Script&family=Pacifico&family=Playfair+Display:wght@400;500;600;700&family=Prata&family=Yeseva+One&display=swap";
const GOOGLE_FONTS_LINK_ID = "tom-display-fonts";

export function displayFontChoices() {
  return Object.fromEntries(
    Object.keys(DISPLAY_FONT_PRESETS).map(key => [
      key,
      game.i18n.localize(`GINZZZUPORTRAITS.Settings.displayFont.option.${key}`)
    ])
  );
}

function currentFontFamily() {
  let key = DISPLAY_FONT_DEFAULT;
  try {
    key = game.settings.get(MODULE_ID, "displayFont") || DISPLAY_FONT_DEFAULT;
  } catch {}
  if (key === "custom") {
    let custom = "";
    try {
      custom = String(game.settings.get(MODULE_ID, "displayFontCustom") || "").trim();
    } catch {}
    return custom || DISPLAY_FONT_PRESETS.cormorant.family;
  }
  return DISPLAY_FONT_PRESETS[key]?.family || DISPLAY_FONT_PRESETS.cormorant.family;
}

function ensureGoogleFonts() {
  if (document.getElementById(GOOGLE_FONTS_LINK_ID)) return;
  if (!document.head.querySelector("link[data-tom-preconnect='gstatic']")) {
    const preconnect = document.createElement("link");
    preconnect.rel = "preconnect";
    preconnect.href = "https://fonts.gstatic.com";
    preconnect.crossOrigin = "anonymous";
    preconnect.dataset.tomPreconnect = "gstatic";
    document.head.appendChild(preconnect);
  }
  const link = document.createElement("link");
  link.id = GOOGLE_FONTS_LINK_ID;
  link.rel = "stylesheet";
  link.href = GOOGLE_FONTS_HREF;
  document.head.appendChild(link);
}

export function applyDisplayFont() {
  ensureGoogleFonts();
  document.documentElement.style.setProperty("--tom-display-font", currentFontFamily());
}

Hooks.once("ready", () => {
  applyDisplayFont();
});

Hooks.on("updateSetting", setting => {
  if (setting?.key === `${MODULE_ID}.displayFont` || setting?.key === `${MODULE_ID}.displayFontCustom`) {
    applyDisplayFont();
  }
});
