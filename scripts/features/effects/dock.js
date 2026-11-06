import { MODULE_ID } from "../../core/constants.js";
import { escapeHTML } from "../../lib/sharedUi.js";
import { isEffectsDockMode } from "../dockChrome.js";
import { EFFECTS, EFFECTS_CHANGED, fireEffect, getEffectsState, TARGET_KEY } from "./stage.js";

function t(key, data) {
  const path = `GINZZZUPORTRAITS.Effects.${key}`;
  return data ? game.i18n.format(path, data) : game.i18n.localize(path);
}

function getTarget() {
  try {
    return game.settings.get(MODULE_ID, TARGET_KEY) || "all";
  } catch {
    return "all";
  }
}

export function onEffectsTarget(value) {
  try { game.settings.set(MODULE_ID, TARGET_KEY, value || "all"); } catch {}
}

function fillTargetSelect(root) {
  const select = root.querySelector("#ginzzzu-npc-folder");
  if (!select) return;
  const players = (game.users?.contents ?? []).filter(user => !user.isGM);
  select.innerHTML = `
    <option value="all">${escapeHTML(t("targetAll"))}</option>
    ${players.map(user => `<option value="${escapeHTML(user.id)}">${escapeHTML(user.name)}</option>`).join("")}
  `;
  select.value = getTarget();
  if (select.value !== getTarget()) {
    select.value = "all";
    onEffectsTarget("all");
  }
}

function effectCard(effect, state) {
  const card = document.createElement("div");
  card.className = "item fx-item";
  card.dataset.effectId = effect.id;

  const isOn = effect.kind === "curtain" ? state.curtain : state.mood === effect.id;
  card.classList.toggle("is-on", isOn);

  const name = t(effect.id);
  const addressee = isOn && effect.kind === "mood" && state.users.length
    ? game.users?.get(state.users[0])?.name
    : "";
  card.title = addressee ? t("onlyFor", { name: addressee }) : name;

  const icon = document.createElement("i");
  icon.className = `fas ${effect.icon}`;
  card.appendChild(icon);

  const label = document.createElement("div");
  label.className = "npc-label";
  label.textContent = addressee ? `${name}: ${addressee}` : name;
  card.appendChild(label);

  card.addEventListener("click", event => {
    event.preventDefault();
    fireEffect(effect.id);
  });
  return card;
}

export function buildEffectsDock(root) {
  fillTargetSelect(root);
  for (const selector of [".players", ".npc-favs"]) {
    const box = root.querySelector(selector);
    if (!box) continue;
    box.style.display = "none";
    box.innerHTML = "";
  }

  const rail = root.querySelector(".npcs .rail");
  if (!rail) return;
  rail.classList.remove("is-empty");
  rail.innerHTML = "";
  const state = getEffectsState();
  const fragment = document.createDocumentFragment();
  for (const effect of EFFECTS) fragment.appendChild(effectCard(effect, state));
  rail.appendChild(fragment);
}

export function bindEffectsDockHooks() {
  Hooks.on(EFFECTS_CHANGED, () => {
    if (isEffectsDockMode()) globalThis.GinzzzuNPCDock?.rebuild?.();
  });
}
