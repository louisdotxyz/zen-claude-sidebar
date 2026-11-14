/* Ein- und Ausblenden läuft über das Tastenkürzel (_execute_sidebar_action), ohne Toolbar-Button. */

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
  if (area === "local" && changes.settings) buildMenus();
});

browser.menus.onClicked.addListener((info) => {
  const kind = String(info.menuItemId).replace(/^claude-/, "");
  const contexts = MENU_ACTIONS[kind];
  if (!contexts) return;
  browser.sidebarAction.open();
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
