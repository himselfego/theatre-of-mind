import { MODULE_ID } from "../../core/constants.js";
import { getPersona } from "./store.js";
import { getCastItem, getEmotionHeightMultiplier } from "./stage.js";

export function getPersonaSubject(personaId) {
  const persona = getPersona(personaId);
  if (!persona) return null;
  const castItem = getCastItem(personaId);
  return {
    id: persona.id,
    name: persona.name,
    img: persona.image,
    flags: {
      [MODULE_ID]: {
        displayName: persona.displayName || "",
        portraitShown: !!castItem,
        portraitEmotion: castItem?.emotion && castItem.emotion !== "none" ? castItem.emotion : null,
        customEmotions: persona.customEmotions || [],
        showStandardEmotions: persona.showStandardEmotions !== false,
        portraitHeightMultiplier: persona.portraitHeightMultiplier ?? 1,
        portraitBreathingMultiplier: persona.portraitBreathingMultiplier ?? 1,
        portraitCustomImage: persona.image || "",
        portraitFlipX: !!castItem?.flip,
        emotionHeightMultiplier: getEmotionHeightMultiplier(persona, castItem)
      }
    }
  };
}
