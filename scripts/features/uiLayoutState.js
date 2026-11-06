const BODY_STATE_CLASSES = Object.freeze({
  sidebarPresent: "ginzzzu-sidebar-present",
  sidebarExpanded: "ginzzzu-sidebar-expanded",
  sidebarActive: "ginzzzu-sidebar-content-active",
  activeChat: "ginzzzu-sidebar-active-chat",
  chatTabPresent: "ginzzzu-sidebar-chat-tab-present",
  chatTabActive: "ginzzzu-sidebar-chat-tab-active",
  quickChatPresent: "ginzzzu-quick-chat-present",
  quickChatVisible: "ginzzzu-quick-chat-visible"
});

let layoutStateFrame = null;
let layoutStateObserver = null;
const observedLayoutElements = new WeakSet();

function observeLayoutElement(element) {
  if (!element || observedLayoutElements.has(element)) return;
  observedLayoutElements.add(element);
  layoutStateObserver?.observe(element, {
    attributes: true,
    attributeFilter: ["class"]
  });
}

function syncUiLayoutState() {
  layoutStateFrame = null;

  const body = document.body;
  if (!body) return;

  const sidebarContent = document.getElementById("sidebar-content");
  const sidebarChatTab = document.getElementById("sidebar-tab-chat");
  const chatNotifications = document.getElementById("chat-notifications");

  observeLayoutElement(sidebarContent);
  observeLayoutElement(sidebarChatTab);
  observeLayoutElement(chatNotifications);

  body.classList.toggle(BODY_STATE_CLASSES.sidebarPresent, !!sidebarContent);
  body.classList.toggle(
    BODY_STATE_CLASSES.sidebarExpanded,
    !!sidebarContent?.classList.contains("expanded")
  );
  body.classList.toggle(
    BODY_STATE_CLASSES.sidebarActive,
    !!sidebarContent?.classList.contains("active")
  );
  body.classList.toggle(
    BODY_STATE_CLASSES.activeChat,
    !!sidebarContent?.classList.contains("active-chat")
  );
  body.classList.toggle(BODY_STATE_CLASSES.chatTabPresent, !!sidebarChatTab);
  body.classList.toggle(
    BODY_STATE_CLASSES.chatTabActive,
    !!sidebarChatTab?.classList.contains("active")
  );
  body.classList.toggle(BODY_STATE_CLASSES.quickChatPresent, !!chatNotifications);
  body.classList.toggle(
    BODY_STATE_CLASSES.quickChatVisible,
    !!chatNotifications && !chatNotifications.classList.contains("input-hidden")
  );
}

function scheduleUiLayoutStateSync() {
  if (layoutStateFrame !== null) return;
  layoutStateFrame = requestAnimationFrame(syncUiLayoutState);
}

Hooks.once("ready", () => {
  layoutStateObserver = new MutationObserver(scheduleUiLayoutStateSync);
  syncUiLayoutState();

  // Foundry can finish mounting sidebar/chat controls shortly after `ready`.
  // These bounded retries attach the narrow class observers without watching
  // the entire application DOM (which would make sheet rendering expensive).
  setTimeout(scheduleUiLayoutStateSync, 250);
  setTimeout(scheduleUiLayoutStateSync, 1000);
});

Hooks.on("collapseSidebar", scheduleUiLayoutStateSync);
Hooks.on("renderSidebarTab", scheduleUiLayoutStateSync);
