/* Ein- und Ausblenden: Tastenkürzel "toggle-claude". Im Modus "Schwebend" öffnet es das Fenster über der Webseite,
   sonst (oder auf internen Seiten, wo kein Content-Script läuft) die Seitenleiste.
   sidebarAction.toggle() muss synchron im Kürzel-Handler laufen, darum werden Modus und Tab-URL vorab gemerkt. */
let windowMode = "float";
let activeTabUrl = "";
const isScriptable = (url) => /^(https?|file):/i.test(url || "") && !/^https:\/\/(addons\.mozilla\.org|accounts\.firefox\.com)\//i.test(url || "");

async function refreshActiveUrl() {
  try {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    activeTabUrl = (tab && tab.url) || "";
  } catch (_) {
    activeTabUrl = "";
  }
}
browser.tabs.onActivated.addListener(refreshActiveUrl);
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) activeTabUrl = changeInfo.url;
});
browser.windows.onFocusChanged.addListener(refreshActiveUrl);
browser.storage.local.get("settings").then(({ settings }) => {
  windowMode = settings && settings.windowMode === "sidebar" ? "sidebar" : "float";
});
refreshActiveUrl();

async function setFloatOpen(open) {
  const { floatState } = await browser.storage.local.get("floatState");
  const current = floatState || {};
  await browser.storage.local.set({ floatState: Object.assign({}, current, { open: open === "toggle" ? !current.open : open }) });
}

browser.commands.onCommand.addListener((name) => {
  if (name !== "toggle-claude") return;
  if (windowMode === "sidebar" || !isScriptable(activeTabUrl)) {
    browser.sidebarAction.toggle();
    return;
  }
  setFloatOpen("toggle");
});

/* Auto-Update: alle 6 Stunden nachfragen (Firefox selbst nur etwa täglich).
   Ein gefundenes Update wird sofort installiert, ausser Claude schreibt gerade eine Antwort;
   dann installiert es die Sidebar, sobald sie fertig ist. */
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BUSY_TIMEOUT_MS = 10 * 60 * 1000;

browser.runtime.onUpdateAvailable.addListener(async (details) => {
  await browser.storage.local.set({ updateReady: { version: details.version, time: Date.now() } });
  const { busySince } = await browser.storage.local.get("busySince");
  if (!busySince || Date.now() - busySince > BUSY_TIMEOUT_MS) browser.runtime.reload();
});

async function checkForUpdate() {
  try {
    await browser.runtime.requestUpdateCheck();
  } catch (_) {
    /* z. B. temporär geladene Extension: keine Updates */
  }
}
setTimeout(checkForUpdate, 60 * 1000);
setInterval(checkForUpdate, UPDATE_INTERVAL_MS);

/* Rechtsklick-Menü für markierten Text und Bilder. Die Texte folgen der Sprache aus den Einstellungen. */
const MENU_ACTIONS = {
  explain: ["selection"],
  translate: ["selection"],
  rewrite: ["selection"],
  ask: ["selection"],
  find: ["image"],
  image: ["image"]
};

async function buildMenus() {
  const { settings } = await browser.storage.local.get("settings");
  I18n.setLanguage((settings && settings.language) || "auto");
  await browser.menus.removeAll();
  browser.menus.create({ id: "claude", title: "Claude", contexts: ["selection", "image"] });
  for (const [kind, contexts] of Object.entries(MENU_ACTIONS)) {
    browser.menus.create({ id: `claude-${kind}`, parentId: "claude", title: I18n.t(`menu.${kind}`), contexts });
  }
}

buildMenus();
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  const settings = changes.settings.newValue || {};
  windowMode = settings.windowMode === "sidebar" ? "sidebar" : "float";
  buildMenus();
});

browser.menus.onClicked.addListener((info, tab) => {
  const kind = String(info.menuItemId).replace(/^claude-/, "");
  const contexts = MENU_ACTIONS[kind];
  if (!contexts) return;
  if (windowMode === "sidebar" || !isScriptable(tab && tab.url)) browser.sidebarAction.open();
  else setFloatOpen(true);
  const isImage = contexts[0] === "image";
  browser.storage.local.set({
    pendingAction: {
      time: Date.now(),
      kind,
      text: isImage ? "" : (info.selectionText || "").slice(0, 20000),
      imageUrl: isImage ? info.srcUrl || "" : ""
    }
  });
});
