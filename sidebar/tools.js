/* Werkzeuge, mit denen Claude Tabs und Ordner (Tab-Gruppen) lesen und ordnen kann.
   Nichts wird geschlossen oder gelöscht. Ändernde Werkzeuge laufen über eine Bestätigung im Panel. */
(function (root) {
  const L = (key, values) => (root.I18n ? root.I18n.t(key, values) : key);
  const nTabs = (count) => (root.I18n ? root.I18n.tabCount(count) : `${count} Tabs`);
  const GROUP_COLORS = ["grey", "blue", "purple", "cyan", "green", "yellow", "orange", "red", "pink"];
  const READ_TAB_MAX_CHARS = 30000;

  const DEFINITIONS = [
    {
      name: "list_tabs",
      description:
        "List the user's open tabs and folders (tab groups) in the current workspace. Use only when the request is about tabs or folders. Returns tabId, index, title, url, pinned, active, hidden and groupId for each tab, and the folders with groupId, title, color, collapsed.",
      input_schema: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["current_window", "all_windows"], description: "Default current_window." },
          include_other_workspaces: { type: "boolean", description: "Also list hidden tabs from other Zen workspaces. Default false; only when the user asks about all workspaces." }
        }
      }
    },
    {
      name: "read_tab",
      description: "Read the visible text content of one tab. Use only when you need the page content.",
      input_schema: {
        type: "object",
        properties: { tabId: { type: "integer" } },
        required: ["tabId"]
      }
    },
    {
      name: "product_details",
      description:
        "Fetch up to 6 product pages (shop or manufacturer) in the background, without opening tabs, and get compact data: name, brand, EAN/GTIN, price, currency, availability, rating, offers, specs when the page has them. Cheap: use it to verify prices and availability, to compare candidates from a product list, or to check a shop found by web search. Put all URLs into one call.",
      input_schema: {
        type: "object",
        properties: {
          urls: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 }
        },
        required: ["urls"]
      }
    },
    {
      name: "focus_tab",
      description: "Switch to a tab so the user sees it.",
      input_schema: {
        type: "object",
        properties: { tabId: { type: "integer" } },
        required: ["tabId"]
      }
    },
    {
      name: "move_tabs",
      description:
        "Move tabs to a position. The tabs are placed in the given order starting at index (-1 = end of the window). Optionally into another window.",
      input_schema: {
        type: "object",
        properties: {
          tabIds: { type: "array", items: { type: "integer" }, minItems: 1 },
          index: { type: "integer" },
          windowId: { type: "integer" }
        },
        required: ["tabIds", "index"]
      }
    },
    {
      name: "group_tabs",
      description:
        "Put tabs into a folder (tab group). Without groupId a new folder is created; give it a short title. With groupId the tabs are added to that existing folder.",
      input_schema: {
        type: "object",
        properties: {
          tabIds: { type: "array", items: { type: "integer" }, minItems: 1 },
          groupId: { type: "integer" },
          title: { type: "string" },
          color: { type: "string", enum: GROUP_COLORS }
        },
        required: ["tabIds"]
      }
    },
    {
      name: "ungroup_tabs",
      description: "Take tabs out of their folders. The tabs stay open.",
      input_schema: {
        type: "object",
        properties: { tabIds: { type: "array", items: { type: "integer" }, minItems: 1 } },
        required: ["tabIds"]
      }
    },
    {
      name: "update_group",
      description: "Rename a folder, change its color, or collapse/expand it.",
      input_schema: {
        type: "object",
        properties: {
          groupId: { type: "integer" },
          title: { type: "string" },
          color: { type: "string", enum: GROUP_COLORS },
          collapsed: { type: "boolean" }
        },
        required: ["groupId"]
      }
    },
    {
      name: "close_tabs",
      description:
        "Close tabs. The user is always asked to confirm first. Only for cleanups the user asked for (duplicates, stale tabs). Pinned tabs are refused.",
      input_schema: {
        type: "object",
        properties: { tabIds: { type: "array", items: { type: "integer" }, minItems: 1 } },
        required: ["tabIds"]
      }
    },
    {
      name: "move_group",
      description: "Move a whole folder to a position in its window (-1 = end).",
      input_schema: {
        type: "object",
        properties: { groupId: { type: "integer" }, index: { type: "integer" } },
        required: ["groupId", "index"]
      }
    }
  ];

  const WRITE_TOOLS = new Set(["move_tabs", "group_tabs", "ungroup_tabs", "update_group", "move_group", "close_tabs"]);
  const ALWAYS_CONFIRM = new Set(["close_tabs"]);
  const foldersSupported = () => typeof browser.tabs.group === "function" && Boolean(browser.tabGroups);

  function shortUrl(url) {
    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) return url.slice(0, 80);
      return (parsed.hostname + parsed.pathname).slice(0, 120);
    } catch (_) {
      return String(url || "").slice(0, 80);
    }
  }

  const ungroupedId = (groupId) => (typeof groupId === "number" && groupId >= 0 ? groupId : null);

  async function requireTabs(tabIds) {
    if (!Array.isArray(tabIds) || !tabIds.length) throw new Error("tabIds fehlt.");
    const tabs = [];
    const missing = [];
    for (const id of tabIds) {
      try {
        tabs.push(await browser.tabs.get(Number(id)));
      } catch (_) {
        missing.push(id);
      }
    }
    if (missing.length) throw new Error(`Diese Tabs gibt es nicht (mehr): ${missing.join(", ")}. Ruf list_tabs erneut auf.`);
    return tabs;
  }

  async function getGroup(groupId) {
    if (!browser.tabGroups) throw new Error("Ordner werden von diesem Browser nicht unterstützt.");
    return browser.tabGroups.get(Number(groupId));
  }

  /* ---------- Ausführen ---------- */

  async function listTabs(input) {
    const scope = input.scope === "all_windows" ? "all_windows" : "current_window";
    const includeHidden = input.include_other_workspaces === true;
    const current = await browser.windows.getCurrent();
    let windows = await browser.windows.getAll({ populate: true, windowTypes: ["normal"] });
    if (scope === "current_window") windows = windows.filter((window) => window.id === current.id);
    if (!includeHidden) windows = windows.map((window) => Object.assign({}, window, { tabs: window.tabs.filter((tab) => !tab.hidden) }));
    const usedGroupIds = new Set(windows.flatMap((window) => window.tabs.map((tab) => tab.groupId)));
    let groups = [];
    if (browser.tabGroups && typeof browser.tabGroups.query === "function") {
      try {
        groups = await browser.tabGroups.query({});
      } catch (_) {
        groups = [];
      }
    }
    const tabCount = windows.reduce((sum, window) => sum + window.tabs.length, 0);
    const folderCount = groups.filter((group) => includeHidden || usedGroupIds.has(group.id)).length;
    const firstTabByUrl = new Map();
    const describeTab = (tab) => {
      const item = {
        tabId: tab.id,
        index: tab.index,
        title: (tab.title || "").slice(0, 120),
        url: shortUrl(tab.url),
        pinned: tab.pinned,
        active: tab.active,
        hidden: Boolean(tab.hidden),
        groupId: ungroupedId(tab.groupId)
      };
      if (typeof tab.lastAccessed === "number") item.daysSinceUsed = Math.max(0, Math.floor((Date.now() - tab.lastAccessed) / 86400000));
      if (/^https?:/i.test(tab.url || "")) {
        if (firstTabByUrl.has(tab.url)) item.duplicateOf = firstTabByUrl.get(tab.url);
        else firstTabByUrl.set(tab.url, tab.id);
      }
      return item;
    };
    return {
      foldersSupported: foldersSupported(),
      currentWindowId: current.id,
      windows: windows.map((window) => ({
        windowId: window.id,
        isCurrent: window.id === current.id,
        folders: groups
          .filter((group) => group.windowId === window.id && (includeHidden || usedGroupIds.has(group.id)))
          .map((group) => ({ groupId: group.id, title: group.title || "", color: group.color, collapsed: group.collapsed })),
        tabs: window.tabs.map(describeTab)
      })),
      _label: folderCount ? L("tool.listedFolders", { count: tabCount, folders: folderCount }) : L("tool.listed", { count: tabCount })
    };
  }

  async function readTab(input) {
    const [tab] = await requireTabs([input.tabId]);
    const page = await TabTools.extractTab(tab);
    const shop = root.ShopTools && page.shop ? root.ShopTools.formatShopData(page.shop) : "";
    /* Produktliste: kurzer Text reicht, die Produkte stehen in shop_data. */
    const limit = page.shop && page.shop.cards && page.shop.cards.length ? 6000 : READ_TAB_MAX_CHARS;
    const text = page.text || "";
    const result = {
      title: page.title,
      url: page.url,
      text: text.slice(0, limit) + (text.length > limit ? "\n[… gekürzt]" : ""),
      _label: L("tool.read", { title: tab.title || tab.url })
    };
    if (shop) result.shop_data = shop;
    return result;
  }

  async function productDetails(input) {
    if (!root.ShopTools) throw new Error("Shop tools not loaded.");
    const urls = Array.isArray(input.urls) ? input.urls : [];
    if (!urls.length) throw new Error("urls fehlt.");
    const results = await root.ShopTools.productDetailsMany(urls);
    const ok = results.filter((entry) => !entry.error).length;
    return { results, _label: L("tool.products", { count: ok, total: results.length }) };
  }

  async function focusTab(input) {
    const [tab] = await requireTabs([input.tabId]);
    await browser.tabs.update(tab.id, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
    return { ok: true, _label: L("tool.focused", { title: tab.title || tab.url }) };
  }

  async function moveTabs(input) {
    const tabs = await requireTabs(input.tabIds);
    const options = { index: Number.isInteger(input.index) ? input.index : -1 };
    if (Number.isInteger(input.windowId)) options.windowId = input.windowId;
    await browser.tabs.move(tabs.map((tab) => tab.id), options);
    return { ok: true, _label: L("tool.moved", { tabs: nTabs(tabs.length) }) };
  }

  async function groupTabs(input) {
    if (!foldersSupported()) throw new Error("Ordner (Tab-Gruppen) werden von diesem Browser nicht unterstützt. Nutze move_tabs.");
    const tabs = await requireTabs(input.tabIds);
    const options = { tabIds: tabs.map((tab) => tab.id) };
    if (Number.isInteger(input.groupId)) options.groupId = input.groupId;
    const groupId = await browser.tabs.group(options);
    const update = {};
    if (input.title) update.title = String(input.title).slice(0, 60);
    if (GROUP_COLORS.includes(input.color)) update.color = input.color;
    if (Object.keys(update).length) await browser.tabGroups.update(groupId, update);
    const group = await getGroup(groupId);
    return {
      ok: true,
      groupId,
      _label: options.groupId !== undefined
        ? L("tool.grouped", { count: tabs.length, title: group.title || groupId })
        : L("tool.groupCreated", { count: tabs.length, title: group.title || L("tool.unnamed") })
    };
  }

  async function ungroupTabs(input) {
    if (typeof browser.tabs.ungroup !== "function") throw new Error("Ordner werden von diesem Browser nicht unterstützt.");
    const tabs = await requireTabs(input.tabIds);
    await browser.tabs.ungroup(tabs.map((tab) => tab.id));
    return { ok: true, _label: L("tool.ungrouped", { count: tabs.length }) };
  }

  async function updateGroup(input) {
    const group = await getGroup(input.groupId);
    const update = {};
    if (typeof input.title === "string") update.title = input.title.slice(0, 60);
    if (GROUP_COLORS.includes(input.color)) update.color = input.color;
    if (typeof input.collapsed === "boolean") update.collapsed = input.collapsed;
    await browser.tabGroups.update(group.id, update);
    return { ok: true, _label: L("tool.groupUpdated", { title: update.title || group.title || group.id }) };
  }

  async function moveGroup(input) {
    const group = await getGroup(input.groupId);
    await browser.tabGroups.move(group.id, { index: Number.isInteger(input.index) ? input.index : -1 });
    return { ok: true, _label: L("tool.groupMoved", { title: group.title || group.id }) };
  }

  async function closeTabs(input) {
    const tabs = await requireTabs(input.tabIds);
    const pinned = tabs.filter((tab) => tab.pinned);
    if (pinned.length) {
      throw new Error(`Angepinnte Tabs/Essentials werden nicht geschlossen: ${pinned.map((tab) => tab.id).join(", ")}. Lass sie weg.`);
    }
    await browser.tabs.remove(tabs.map((tab) => tab.id));
    return { ok: true, closed: tabs.length, _label: L("tool.closed", { tabs: nTabs(tabs.length) }) };
  }

  const HANDLERS = {
    list_tabs: listTabs,
    read_tab: readTab,
    product_details: productDetails,
    focus_tab: focusTab,
    move_tabs: moveTabs,
    group_tabs: groupTabs,
    ungroup_tabs: ungroupTabs,
    update_group: updateGroup,
    move_group: moveGroup,
    close_tabs: closeTabs
  };

  /* Führt ein Werkzeug aus. Gibt { content (für die API), label (für die Anzeige), isError } zurück. */
  async function execute(name, input) {
    const handler = HANDLERS[name];
    if (!handler) return { content: `Unbekanntes Werkzeug: ${name}`, label: L("tool.unknown", { name }), isError: true };
    try {
      const result = await handler(input || {});
      const label = result._label;
      delete result._label;
      return { content: JSON.stringify(result), label, isError: false };
    } catch (error) {
      return { content: error.message || String(error), label: L("tool.error", { error: error.message || error }), isError: true };
    }
  }

  /* ---------- Beschreibung für die Bestätigung ---------- */

  async function describe(name, input) {
    const titleOf = async (tabId) => {
      try {
        const tab = await browser.tabs.get(Number(tabId));
        return `${tab.title || tab.url}${tab.pinned ? L("tool.pinned") : ""}`;
      } catch (_) {
        return `Tab ${tabId}`;
      }
    };
    const groupTitleOf = async (groupId) => {
      try {
        const group = await getGroup(groupId);
        return group.title || L("tool.folder", { id: groupId });
      } catch (_) {
        return L("tool.folder", { id: groupId });
      }
    };
    const tabIds = Array.isArray(input.tabIds) ? input.tabIds : [];
    const details = [];
    const shown = name === "close_tabs" ? 40 : 8;
    for (const id of tabIds.slice(0, shown)) details.push(await titleOf(id));
    if (tabIds.length > shown) details.push(L("tool.more", { count: tabIds.length - shown }));
    const count = nTabs(tabIds.length);
    const position = input.index === -1 ? L("tool.toEnd") : L("tool.toPosition", { index: input.index });

    switch (name) {
      case "move_tabs":
        return { title: L("plan.move", { tabs: count, position }), details };
      case "group_tabs":
        return Number.isInteger(input.groupId)
          ? { title: L("plan.group", { tabs: count, title: await groupTitleOf(input.groupId) }), details }
          : { title: L("plan.newGroup", { tabs: count, title: input.title || L("tool.unnamed") }), details };
      case "close_tabs":
        return { title: L("plan.close", { tabs: count }), details };
      case "ungroup_tabs":
        return { title: L("plan.ungroup", { tabs: count }), details };
      case "update_group": {
        const changes = [];
        if (typeof input.title === "string") changes.push(L("plan.rename", { title: input.title }));
        if (input.color) changes.push(L("plan.color", { color: input.color }));
        if (typeof input.collapsed === "boolean") changes.push(L(input.collapsed ? "plan.collapse" : "plan.expand"));
        return { title: L("plan.updateGroup", { title: await groupTitleOf(input.groupId), changes: changes.join(", ") || L("plan.adjust") }), details: [] };
      }
      case "move_group":
        return { title: L("plan.moveGroup", { title: await groupTitleOf(input.groupId), position }), details: [] };
      default:
        return { title: name, details: [] };
    }
  }

  root.BrowserTools = {
    definitions: DEFINITIONS,
    isWrite: (name) => WRITE_TOOLS.has(name),
    alwaysConfirm: (name) => ALWAYS_CONFIRM.has(name),
    execute,
    describe,
    shortUrl
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.BrowserTools;
})(typeof window !== "undefined" ? window : globalThis);
