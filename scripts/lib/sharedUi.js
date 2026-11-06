export const IMAGE_EXT = /\.(webp|png|jpe?g|avif)$/i;

export function localizeNs(ns) {
  return function t(key, data) {
    const loc = `${ns}.${key}`;
    return data ? game.i18n.format(loc, data) : game.i18n.localize(loc);
  };
}

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

export function FilePickerClass() {
  return foundry.applications?.apps?.FilePicker?.implementation
    ?? foundry.applications?.apps?.FilePicker
    ?? globalThis.FilePicker;
}

export function nameFromPath(path) {
  const base = decodeURIComponent(String(path).split("/").pop() || "");
  return base.replace(/\.[^.]+$/, "");
}

export function normPath(path) {
  try {
    return decodeURI(String(path || ""));
  } catch {
    return String(path || "");
  }
}

export function fileToSrc(path) {
  return encodeURI(normPath(path)).replace(/#/g, "%23");
}

export function pickFile({ type = "image", current = "", callback }) {
  const Picker = FilePickerClass();
  const open = (pickerType, onPath) => {
    const fp = new Picker({
      type: pickerType,
      current: current || "",
      callback: path => onPath(path, fp)
    });
    fp.render(true);
    return fp;
  };

  try {
    return open(type, callback);
  } catch {
    if (type !== "folder") throw new Error("FilePicker failed");
    return open("image", (path, fp) => {
      const dir = IMAGE_EXT.test(path) && path.includes("/")
        ? path.slice(0, path.lastIndexOf("/"))
        : path;
      callback(dir, fp);
    });
  }
}

export async function confirmDialog(content, title) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (DialogV2?.confirm) {
    return DialogV2.confirm({ window: { title }, content });
  }
  return Dialog.confirm({ title, content });
}

export async function promptText({ title, label, value = "" }) {
  const content = `<div class="form-group"><label>${escapeHTML(label)}</label><input type="text" name="value" value="${escapeHTML(value)}" autofocus></div>`;
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (DialogV2?.prompt) {
    const result = await DialogV2.prompt({
      window: { title },
      content,
      ok: {
        callback: (_event, button) => String(button.form.elements.value?.value ?? "").trim()
      }
    });
    return result == null ? null : String(result).trim();
  }
  return new Promise(resolve => {
    let settled = false;
    const done = next => {
      if (settled) return;
      settled = true;
      resolve(next);
    };
    new Dialog({
      title,
      content,
      buttons: {
        ok: {
          label: game.i18n.localize("Yes"),
          callback: html => done(String(html.find('[name="value"]').val() ?? "").trim())
        },
        cancel: {
          label: game.i18n.localize("Cancel"),
          callback: () => done(null)
        }
      },
      default: "ok",
      close: () => done(null)
    }).render(true);
  });
}

export function contextMenu(element, selector, items) {
  const CM = foundry.applications?.ux?.ContextMenu?.implementation
    ?? foundry.applications?.ux?.ContextMenu
    ?? globalThis.ContextMenu;
  const root = element?.jquery ? element[0] : element;
  return new CM(root, selector, items, { jQuery: false, fixed: true });
}

export function menuItem({ label, icon, onClick, visible }) {
  const gen = Number(game.release?.generation ?? 13);
  if (gen >= 14) {
    const entry = { label, icon, onClick };
    if (visible !== undefined) entry.visible = visible;
    return entry;
  }
  const entry = {
    name: label,
    icon,
    callback: (target, event) => onClick?.(event, target)
  };
  if (visible !== undefined) entry.condition = visible;
  return entry;
}
