import { MODULE_ID, DOCK_ID } from "../core/constants.js";
import { isTheatreStage, openTheatreScene } from "./ensureTheatreScene.js";
import { applyDockPanelChrome, isEffectsDockMode, isLocationDockMode, registerDockChromeSettings } from "./dockChrome.js";
import { buildEffectsDock, onEffectsTarget } from "./effects/dock.js";
import { clearEffects } from "./effects/stage.js";
import {
  buildLocationDock,
  onLocationDockClear,
  onLocationDockFolder,
  onLocationDockSearch
} from "./locations/dock.js";
import {
  buildPersonaDock,
  onPersonaDockFolder,
  onPersonaDockSearch
} from "./personas/dock.js";
import { CAST_CHANGED, getShownPersonaIds, hideAllPersonas, hidePersona } from "./personas/stage.js";
import { getLibrary, getPersona } from "./personas/store.js";
import { fileToSrc } from "./personas/shared.js";

(()=>{
  const isGmClient = () => !!game.user?.isGM;

  Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "npcDockCollapsed", { scope: "client", config: false, type: Boolean, default: true });
    registerDockChromeSettings();
  });

  const getIsCollapsed = () => { try { return game.settings.get(MODULE_ID, "npcDockCollapsed"); } catch { return true; } };
  const setIsCollapsed = (v) => { try { game.settings.set(MODULE_ID, "npcDockCollapsed", v); } catch {} };
  const getShowActivePortraits = () => { try { return !!game.settings.get(MODULE_ID, "showActivePortraits"); } catch { return true; } };

  const NPC_DOCK_CARD_SIZE = 100;
  const NPC_DOCK_GAP = 8;
  const PLAYER_DOCK_CARD_SIZE = 50;
  const PLAYER_DOCK_GAP = 6;

  function getNpcDockWidth() {
    try { return game.settings.get(MODULE_ID, "npcDockWidth") || 40; } catch { return 40; }
  }

  function getNpcDockRows() {
    try {
      const value = Number(game.settings.get(MODULE_ID, "npcDockRows")) || 1;
      return Math.max(1, Math.min(5, Math.trunc(value)));
    } catch {
      return 1;
    }
  }

  function applyNpcDockLayout() {
    if (!isGmClient()) return;
    const root = document.getElementById(DOCK_ID);
    if (!root) return;
    const width = getNpcDockWidth();
    const rows = getNpcDockRows();
    const height = rows * NPC_DOCK_CARD_SIZE + Math.max(0, rows - 1) * NPC_DOCK_GAP;
    const playerVisibleRows = rows * 2;
    const playerHeight = playerVisibleRows * PLAYER_DOCK_CARD_SIZE + Math.max(0, playerVisibleRows - 1) * PLAYER_DOCK_GAP;
    root.style.width = `${width}vw`;
    root.style.setProperty("--ginzzzu-npc-dock-rows", String(rows));
    root.style.setProperty("--ginzzzu-npc-dock-height", `${height}px`);
    root.style.setProperty("--ginzzzu-npc-dock-grid-rows", `repeat(${rows}, ${NPC_DOCK_CARD_SIZE}px)`);
    root.style.setProperty("--ginzzzu-player-panel-height", `${playerHeight}px`);
    root.classList.toggle("npc-rows-1", rows === 1);
    root.classList.toggle("npc-rows-2", rows === 2);
    root.classList.toggle("npc-rows-3plus", rows >= 3);
  }

  function applyCollapsed(collapsed) {
    setIsCollapsed(collapsed);
    const root = document.getElementById(DOCK_ID);
    if (!root) return;
    root.classList.toggle("collapsed", collapsed);
    const collapseBtn = root.querySelector("#ginzzzu-npc-collapse");
    if (!collapseBtn) return;
    collapseBtn.title = collapsed
      ? game.i18n.localize("GINZZZUPORTRAITS.showPanelUI")
      : game.i18n.localize("GINZZZUPORTRAITS.hidePanelUI");
    const icon = collapseBtn.querySelector("i");
    if (icon) icon.className = `fas ${collapsed ? "fa-expand" : "fa-compress"}`;
  }

  let searchEl;
  let folderEl;
  let clearBtn;

  function ensureDock() {
    if (!isGmClient()) return null;
    let root = document.getElementById(DOCK_ID);
    if (root) return root;

    root = document.createElement("div");
    root.id = DOCK_ID;
    root.style.display = "none";
    document.body.appendChild(root);

    applyNpcDockLayout();

    const mini = document.createElement("div");
    mini.className = "active-portraits";
    mini.style.display = getShowActivePortraits() ? "" : "none";
    root.appendChild(mini);

    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    const isCollapsed = getIsCollapsed();
    toolbar.innerHTML = `
      <div class="left">
        <input id="ginzzzu-npc-search" type="text" placeholder="${game.i18n.localize("GINZZZUPORTRAITS.searchNPC")}">
      </div>
      <div class="right">
        <label>${game.i18n.localize("GINZZZUPORTRAITS.displaySrc")}</label>
        <select id="ginzzzu-npc-folder">
          <option value="all">${game.i18n.localize("GINZZZUPORTRAITS.allFolders")}</option>
        </select>
        <button class="clear-all" id="ginzzzu-npc-clear" title="${game.i18n.localize("GINZZZUPORTRAITS.hideAllPortraits")}">🧹</button>
        <button class="collapse-btn" id="ginzzzu-npc-collapse" title="${isCollapsed ? game.i18n.localize("GINZZZUPORTRAITS.showPanelUI") : game.i18n.localize("GINZZZUPORTRAITS.hidePanelUI")}">
          <i class="fas ${isCollapsed ? "fa-expand" : "fa-compress"}"></i>
        </button>
      </div>
    `;
    root.appendChild(toolbar);

    const content = document.createElement("div");
    content.className = "content";
    content.innerHTML = `
      <div class="players" style="display:none"></div>
      <div class="npc-favs" style="display:none"></div>
      <div class="npcs"><div class="rail"></div></div>
    `;
    root.appendChild(content);

    root.addEventListener("wheel", ev => {
      const players = root.querySelector(".players");
      const favs = root.querySelector(".npc-favs");
      const npcsRail = root.querySelector(".npcs .rail");
      if (!players || !npcsRail) return;

      const over = el => {
        if (!el) return false;
        if (ev.target instanceof Node && el.contains(ev.target)) return true;
        const r = el.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right &&
               ev.clientY >= r.top && ev.clientY <= r.bottom;
      };

      let delta = ev.deltaY || 0;
      if (ev.deltaMode === 1) delta *= 16;
      else if (ev.deltaMode === 2) delta *= window.innerHeight;
      if (!delta) return;

      ev.preventDefault();
      if (over(players) || over(favs)) {
        const target = over(players) ? players : favs;
        target.scrollTop += delta;
      } else {
        npcsRail.scrollLeft += delta;
      }
    }, { passive: false, capture: true });

    root.addEventListener("contextmenu", ev => {
      if ((ev.target instanceof HTMLElement) && ev.target.closest(`#${DOCK_ID} .item`)) {
        ev.preventDefault();
      }
    });

    searchEl = toolbar.querySelector("#ginzzzu-npc-search");
    folderEl = toolbar.querySelector("#ginzzzu-npc-folder");
    clearBtn = toolbar.querySelector("#ginzzzu-npc-clear");

    // The search rebuilds every card, so wait for a pause in typing.
    let searchTimer = null;
    searchEl.addEventListener("input", e => {
      const value = e.target.value || "";
      const applySearch = isLocationDockMode() ? onLocationDockSearch : onPersonaDockSearch;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => applySearch(value), 200);
    });
    folderEl.addEventListener("change", e => {
      if (isEffectsDockMode()) {
        onEffectsTarget(e.target.value || "all");
        return;
      }
      if (isLocationDockMode()) {
        onLocationDockFolder(e.target.value || "all");
        return;
      }
      onPersonaDockFolder(e.target.value || "all");
    });

    clearBtn.addEventListener("click", async e => {
      e.preventDefault();
      if (isEffectsDockMode()) {
        await clearEffects();
        return;
      }
      if (isLocationDockMode()) {
        await onLocationDockClear();
        return;
      }
      await hideAllPersonas();
    });

    const collapseBtn = toolbar.querySelector("#ginzzzu-npc-collapse");
    collapseBtn.addEventListener("click", async e => {
      e.preventDefault();
      const collapsed = !getIsCollapsed();
      applyCollapsed(collapsed);
      if (!collapsed) await openTheatreScene();
    });

    root.classList.toggle("collapsed", getIsCollapsed());
    return root;
  }

  let miniDockTimer = null;
  function scheduleMiniDockRebuild(delay = 30) {
    clearTimeout(miniDockTimer);
    miniDockTimer = setTimeout(() => {
      miniDockTimer = null;
      buildMiniDock();
    }, delay);
  }

  function buildMiniDock() {
    const root = ensureDock();
    const mini = root.querySelector(".active-portraits");
    if (!mini) return;
    mini.innerHTML = "";

    const library = getLibrary();
    const active = getShownPersonaIds().map(id => getPersona(id)).filter(Boolean);
    if (!active.length) {
      mini.style.display = "none";
      return;
    }
    mini.style.display = "";

    const fragment = document.createDocumentFragment();
    for (const persona of active) {
      const btn = document.createElement("div");
      btn.className = "dock-icon";
      btn.dataset.personaId = persona.id;
      btn.title = persona.name;

      const img = document.createElement("img");
      img.src = fileToSrc(persona.image);
      img.alt = persona.name || "";
      img.draggable = false;
      btn.appendChild(img);

      if (library.favorites.includes(persona.id)) {
        const f = document.createElement("div");
        f.className = "fav";
        f.textContent = "★";
        btn.appendChild(f);
      }

      btn.addEventListener("click", async ev => {
        ev.preventDefault();
        await hidePersona(persona.id);
      });

      btn.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        ev.stopPropagation();
      });

      fragment.appendChild(btn);
    }
    mini.appendChild(fragment);
  }

  function buildDock() {
    if (!isGmClient()) return;
    const root = ensureDock();
    applyNpcDockLayout();
    try { if (getShowActivePortraits()) scheduleMiniDockRebuild(0); } catch {}
    applyDockPanelChrome(root);

    if (isEffectsDockMode()) {
      buildEffectsDock(root);
      root.style.display = "";
      return;
    }

    if (isLocationDockMode()) {
      buildLocationDock(root);
      root.style.display = "";
      return;
    }

    buildPersonaDock(root);

    if (!root.__threeOWheelAttached) {
      const attachWheel = (el, vertical = true) => {
        if (!el) return;
        el.addEventListener("wheel", function(ev) {
          let delta = ev.deltaY || 0;
          if (ev.deltaMode === 1) delta *= 16;
          else if (ev.deltaMode === 2) delta *= window.innerHeight;
          if (!delta) return;
          ev.preventDefault();
          ev.stopPropagation();
          if (vertical) this.scrollTop += delta;
          else this.scrollLeft += delta;
        }, { passive: false });
      };

      attachWheel(root.querySelector(".players"), true);
      attachWheel(root.querySelector(".npc-favs"), true);
      attachWheel(root.querySelector(".npcs .rail"), false);
      root.__threeOWheelAttached = true;
    }

    root.style.display = "";
  }

  function hideAllPortraitsAllActors() {
    globalThis.GinzzzuPortraits?.closeAllLocalPortraits?.();
  }

  let rebuildTimer = null;
  function scheduleRebuild(delay = 60) {
    if (!isGmClient()) return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(buildDock, delay);
  }

  Hooks.once("ready", () => {
    if (!isGmClient()) return;

    ensureDock();
    buildDock();
    if (!isTheatreStage()) {
      applyCollapsed(true);
      hideAllPortraitsAllActors();
    }

    Hooks.on("preUpdateSetting", (setting) => {
      if (setting.key === `${MODULE_ID}.npcDockWidth` || setting.key === `${MODULE_ID}.npcDockRows`) {
        setTimeout(() => {
          applyNpcDockLayout();
          scheduleRebuild(0);
        }, 50);
      }
    });

    Hooks.on("canvasReady", () => {
      scheduleRebuild();
      if (isTheatreStage()) return;
      applyCollapsed(true);
      hideAllPortraitsAllActors();
    });

    Hooks.on(CAST_CHANGED, () => {
      try { if (getShowActivePortraits()) scheduleMiniDockRebuild(0); } catch {}
    });
  });

  globalThis.GinzzzuNPCDock = {
    rebuild: buildDock,
    refreshDisplayNames: () => buildDock(),
    refreshPreviews: () => scheduleRebuild(0),
    show: () => { const root = ensureDock(); if (root) root.style.display = ""; },
    hide: () => { const root = ensureDock(); if (root) root.style.display = "none"; }
  };
})();
