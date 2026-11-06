import { localizeNs, confirmDialog as confirmDialogUi } from "../../lib/sharedUi.js";

export const SETTING_KEY = "personaLibrary";
export const t = localizeNs("GINZZZUPORTRAITS.Personas");

export async function confirmDialog(content, title = t("pickerTitle")) {
  return confirmDialogUi(content, title);
}

export {
  escapeHTML,
  nameFromPath,
  fileToSrc,
  pickFile,
  contextMenu,
  menuItem
} from "../../lib/sharedUi.js";
