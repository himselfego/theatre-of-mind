import { localizeNs, confirmDialog as confirmDialogUi } from "../../lib/sharedUi.js";

export const SETTING_KEY = "locationLibrary";
export const t = localizeNs("GINZZZUPORTRAITS.Locations");

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
