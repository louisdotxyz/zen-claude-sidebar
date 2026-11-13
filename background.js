/* Toolbar-Button: blendet die Claude-Sidebar ein und aus. */
browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});

/* Rechtsklick-Menü für markierten Text und Bilder. */
const MENU_ACTIONS = {
  "claude-explain": { title: "Erklären", contexts: ["selection"], prompt: "Erkläre mir diesen Text einfach und kurz." },
  "claude-translate": { title: "Übersetzen", contexts: ["selection"], prompt: "Übersetze diesen Text auf Deutsch (falls er schon Deutsch ist, auf Englisch)." },
  "claude-rewrite": { title: "Umschreiben", contexts: ["selection"], prompt: "Schreib diesen Text klarer und flüssiger um, ohne den Inhalt zu ändern." },
  "claude-ask": { title: "Im Chat fragen …", contexts: ["selection"], prompt: "" },
  "claude-find": { title: "Produkt finden (Preis und Shops)", contexts: ["image"], prompt: "find" },
  "claude-image": { title: "Bild in den Chat", contexts: ["image"], prompt: "" }
};

browser.menus.create({ id: "claude", title: "Claude", contexts: ["selection", "image"] });
for (const [id, action] of Object.entries(MENU_ACTIONS)) {
  browser.menus.create({ id, parentId: "claude", title: action.title, contexts: action.contexts });
}

browser.menus.onClicked.addListener((info) => {
  const action = MENU_ACTIONS[info.menuItemId];
  if (!action) return;
  browser.sidebarAction.open();
  const isImage = action.contexts[0] === "image";
  browser.storage.local.set({
    pendingAction: {
      time: Date.now(),
      prompt: action.prompt,
      text: isImage ? "" : (info.selectionText || "").slice(0, 20000),
      imageUrl: isImage ? info.srcUrl || "" : ""
    }
  });
});
