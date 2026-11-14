/* Claude Sidebar – Logik des Panels */
(() => {
  const t = I18n.t;
  const MODELS = [
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
    { id: "claude-opus-5-5", label: "Opus 5.5" },
    { id: "claude-haiku-5-5", label: "Haiku 5.5" }
  ];
  const EFFORTS = [
    { id: "", key: "settings.effortDefault" },
    { id: "low", key: "settings.effortLow" },
    { id: "medium", key: "settings.effortMedium" },
    { id: "high", key: "settings.effortHigh" }
  ];
  const MAX_CONVERSATIONS = 200;
  const MAX_TOOL_ROUNDS = 15;
  const MAX_ATTACHMENTS = 6;
  const MAX_PDF_BYTES = 20 * 1024 * 1024;
  const MAX_TEXT_BYTES = 200 * 1024;
  const TEXT_FILE = /\.(txt|md|markdown|csv|tsv|json|xml|html?|css|js|ts|py|ya?ml|toml|ini|log|rtf|tex|bib)$/i;
  const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 5 };
  const REGIONS = {
    ch: "Switzerland (prices in CHF; prefer Swiss shops such as Galaxus, Digitec, Brack, Interdiscount, or shops that deliver to Switzerland)",
    de: "Germany (prices in EUR; German shops)",
    at: "Austria (prices in EUR; Austrian shops or shops that deliver to Austria)",
    eu: "Europe (prices in EUR; shops that deliver within the EU)"
  };
  /* Blendet in Zen/Firefox die Kopfzeile ("Claude ⌄ ✕") nur für diese Sidebar aus. */
  const HEADER_CSS = '#sidebar-box[sidebarcommand="claude-sidebar_louis_local-sidebar-action"] #sidebar-header { display: none !important; }';
  /* context: "page" = aktuelle Seite erzwingen, "none" = ohne Seite. fill = nur ins Eingabefeld schreiben. */
  const COMMANDS = [
    { key: "summary", context: "page" },
    { key: "research", fill: true, context: "none" },
    { key: "compare" },
    { key: "price", context: "page" },
    { key: "find" },
    { key: "cleanup", context: "none" },
    { key: "sort", context: "none" },
    { key: "overview", context: "none" },
    { key: "explain", context: "page" },
    { key: "translate", context: "page" }
  ];
  const SELECTION_PROMPTS = { explain: "prompt.selExplain", translate: "prompt.selTranslate", rewrite: "prompt.selRewrite" };
  const prompt = (key) => t(`prompt.${key}`);

  const element = (id) => document.getElementById(id);
  const ui = {};
  [
    "chatView", "historyView", "settingsView", "messageList", "emptyState", "summarizeButton", "compareButton", "overviewButton",
    "newChatButton", "historyButton", "cleanupButton", "settingsButton", "historyList", "priceButton",
    "uploadButton", "fileInput", "screenshotButton", "regionSelect", "shortcutLabel", "shortcutButton", "copyCssButton",
    "settingsSaved", "settingsNotice", "apiKeyInput", "toggleKeyButton", "defaultModelSelect", "defaultEffortSelect", "customModelInput",
    "languageSelect", "appearanceSelect", "backgroundModeSelect", "backgroundColorInput",
    "webSearchCheckbox", "confirmChangesCheckbox", "profileInput", "customCommandsInput", "clearHistoryButton", "versionLabel",
    "composer", "pageChip", "pageChipLabel", "extraTabChips", "addTabsButton", "tabPicker", "tabPickerSearch", "tabPickerList",
    "suggestBox", "dropOverlay", "promptInput", "sendButton", "modelSelect", "effortSelect", "usageLabel"
  ].forEach((id) => (ui[id] = element(id)));

  const state = {
    settings: {
      apiKey: "",
      defaultModel: MODELS[0].id,
      customModel: "",
      effort: "",
      language: "auto",
      appearance: "auto",
      background: "auto", // "auto" oder "#rrggbb"
      confirmChanges: true,
      webSearch: true,
      region: "ch",
      profile: "",
      customCommands: ""
    },
    conversations: [],
    currentId: null,
    currentModel: MODELS[0].id,
    currentEffort: "",
    effortUnsupported: new Set(), // Modelle, die keine Stufen annehmen
    includePage: true,
    activeTab: null,
    extraTabs: new Map(), // tabId -> title
    attachments: [], // { kind: "image", data, thumb, name } | { kind: "pdf", data, name, size } | { kind: "text", text, name, size }
    selection: "",
    lastActionTime: 0,
    busy: false,
    abortController: null,
    pendingConfirm: null
  };

  /* ---------- Speicher ---------- */

  /* Alte Chats (Version 0.1) auf das neue Format bringen. */
  function migrateConversation(conversation) {
    conversation.sentUrls = conversation.sentUrls || [];
    for (const message of conversation.messages) {
      if (message.role === "assistant" && !message.parts) {
        message.parts = [{ type: "text", text: message.text || "" }];
        delete message.text;
      }
      delete message.streaming;
    }
    if (!conversation.apiMessages) {
      const apiMessages = [];
      const messages = conversation.messages;
      for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        const reply = messages[index + 1];
        const replyText = reply && reply.role === "assistant" && !reply.error ? partsText(reply) : "";
        if (message.role === "user" && replyText) {
          apiMessages.push({ role: "user", content: message.apiText || message.text });
          apiMessages.push({ role: "assistant", content: replyText });
        }
      }
      conversation.apiMessages = apiMessages;
    }
    for (const message of conversation.messages) delete message.apiText;
    return conversation;
  }

  async function loadState() {
    const stored = await browser.storage.local.get(["settings", "conversations", "currentId"]);
    state.settings = Object.assign(state.settings, stored.settings || {});
    state.conversations = (Array.isArray(stored.conversations) ? stored.conversations : []).map(migrateConversation);
    state.currentId = stored.currentId && findConversation(stored.currentId) ? stored.currentId : null;
    const current = currentConversation();
    state.currentModel = (current && current.model) || state.settings.defaultModel;
    state.currentEffort = state.settings.effort || "";
  }

  async function saveConversations() {
    state.conversations.sort((a, b) => b.updatedAt - a.updatedAt);
    state.conversations = state.conversations.slice(0, MAX_CONVERSATIONS);
    await browser.storage.local.set({ conversations: state.conversations, currentId: state.currentId });
  }

  const saveSettings = () => browser.storage.local.set({ settings: state.settings });
  const findConversation = (id) => state.conversations.find((conversation) => conversation.id === id);
  const currentConversation = () => (state.currentId ? findConversation(state.currentId) : null);

  function createConversation(title) {
    const now = Date.now();
    const conversation = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      title: title.slice(0, 80),
      createdAt: now,
      updatedAt: now,
      model: state.currentModel,
      sentUrls: [],
      messages: [],
      apiMessages: []
    };
    state.conversations.unshift(conversation);
    state.currentId = conversation.id;
    return conversation;
  }

  const partsText = (message) =>
    (message.parts || []).filter((part) => part.type === "text").map((part) => part.text).join("\n\n").trim();

  /* ---------- Sprache und Aussehen ---------- */

  function applyLanguage() {
    I18n.setLanguage(state.settings.language);
    I18n.apply(document);
    fillModelSelect(ui.modelSelect, state.currentModel);
    fillEffortSelect(ui.effortSelect, state.currentEffort);
    ui.toggleKeyButton.textContent = t(ui.apiKeyInput.type === "password" ? "settings.show" : "settings.hide");
    ui.clearHistoryButton.textContent = t("settings.clear");
    setBusy(state.busy);
    renderContextChips();
    renderConversation();
    if (!ui.settingsView.hidden) renderSettings();
    if (!ui.historyView.hidden) renderHistory();
  }

  /* Wandelt eine beliebige CSS-Farbe (oder [r, g, b]) in { hex, luminance } um. */
  function parseColor(value) {
    if (!value) return null;
    let red, green, blue;
    if (Array.isArray(value)) {
      [red, green, blue] = value;
    } else {
      const context = document.createElement("canvas").getContext("2d");
      context.fillStyle = "#010203";
      context.fillStyle = String(value);
      const parsed = context.fillStyle;
      if (parsed === "#010203" && String(value).replace(/\s/g, "").toLowerCase() !== "#010203") return null;
      if (parsed.startsWith("#")) {
        red = parseInt(parsed.slice(1, 3), 16);
        green = parseInt(parsed.slice(3, 5), 16);
        blue = parseInt(parsed.slice(5, 7), 16);
      } else {
        const numbers = parsed.match(/[\d.]+/g) || [];
        if (numbers.length < 3 || (numbers.length > 3 && Number(numbers[3]) < 0.5)) return null; // (fast) durchsichtig: unbrauchbar
        [red, green, blue] = numbers.map(Number);
      }
    }
    if (![red, green, blue].every((channel) => Number.isFinite(channel))) return null;
    const hex = "#" + [red, green, blue].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("");
    return { hex, luminance: (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 };
  }

  async function themeBackground() {
    if (!browser.theme || typeof browser.theme.getCurrent !== "function") return null;
    try {
      const theme = await browser.theme.getCurrent();
      const colors = (theme && theme.colors) || {};
      return parseColor(colors.sidebar) || parseColor(colors.frame) || parseColor(colors.toolbar);
    } catch (_) {
      return null;
    }
  }

  /* Hintergrund aus den Einstellungen oder aus dem Browser-Theme; Hell/Dunkel richtet sich nach der Farbe. */
  async function applyAppearance() {
    const root = document.documentElement;
    const custom = /^#[0-9a-f]{6}$/i.test(state.settings.background) ? parseColor(state.settings.background) : null;
    const background = custom || (await themeBackground());
    let scheme = state.settings.appearance;
    if (background) {
      root.style.setProperty("--background", background.hex);
      if (scheme === "auto" || custom) scheme = background.luminance > 0.55 ? "light" : "dark";
    } else {
      root.style.removeProperty("--background");
    }
    if (scheme === "light" || scheme === "dark") root.dataset.scheme = scheme;
    else delete root.dataset.scheme;
  }

  /* ---------- Modelle und Stufen ---------- */

  function availableModels() {
    const list = MODELS.slice();
    const custom = (state.settings.customModel || "").trim();
    if (custom && !list.some((model) => model.id === custom)) list.push({ id: custom, label: custom });
    if (!list.some((model) => model.id === state.currentModel)) list.push({ id: state.currentModel, label: state.currentModel });
    return list;
  }

  function fillSelect(select, options, selectedId) {
    select.replaceChildren(
      ...options.map((entry) => {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = entry.label;
        option.selected = entry.id === selectedId;
        return option;
      })
    );
  }

  const fillModelSelect = (select, selectedId) => fillSelect(select, availableModels(), selectedId);

  function fillEffortSelect(select, selectedId) {
    const inComposer = select === ui.effortSelect;
    fillSelect(
      select,
      EFFORTS.map((effort) => ({ id: effort.id, label: inComposer && !effort.id ? t("ui.effort") : t(effort.key) })),
      selectedId
    );
  }

  /* ---------- Ansichten ---------- */

  function showView(name) {
    for (const view of ["chatView", "historyView", "settingsView"]) ui[view].hidden = view !== name;
    ui.composer.hidden = name !== "chatView";
    ui.historyButton.classList.toggle("is-active", name === "historyView");
    ui.settingsButton.classList.toggle("is-active", name === "settingsView");
    closeTabPicker();
    hideSuggest();
    if (name === "historyView") renderHistory();
    if (name === "settingsView") renderSettings();
  }

  function needApiKey() {
    showView("settingsView");
    ui.settingsNotice.textContent = t("error.needKey");
    ui.settingsNotice.hidden = false;
    ui.apiKeyInput.focus();
  }

  /* ---------- Chat rendern ---------- */

  function renderConversation() {
    const conversation = currentConversation();
    ui.messageList.replaceChildren();
    const messages = conversation ? conversation.messages : [];
    ui.emptyState.hidden = messages.length > 0;
    messages.forEach((message) => ui.messageList.appendChild(buildMessageElement(message)));
    scrollToBottom(true);
  }

  function buildMessageElement(message) {
    const wrapper = document.createElement("div");
    wrapper.className = `message message-${message.role}`;
    if (message.role === "user") {
      if (message.images && message.images.length) {
        const row = document.createElement("div");
        row.className = "message-images";
        message.images.forEach((thumb) => {
          if (!/^data:image\//.test(thumb)) return;
          const image = document.createElement("img");
          image.src = thumb;
          image.alt = "";
          row.appendChild(image);
        });
        wrapper.appendChild(row);
      }
      if (message.files && message.files.length) {
        const row = document.createElement("div");
        row.className = "message-files";
        message.files.forEach((file) => row.appendChild(fileBadge(file)));
        wrapper.appendChild(row);
      }
      wrapper.appendChild(document.createTextNode(message.text));
      if (message.contexts && message.contexts.length) {
        const context = document.createElement("div");
        context.className = "message-context";
        context.textContent = t("msg.with", { list: message.contexts.map((item) => item.title).join(", ") });
        wrapper.appendChild(context);
      }
      return wrapper;
    }
    const body = document.createElement("div");
    body.className = "message-body";
    wrapper.appendChild(body);
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const copyButton = document.createElement("button");
    copyButton.className = "text-button";
    copyButton.textContent = t("msg.copy");
    copyButton.addEventListener("click", () => copyText(partsText(message), copyButton));
    actions.appendChild(copyButton);
    wrapper.appendChild(actions);
    updateAssistantElement(wrapper, message);
    return wrapper;
  }

  function buildConfirmCard(part) {
    const card = document.createElement("div");
    card.className = "confirm-card";
    const title = document.createElement("div");
    title.className = "confirm-card-title";
    title.textContent = t("confirm.title");
    const list = document.createElement("ul");
    for (const item of part.items) {
      const entry = document.createElement("li");
      entry.textContent = item.title;
      if (item.details && item.details.length) {
        const details = document.createElement("ul");
        details.className = "confirm-details";
        item.details.forEach((detail) => {
          const line = document.createElement("li");
          line.textContent = detail;
          details.appendChild(line);
        });
        entry.appendChild(details);
      }
      list.appendChild(entry);
    }
    card.append(title, list);
    if (part.state === "pending") {
      const row = document.createElement("div");
      row.className = "button-row";
      const accept = document.createElement("button");
      accept.className = "primary-button";
      accept.textContent = t("confirm.run");
      accept.addEventListener("click", () => resolveConfirm(true));
      const decline = document.createElement("button");
      decline.className = "soft-button";
      decline.textContent = t("confirm.decline");
      decline.addEventListener("click", () => resolveConfirm(false));
      row.append(accept, decline);
      card.appendChild(row);
    } else {
      const status = document.createElement("div");
      status.className = "confirm-state";
      status.textContent = t(part.state === "accepted" ? "confirm.done" : "confirm.declined");
      card.appendChild(status);
    }
    return card;
  }

  function buildSources(part) {
    const box = document.createElement("div");
    box.className = "sources";
    box.textContent = t("msg.sources");
    const list = document.createElement("ol");
    part.items.forEach((item) => {
      if (!/^https?:\/\//.test(item.url)) return;
      const entry = document.createElement("li");
      const link = document.createElement("a");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.title || item.url;
      link.title = item.url;
      entry.appendChild(link);
      list.appendChild(entry);
    });
    box.appendChild(list);
    return box;
  }

  function updateAssistantElement(wrapper, message) {
    const body = wrapper.querySelector(".message-body");
    body.replaceChildren();
    const parts = message.parts || [];
    parts.forEach((part, index) => {
      if (part.type === "text") {
        const text = document.createElement("div");
        text.className = "message-text";
        text.innerHTML = renderMarkdown(part.text);
        if (message.streaming && index === parts.length - 1) text.classList.add("typing");
        body.appendChild(text);
      } else if (part.type === "tool") {
        const step = document.createElement("div");
        step.className = `tool-step${part.status === "running" ? " is-running" : ""}${part.status === "error" ? " is-error" : ""}`;
        step.textContent = part.label;
        body.appendChild(step);
      } else if (part.type === "confirm") {
        body.appendChild(buildConfirmCard(part));
      } else if (part.type === "sources") {
        body.appendChild(buildSources(part));
      }
    });
    if (message.streaming && (!parts.length || parts[parts.length - 1].type !== "text")) {
      const waiting = document.createElement("div");
      waiting.className = "message-text typing";
      body.appendChild(waiting);
    }
    if (message.error) {
      const error = document.createElement("div");
      error.className = "message-error";
      error.textContent = message.error;
      body.appendChild(error);
    }
  }

  function isNearBottom() {
    const view = ui.chatView;
    return view.scrollHeight - view.scrollTop - view.clientHeight < 80;
  }

  function scrollToBottom(force) {
    if (force || isNearBottom()) ui.chatView.scrollTop = ui.chatView.scrollHeight;
  }

  async function copyText(text, button, labelKey = "msg.copy") {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const helper = document.createElement("textarea");
      helper.value = text;
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    button.textContent = t("msg.copied");
    setTimeout(() => (button.textContent = t(labelKey)), 1200);
  }

  /* ---------- Kontext: aktuelle Seite, weitere Tabs, Bilder, Auswahl ---------- */

  async function refreshActiveTab() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    state.activeTab = tab || null;
    renderContextChips();
  }

  function buildChip(className, title, children, onClick) {
    const chip = document.createElement("button");
    chip.className = className;
    chip.title = title;
    const remove = document.createElement("span");
    remove.className = "chip-remove";
    remove.textContent = "×";
    chip.append(...children, remove);
    chip.addEventListener("click", onClick);
    return chip;
  }

  const FILE_ICONS = {
    pdf: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    text: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 12h6M9 15h6M9 18h3"/></svg>'
  };

  function fileIcon(kind) {
    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.innerHTML = FILE_ICONS[kind] || FILE_ICONS.text; // feste SVGs, kein Nutzerinhalt
    return icon;
  }

  function fileBadge(file) {
    const badge = document.createElement("span");
    badge.className = "file-badge";
    const name = document.createElement("span");
    name.className = "chip-label";
    name.textContent = file.name;
    badge.append(fileIcon(file.kind), name);
    return badge;
  }

  function chipLabel(text) {
    const label = document.createElement("span");
    label.className = "chip-label";
    label.textContent = text;
    return label;
  }

  function renderContextChips() {
    const tab = state.activeTab;
    const readable = tab && TabTools.isReadableUrl(tab.url);
    ui.pageChip.setAttribute("aria-pressed", String(state.includePage && Boolean(readable)));
    ui.pageChip.disabled = !readable;
    ui.pageChipLabel.textContent = readable ? tab.title || t("chip.thisPage") : t("chip.unreadable");
    ui.pageChip.title = readable ? t("chip.pageTitle", { url: tab.url }) : t("chip.unreadableTitle");

    const chips = [...state.extraTabs.entries()].map(([tabId, title]) =>
      buildChip("chip chip-tab", t("chip.remove"), [chipLabel(title)], () => {
        state.extraTabs.delete(tabId);
        renderContextChips();
      })
    );
    state.attachments.forEach((attachment, index) => {
      const remove = () => {
        state.attachments.splice(index, 1);
        renderContextChips();
      };
      if (attachment.kind === "image") {
        const preview = document.createElement("img");
        preview.src = attachment.thumb;
        preview.alt = "";
        chips.push(buildChip("chip chip-tab chip-image", t("chip.removeAttachment", { name: attachment.name }), [preview], remove));
      } else {
        chips.push(buildChip("chip chip-tab chip-file", t("chip.removeAttachment", { name: attachment.name }), [fileIcon(attachment.kind), chipLabel(attachment.name)], remove));
      }
    });
    if (state.selection) {
      chips.push(
        buildChip("chip chip-tab", state.selection.slice(0, 300), [chipLabel(t("chip.selection", { count: state.selection.length }))], () => {
          state.selection = "";
          renderContextChips();
        })
      );
    }
    ui.extraTabChips.replaceChildren(...chips);
  }

  async function openTabPicker() {
    const tabs = await browser.tabs.query({ currentWindow: true });
    const candidates = tabs.filter((tab) => !tab.active && !tab.hidden && TabTools.isReadableUrl(tab.url));
    ui.tabPickerList.replaceChildren(
      ...candidates.map((tab) => {
        const item = document.createElement("li");
        item.dataset.search = `${tab.title} ${tab.url}`.toLowerCase();
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = state.extraTabs.has(tab.id);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) state.extraTabs.set(tab.id, tab.title || tab.url);
          else state.extraTabs.delete(tab.id);
          renderContextChips();
        });
        label.appendChild(checkbox);
        if (tab.favIconUrl && tab.favIconUrl.startsWith("data:")) {
          const icon = document.createElement("img");
          icon.src = tab.favIconUrl;
          icon.alt = "";
          label.appendChild(icon);
        }
        const title = document.createElement("span");
        title.className = "tab-title";
        title.textContent = tab.title || tab.url;
        label.appendChild(title);
        item.appendChild(label);
        return item;
      })
    );
    if (!candidates.length) {
      const empty = document.createElement("li");
      empty.className = "hint";
      empty.style.padding = "8px";
      empty.textContent = t("picker.empty");
      ui.tabPickerList.appendChild(empty);
    }
    ui.tabPickerSearch.value = "";
    ui.tabPicker.hidden = false;
    ui.tabPickerSearch.focus();
  }

  function closeTabPicker() {
    ui.tabPicker.hidden = true;
  }

  async function collectPages({ forcePage = false, noPage = false } = {}) {
    const conversation = currentConversation();
    const alreadySent = new Set(conversation ? conversation.sentUrls : []);
    const tabsToRead = [];

    const activeReadable = state.activeTab && TabTools.isReadableUrl(state.activeTab.url);
    if (forcePage && !activeReadable) throw new Error(t("error.pageUnreadable"));
    if (!noPage && activeReadable && (state.includePage || forcePage) && !alreadySent.has(state.activeTab.url)) {
      tabsToRead.push(state.activeTab);
    }
    for (const tabId of state.extraTabs.keys()) {
      try {
        const tab = await browser.tabs.get(tabId);
        if (!alreadySent.has(tab.url) && !tabsToRead.some((existing) => existing.id === tab.id)) tabsToRead.push(tab);
      } catch (_) {
        state.extraTabs.delete(tabId); // Tab wurde geschlossen
      }
    }
    const pages = [];
    for (const tab of tabsToRead) pages.push(await TabTools.extractTab(tab));
    return pages;
  }

  /* ---------- Bestätigung ---------- */

  function waitForConfirm() {
    return new Promise((resolve) => {
      state.pendingConfirm = resolve;
    });
  }

  function resolveConfirm(approved) {
    if (!state.pendingConfirm) return;
    const resolve = state.pendingConfirm;
    state.pendingConfirm = null;
    resolve(approved);
  }

  /* ---------- Senden mit Werkzeug-Schleife ---------- */

  function buildTools() {
    return state.settings.webSearch === false ? BrowserTools.definitions : BrowserTools.definitions.concat([WEB_SEARCH_TOOL]);
  }

  function buildSystemPrompt() {
    const languageName = I18n.language === "de" ? "German" : "English";
    let system = `${ClaudeApi.SYSTEM_PROMPT}\n\nThe interface language is ${languageName}. Use it when the user's own language is unclear and for short notes about tab actions.`;
    system += `\nThe user's shopping region: ${REGIONS[state.settings.region] || REGIONS.ch}. Today is ${new Date().toISOString().slice(0, 10)}.`;
    const profile = (state.settings.profile || "").trim();
    if (profile) {
      system += `\n\nThe user wrote this about themselves and how they want answers. Follow it where it applies:\n<user_profile>\n${profile.slice(0, 6000)}\n</user_profile>`;
    }
    return system;
  }

  /* Ruft die API auf. Lehnt das Modell die Stufe ab, wird einmal ohne Stufe wiederholt und das Modell gemerkt. */
  async function callApi(parameters) {
    const effort = state.currentEffort && !state.effortUnsupported.has(state.currentModel) ? state.currentEffort : "";
    try {
      return await ClaudeApi.streamMessage(Object.assign({}, parameters, { effort }));
    } catch (error) {
      if (!effort || error.status !== 400 || !/effort|output_config/i.test(error.detail || error.message || "")) throw error;
      state.effortUnsupported.add(state.currentModel);
      flash(t("flash.effortUnsupported"));
      return ClaudeApi.streamMessage(Object.assign({}, parameters, { effort: "" }));
    }
  }

  /* Websuche läuft bei Anthropic: Schritte beschriften und Quellen einsammeln. */
  function noteServerTools(content, parts, sources) {
    for (const block of content) {
      if (block.type === "server_tool_use") {
        const step = parts.find((part) => part.type === "tool" && part.id === block.id);
        if (step) {
          step.status = "done";
          step.label = t("step.webSearch", { query: (block.input && block.input.query) || "" });
        }
      } else if (block.type === "web_search_tool_result" && block.content && !Array.isArray(block.content)) {
        const step = parts.find((part) => part.type === "tool" && part.id === block.tool_use_id);
        if (step) {
          step.status = "error";
          step.label = t("step.webSearchFailed");
        }
      } else if (block.type === "text" && block.citations) {
        for (const citation of block.citations) {
          if (citation.url && /^https?:\/\//.test(citation.url) && !sources.has(citation.url)) sources.set(citation.url, citation.title || citation.url);
        }
      }
    }
  }

  function addSources(parts, sources) {
    if (sources.size) parts.push({ type: "sources", items: [...sources.entries()].slice(0, 12).map(([url, title]) => ({ url, title })) });
  }

  async function runAgent(conversation, assistantMessage, render, usage) {
    const parts = assistantMessage.parts;
    const sources = new Map();
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let textPart = null;
      const result = await callApi({
        apiKey: state.settings.apiKey,
        model: state.currentModel,
        messages: conversation.apiMessages,
        tools: buildTools(),
        system: buildSystemPrompt(),
        signal: state.abortController.signal,
        onText: (delta) => {
          if (!textPart) {
            textPart = { type: "text", text: "" };
            parts.push(textPart);
          }
          textPart.text += delta;
          render();
        },
        onToolStart: (block) => {
          textPart = null;
          parts.push({ type: "tool", id: block.id, name: block.name, label: t(`step.${block.name}`), status: "running" });
          render();
        }
      });
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;

      if (result.content.length) conversation.apiMessages.push({ role: "assistant", content: result.content });
      noteServerTools(result.content, parts, sources);
      if (result.stopReason === "max_tokens") parts.push({ type: "text", text: t("note.truncated") });
      if (result.stopReason === "pause_turn" && result.content.length) continue;
      if (result.stopReason !== "tool_use") {
        addSources(parts, sources);
        return;
      }

      const toolUses = result.content.filter((block) => block.type === "tool_use");
      const writes = toolUses.filter((block) => BrowserTools.isWrite(block.name));
      let approved = true;
      if (writes.length && (state.settings.confirmChanges !== false || writes.some((block) => BrowserTools.alwaysConfirm(block.name)))) {
        const items = [];
        for (const block of writes) items.push(await BrowserTools.describe(block.name, block.input));
        const confirmPart = { type: "confirm", items, state: "pending" };
        parts.push(confirmPart);
        render();
        approved = await waitForConfirm();
        confirmPart.state = approved ? "accepted" : "declined";
        render();
      }

      const toolResults = [];
      for (const block of toolUses) {
        let step = parts.find((part) => part.type === "tool" && part.id === block.id);
        if (!step) {
          step = { type: "tool", id: block.id, name: block.name, label: "", status: "running" };
          parts.push(step);
        }
        if (state.abortController.signal.aborted || (BrowserTools.isWrite(block.name) && !approved)) {
          step.status = "error";
          step.label = t(state.abortController.signal.aborted ? "step.stopped" : "confirm.declined");
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "The user declined this change.", is_error: true });
          continue;
        }
        const outcome = block.parseError
          ? { content: "Invalid tool input JSON.", label: t("step.invalid"), isError: true }
          : await BrowserTools.execute(block.name, block.input);
        step.status = outcome.isError ? "error" : "done";
        step.label = outcome.label;
        const toolResult = { type: "tool_result", tool_use_id: block.id, content: outcome.content };
        if (outcome.isError) toolResult.is_error = true;
        toolResults.push(toolResult);
        render();
      }
      conversation.apiMessages.push({ role: "user", content: toolResults });
      if (state.abortController.signal.aborted) throw new DOMException("stopped", "AbortError");
    }
    parts.push({ type: "text", text: t("note.tooManySteps") });
  }

  async function sendMessage(userText, options = {}) {
    const text = (userText || "").trim();
    if (!text || state.busy) return;
    if (!state.settings.apiKey) {
      needApiKey();
      return;
    }

    setBusy(true);
    closeTabPicker();

    let pages = [];
    let contextError = null;
    try {
      pages = await collectPages(options);
    } catch (error) {
      contextError = error.message;
    }

    let conversation = currentConversation();
    if (!conversation) {
      const label = options.display || text;
      const title = pages[0] && options.display ? `${label}: ${pages[0].title}` : label;
      conversation = createConversation(title);
    }
    conversation.model = state.currentModel;

    const documents = pages.length ? TabTools.buildDocumentsBlock(pages) : "";
    const attachments = contextError ? [] : state.attachments;
    const selection = contextError ? "" : state.selection;
    if (!contextError) {
      state.attachments = [];
      state.selection = "";
      renderContextChips();
    }
    const images = attachments.filter((attachment) => attachment.kind === "image");
    const files = attachments.filter((attachment) => attachment.kind !== "image");
    const contexts = pages.map((page) => ({ title: page.title, url: page.url }));
    if (selection) contexts.push({ title: t("msg.selection") });
    /* display: kurzer Text für die Sprechblase (z. B. „/vergleichen“), text geht an Claude */
    const userMessage = { role: "user", text: options.display || text, contexts };
    if (images.length) userMessage.images = images.map((image) => image.thumb);
    if (files.length) userMessage.files = files.map((file) => ({ name: file.name, kind: file.kind }));
    const assistantMessage = { role: "assistant", parts: [], streaming: true };
    conversation.messages.push(userMessage, assistantMessage);
    conversation.updatedAt = Date.now();

    ui.emptyState.hidden = true;
    ui.messageList.appendChild(buildMessageElement(userMessage));
    const assistantElement = buildMessageElement(assistantMessage);
    ui.messageList.appendChild(assistantElement);
    scrollToBottom(true);

    if (contextError) {
      delete assistantMessage.streaming;
      assistantMessage.error = t("error.context", { error: contextError });
      updateAssistantElement(assistantElement, assistantMessage);
      await saveConversations();
      setBusy(false);
      return;
    }

    let renderScheduled = false;
    const render = () => {
      if (renderScheduled) return;
      renderScheduled = true;
      requestAnimationFrame(() => {
        renderScheduled = false;
        const stickToBottom = isNearBottom();
        updateAssistantElement(assistantElement, assistantMessage);
        if (stickToBottom) scrollToBottom(true);
      });
    };

    const snapshotLength = conversation.apiMessages.length;
    const selectionBlock = selection ? `<selected_text>\n${selection}\n</selected_text>` : "";
    const apiText = [documents, selectionBlock, text].filter(Boolean).join("\n\n");
    const attachmentBlocks = attachments.map((attachment) => {
      if (attachment.kind === "image") return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: attachment.data } };
      if (attachment.kind === "pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data: attachment.data }, title: attachment.name.slice(0, 200) };
      return { type: "text", text: `<file name="${attachment.name.replace(/"/g, "'")}">\n${attachment.text}\n</file>` };
    });
    conversation.apiMessages.push({ role: "user", content: attachmentBlocks.length ? attachmentBlocks.concat([{ type: "text", text: apiText }]) : apiText });
    const usage = { inputTokens: 0, outputTokens: 0 };
    state.abortController = new AbortController();
    try {
      await runAgent(conversation, assistantMessage, render, usage);
      conversation.sentUrls.push(...pages.map((page) => page.url));
    } catch (error) {
      const nothingCompleted = conversation.apiMessages.length === snapshotLength + 1;
      if (error.name === "AbortError") {
        const partial = partsText(assistantMessage);
        if (nothingCompleted && partial) {
          conversation.apiMessages.push({ role: "assistant", content: partial });
          conversation.sentUrls.push(...pages.map((page) => page.url));
        } else if (nothingCompleted) {
          conversation.apiMessages.length = snapshotLength;
        }
        assistantMessage.parts.push({ type: "text", text: t("note.stopped") });
      } else {
        if (nothingCompleted) conversation.apiMessages.length = snapshotLength;
        assistantMessage.error = error.message || t("error.unknown");
        if (/web_search/i.test(assistantMessage.error)) assistantMessage.error += ` ${t("error.webSearch")}`;
      }
    } finally {
      resolveConfirm(false);
      delete assistantMessage.streaming;
      state.abortController = null;
      conversation.updatedAt = Date.now();
      ui.usageLabel.textContent = t("usage", { in: formatNumber(usage.inputTokens), out: formatNumber(usage.outputTokens) });
      updateAssistantElement(assistantElement, assistantMessage);
      scrollToBottom(false);
      await saveConversations();
      setBusy(false);
    }
  }

  function setBusy(busy) {
    state.busy = busy;
    ui.sendButton.classList.toggle("is-busy", busy);
    ui.sendButton.title = t(busy ? "input.stop" : "input.send");
    ui.sendButton.setAttribute("aria-label", ui.sendButton.title);
    for (const button of [ui.summarizeButton, ui.overviewButton, ui.compareButton, ui.priceButton, ui.cleanupButton]) button.disabled = busy;
  }

  const formatNumber = (value) => new Intl.NumberFormat(I18n.language === "de" ? "de-CH" : "en").format(value || 0);

  function autoGrow() {
    ui.promptInput.style.height = "auto";
    ui.promptInput.style.height = `${Math.min(ui.promptInput.scrollHeight, 180)}px`;
  }

  function startNewChat() {
    if (state.busy) return;
    state.currentId = null;
    state.currentModel = state.settings.defaultModel;
    state.currentEffort = state.settings.effort || "";
    fillModelSelect(ui.modelSelect, state.currentModel);
    fillEffortSelect(ui.effortSelect, state.currentEffort);
    state.extraTabs.clear();
    state.attachments = [];
    state.selection = "";
    state.includePage = true;
    ui.usageLabel.textContent = "";
    renderContextChips();
    renderConversation();
    browser.storage.local.set({ currentId: null });
    showView("chatView");
    ui.promptInput.focus();
  }

  /* ---------- Verlauf ---------- */

  function renderHistory() {
    const sorted = state.conversations.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    if (!sorted.length) {
      const empty = document.createElement("li");
      empty.className = "hint";
      empty.textContent = t("history.empty");
      ui.historyList.replaceChildren(empty);
      return;
    }
    const dateFormat = new Intl.DateTimeFormat(I18n.language === "de" ? "de-CH" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    ui.historyList.replaceChildren(
      ...sorted.map((conversation) => {
        const item = document.createElement("li");
        item.className = "history-item";
        const open = document.createElement("button");
        open.className = "history-open";
        const title = document.createElement("span");
        title.className = "history-title";
        title.textContent = conversation.title || t("history.untitled");
        const date = document.createElement("span");
        date.className = "history-date";
        date.textContent = dateFormat.format(conversation.updatedAt);
        open.append(title, date);
        open.addEventListener("click", () => {
          if (state.busy) return;
          state.currentId = conversation.id;
          state.currentModel = conversation.model || state.settings.defaultModel;
          fillModelSelect(ui.modelSelect, state.currentModel);
          ui.usageLabel.textContent = "";
          browser.storage.local.set({ currentId: conversation.id });
          renderConversation();
          showView("chatView");
        });
        const remove = document.createElement("button");
        remove.className = "icon-button history-delete";
        remove.title = t("history.delete");
        remove.textContent = "×";
        remove.addEventListener("click", async () => {
          if (state.busy && state.currentId === conversation.id) return;
          state.conversations = state.conversations.filter((entry) => entry.id !== conversation.id);
          if (state.currentId === conversation.id) state.currentId = null;
          await saveConversations();
          renderHistory();
          renderConversation();
        });
        item.append(open, remove);
        return item;
      })
    );
  }

  /* ---------- Einstellungen (speichern sich bei jeder Änderung selbst) ---------- */

  function renderSettings() {
    const settings = state.settings;
    ui.settingsNotice.hidden = Boolean(settings.apiKey) || !ui.settingsNotice.textContent;
    ui.apiKeyInput.value = settings.apiKey || "";
    ui.customModelInput.value = settings.customModel || "";
    fillModelSelect(ui.defaultModelSelect, settings.defaultModel);
    fillEffortSelect(ui.defaultEffortSelect, settings.effort || "");
    ui.languageSelect.value = ["de", "en"].includes(settings.language) ? settings.language : "auto";
    ui.appearanceSelect.value = ["light", "dark"].includes(settings.appearance) ? settings.appearance : "auto";
    const customBackground = /^#[0-9a-f]{6}$/i.test(settings.background);
    ui.backgroundModeSelect.value = customBackground ? "custom" : "auto";
    ui.backgroundColorInput.hidden = !customBackground;
    if (customBackground) ui.backgroundColorInput.value = settings.background;
    ui.confirmChangesCheckbox.checked = settings.confirmChanges !== false;
    ui.webSearchCheckbox.checked = settings.webSearch !== false;
    ui.regionSelect.value = REGIONS[settings.region] ? settings.region : "ch";
    renderShortcut();
    ui.profileInput.value = settings.profile || "";
    ui.customCommandsInput.value = settings.customCommands || "";
    ui.versionLabel.textContent = `Claude Sidebar ${browser.runtime && browser.runtime.getManifest ? browser.runtime.getManifest().version : ""}`;
  }

  let savedTimer = null;
  async function saveSettingsFromForm() {
    const settings = state.settings;
    const before = { language: settings.language, appearance: settings.appearance, background: settings.background };
    settings.apiKey = ui.apiKeyInput.value.trim();
    settings.customModel = ui.customModelInput.value.trim();
    settings.defaultModel = ui.defaultModelSelect.value || settings.defaultModel;
    settings.effort = ui.defaultEffortSelect.value;
    settings.language = ui.languageSelect.value;
    settings.appearance = ui.appearanceSelect.value;
    ui.backgroundColorInput.hidden = ui.backgroundModeSelect.value !== "custom";
    settings.background = ui.backgroundModeSelect.value === "custom" ? ui.backgroundColorInput.value : "auto";
    settings.confirmChanges = ui.confirmChangesCheckbox.checked;
    settings.webSearch = ui.webSearchCheckbox.checked;
    settings.region = ui.regionSelect.value;
    settings.profile = ui.profileInput.value.trim();
    settings.customCommands = ui.customCommandsInput.value.trim();
    await saveSettings();

    if (!currentConversation()) state.currentModel = settings.defaultModel;
    state.currentEffort = settings.effort;
    if (settings.apiKey) ui.settingsNotice.hidden = true;
    if (before.appearance !== settings.appearance || before.background !== settings.background) await applyAppearance();
    if (before.language !== settings.language) applyLanguage();
    else {
      fillModelSelect(ui.modelSelect, state.currentModel);
      fillModelSelect(ui.defaultModelSelect, settings.defaultModel);
      fillEffortSelect(ui.effortSelect, state.currentEffort);
    }
    ui.settingsSaved.textContent = t("settings.saved");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (ui.settingsSaved.textContent = ""), 1500);
  }

  /* Tastenkürzel zum Ein- und Ausblenden der Sidebar */
  async function renderShortcut() {
    let shortcut = "";
    try {
      const commands = await browser.commands.getAll();
      const command = commands.find((entry) => entry.name === "_execute_sidebar_action");
      shortcut = command && command.shortcut ? command.shortcut : "";
    } catch (_) {
      shortcut = "";
    }
    ui.shortcutLabel.textContent = shortcut ? shortcut.replace(/\+/g, " + ") : t("settings.noShortcut");
    ui.shortcutButton.hidden = !(browser.commands && typeof browser.commands.openShortcutSettings === "function");
  }

  let clearConfirmTimer = null;
  async function handleClearHistory() {
    if (state.busy) return;
    if (!clearConfirmTimer) {
      ui.clearHistoryButton.textContent = t("settings.clearConfirm");
      clearConfirmTimer = setTimeout(() => {
        clearConfirmTimer = null;
        ui.clearHistoryButton.textContent = t("settings.clear");
      }, 3000);
      return;
    }
    clearTimeout(clearConfirmTimer);
    clearConfirmTimer = null;
    state.conversations = [];
    state.currentId = null;
    await saveConversations();
    ui.clearHistoryButton.textContent = t("settings.cleared");
    setTimeout(() => (ui.clearHistoryButton.textContent = t("settings.clear")), 1500);
    renderConversation();
  }

  /* ---------- Befehle (/) und Tab-Erwähnungen (@) ---------- */

  const suggest = { mode: null, items: [], index: 0, tabs: null };

  function allCommands() {
    const custom = (state.settings.customCommands || "")
      .split("\n")
      .map((line) => {
        const match = line.match(/^\s*\/?([^\s:]+)\s*:\s*(.+)$/);
        return match ? { name: match[1].toLowerCase(), prompt: match[2].trim() } : null;
      })
      .filter(Boolean);
    const customNames = new Set(custom.map((command) => command.name));
    const builtIn = COMMANDS.map((command) => Object.assign({}, command, { name: t(`command.${command.key}`), prompt: prompt(command.key) }));
    return custom.concat(builtIn.filter((command) => !customNames.has(command.name)));
  }

  function runCommand(command, extra) {
    const options = command.context === "page" ? { forcePage: true } : command.context === "none" ? { noPage: true } : {};
    options.display = `/${command.name}${extra ? ` ${extra}` : ""}`;
    sendMessage(extra ? `${command.prompt} ${extra}` : command.prompt, options);
  }

  async function updateSuggest() {
    const value = ui.promptInput.value;
    const slash = value.match(/^\/(\S*)$/);
    const mention = value.match(/(?:^|\s)@(\S*)$/);
    if (slash) {
      const query = slash[1].toLowerCase();
      suggest.mode = "command";
      suggest.items = allCommands()
        .filter((command) => command.name.includes(query))
        .map((command) => ({ label: `/${command.name}`, hint: command.prompt, command }));
    } else if (mention) {
      if (!suggest.tabs) {
        const tabs = await browser.tabs.query({ currentWindow: true });
        suggest.tabs = tabs.filter((tab) => !tab.hidden && !tab.active && TabTools.isReadableUrl(tab.url));
      }
      const query = mention[1].toLowerCase();
      suggest.mode = "tab";
      suggest.items = suggest.tabs
        .filter((tab) => `${tab.title} ${tab.url}`.toLowerCase().includes(query))
        .slice(0, 8)
        .map((tab) => ({ label: tab.title || tab.url, hint: BrowserTools.shortUrl(tab.url), tab }));
    } else {
      hideSuggest();
      return;
    }
    suggest.index = 0;
    renderSuggest();
  }

  function renderSuggest() {
    if (!suggest.mode || !suggest.items.length) {
      ui.suggestBox.hidden = true;
      return;
    }
    ui.suggestBox.replaceChildren(
      ...suggest.items.map((item, index) => {
        const entry = document.createElement("li");
        entry.className = `suggest-item${index === suggest.index ? " is-active" : ""}`;
        const label = document.createElement("span");
        label.className = "suggest-label";
        label.textContent = item.label;
        const hint = document.createElement("span");
        hint.className = "suggest-hint";
        hint.textContent = item.hint;
        entry.append(label, hint);
        entry.addEventListener("mousedown", (event) => {
          event.preventDefault();
          pickSuggest(item);
        });
        return entry;
      })
    );
    ui.suggestBox.hidden = false;
    const active = ui.suggestBox.querySelector(".is-active");
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  }

  function hideSuggest() {
    suggest.mode = null;
    suggest.items = [];
    suggest.tabs = null;
    ui.suggestBox.hidden = true;
  }

  function pickSuggest(item) {
    if (item.command) {
      hideSuggest();
      if (item.command.fill) {
        ui.promptInput.value = item.command.prompt;
        autoGrow();
        ui.promptInput.focus();
      } else if (!state.busy) {
        ui.promptInput.value = "";
        autoGrow();
        runCommand(item.command, "");
      }
    } else if (item.tab) {
      state.extraTabs.set(item.tab.id, item.tab.title || item.tab.url);
      ui.promptInput.value = ui.promptInput.value.replace(/@\S*$/, "");
      hideSuggest();
      renderContextChips();
      ui.promptInput.focus();
    }
  }

  /* ---------- Bilder ---------- */

  let flashTimer = null;
  function flash(text) {
    ui.usageLabel.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      if (ui.usageLabel.textContent === text) ui.usageLabel.textContent = "";
    }, 3000);
  }

  function drawToJpeg(bitmap, maxSide, quality) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  }

  async function loadBitmap(source) {
    if (typeof source !== "string") return createImageBitmap(source);
    /* Pinterest liefert in Übersichten nur kleine Vorschauen: zuerst die grössere Version probieren. */
    const candidates = /\/\/i\.pinimg\.com\/\d+x\d*\//.test(source)
      ? [source.replace(/(\/\/i\.pinimg\.com\/)[^/]+\//, "$1736x/"), source]
      : [source];
    let lastError = null;
    for (const url of candidates) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await createImageBitmap(await response.blob());
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  function roomForAttachment() {
    if (state.attachments.length < MAX_ATTACHMENTS) return true;
    flash(t("flash.maxAttachments", { count: MAX_ATTACHMENTS }));
    return false;
  }

  /* Nimmt eine Datei oder eine Bild-URL, verkleinert sie und hängt sie an die nächste Nachricht. */
  async function addImage(source, name) {
    if (!roomForAttachment()) return false;
    try {
      const bitmap = await loadBitmap(source);
      const full = drawToJpeg(bitmap, 1568, 0.85);
      const fallbackName = typeof source === "string" && /^https?:/.test(source) ? source.split(/[?#]/)[0].split("/").pop() : t("chip.image");
      state.attachments.push({ kind: "image", data: full.split(",")[1], thumb: drawToJpeg(bitmap, 160, 0.7), name: name || (source && source.name) || fallbackName || t("chip.image") });
      renderContextChips();
      return true;
    } catch (_) {
      return false;
    }
  }

  const readAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const isSupportedFile = (file) => file.type.startsWith("image/") || file.type === "application/pdf" || /\.pdf$/i.test(file.name) || file.type.startsWith("text/") || TEXT_FILE.test(file.name);

  /* Bilder, PDFs und Textdateien (Upload-Knopf, Reinziehen, Einfügen). */
  async function addFile(file) {
    if (file.type.startsWith("image/")) {
      if (await addImage(file, file.name)) return true;
      flash(t("flash.imageFailed"));
      return false;
    }
    if (!roomForAttachment()) return false;
    try {
      if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        if (file.size > MAX_PDF_BYTES) {
          flash(t("flash.fileTooBig", { name: file.name, size: "20 MB" }));
          return false;
        }
        const dataUrl = await readAsDataUrl(file);
        state.attachments.push({ kind: "pdf", data: String(dataUrl).split(",")[1], name: file.name, size: file.size });
      } else if (file.type.startsWith("text/") || TEXT_FILE.test(file.name)) {
        if (file.size > MAX_TEXT_BYTES) {
          flash(t("flash.fileTooBig", { name: file.name, size: "200 KB" }));
          return false;
        }
        state.attachments.push({ kind: "text", text: await file.text(), name: file.name, size: file.size });
      } else {
        flash(t("flash.unsupported", { name: file.name }));
        return false;
      }
      renderContextChips();
      return true;
    } catch (_) {
      flash(t("flash.fileFailed", { name: file.name }));
      return false;
    }
  }

  async function addFiles(files) {
    let added = 0;
    for (const file of files) if (await addFile(file)) added++;
    return added;
  }

  /* Screenshot des sichtbaren Bereichs der aktuellen Seite */
  async function addScreenshot() {
    try {
      const tab = state.activeTab;
      const dataUrl = await browser.tabs.captureVisibleTab(tab ? tab.windowId : undefined, { format: "jpeg", quality: 85 });
      const title = tab && tab.title ? tab.title.slice(0, 40) : "";
      if (!(await addImage(dataUrl, title ? t("chip.screenshotOf", { title }) : t("chip.screenshot")))) flash(t("flash.screenshotFailed"));
    } catch (_) {
      flash(t("flash.screenshotFailed"));
    }
    ui.promptInput.focus();
  }

  function imageSourcesFromTransfer(transfer) {
    const files = [...transfer.files].filter(isSupportedFile);
    if (files.length) return files;
    const html = transfer.getData("text/html");
    if (html) {
      const image = new DOMParser().parseFromString(html, "text/html").querySelector("img[src]");
      const source = image && image.getAttribute("src");
      if (source && /^(https?:\/\/|data:image\/)/.test(source)) return [source];
    }
    const uri = (transfer.getData("text/uri-list") || transfer.getData("text/plain") || "").split("\n")[0].trim();
    return /^https?:\/\//.test(uri) ? [uri] : [];
  }

  async function handlePaste(event) {
    const transfer = event.clipboardData;
    if (!transfer) return;
    const files = [...transfer.files].filter(isSupportedFile);
    const text = (transfer.getData("text/plain") || "").trim();
    const isImageLink = /^https?:\/\/\S+\.(png|jpe?g|webp|gif|avif)(\?\S*)?$/i.test(text);
    if (!files.length && !isImageLink) return;
    event.preventDefault();
    if (files.length) await addFiles(files);
    else if (!(await addImage(text))) flash(t("flash.imageFailed"));
  }

  /* ---------- Rechtsklick-Menü (kommt vom Hintergrundskript) ---------- */

  async function handlePendingAction(action) {
    if (!action || action.time === state.lastActionTime || Date.now() - action.time > 30000) return;
    state.lastActionTime = action.time;
    await browser.storage.local.remove("pendingAction");
    if (state.busy) return;
    showView("chatView");
    if (action.imageUrl) {
      if (!(await addImage(action.imageUrl))) {
        flash(t("flash.imageFailed"));
        return;
      }
      if (action.kind === "find") sendMessage(prompt("find"));
      else ui.promptInput.focus();
      return;
    }
    if (!action.text) return;
    state.selection = action.text;
    renderContextChips();
    if (SELECTION_PROMPTS[action.kind]) sendMessage(t(SELECTION_PROMPTS[action.kind]), { noPage: true });
    else ui.promptInput.focus();
  }

  /* ---------- Events ---------- */

  function bindEvents() {
    ui.newChatButton.addEventListener("click", startNewChat);
    ui.historyButton.addEventListener("click", () => showView(ui.historyView.hidden ? "historyView" : "chatView"));
    ui.settingsButton.addEventListener("click", () => showView(ui.settingsView.hidden ? "settingsView" : "chatView"));
    ui.cleanupButton.addEventListener("click", () => {
      showView("chatView");
      sendMessage(prompt("cleanup"), { noPage: true, display: `/${t("command.cleanup")}` });
    });
    document.querySelectorAll("[data-close-view]").forEach((button) => button.addEventListener("click", () => showView("chatView")));

    ui.summarizeButton.addEventListener("click", () => sendMessage(prompt("summary"), { forcePage: true, display: t("empty.summarize") }));
    ui.overviewButton.addEventListener("click", () => sendMessage(prompt("overview"), { noPage: true, display: t("empty.overview") }));
    ui.compareButton.addEventListener("click", () => sendMessage(prompt("compare"), { display: t("empty.compare") }));
    ui.priceButton.addEventListener("click", () => sendMessage(prompt("price"), { forcePage: true, display: t("empty.price") }));

    /* Anhänge: Upload-Knopf und Screenshot */
    ui.uploadButton.addEventListener("click", () => ui.fileInput.click());
    ui.fileInput.addEventListener("change", async () => {
      const files = [...ui.fileInput.files];
      ui.fileInput.value = "";
      if (files.length) await addFiles(files);
      ui.promptInput.focus();
    });
    ui.screenshotButton.addEventListener("click", addScreenshot);

    ui.pageChip.addEventListener("click", () => {
      state.includePage = !state.includePage;
      renderContextChips();
    });
    ui.addTabsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (ui.tabPicker.hidden) openTabPicker();
      else closeTabPicker();
    });
    ui.tabPickerSearch.addEventListener("input", () => {
      const query = ui.tabPickerSearch.value.toLowerCase();
      ui.tabPickerList.querySelectorAll("li[data-search]").forEach((item) => {
        item.hidden = !item.dataset.search.includes(query);
      });
    });
    document.addEventListener("click", (event) => {
      if (!ui.tabPicker.hidden && !ui.tabPicker.contains(event.target) && event.target !== ui.addTabsButton) closeTabPicker();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeTabPicker();
        hideSuggest();
      }
    });

    ui.promptInput.addEventListener("input", () => {
      autoGrow();
      updateSuggest();
    });
    ui.promptInput.addEventListener("blur", () => setTimeout(hideSuggest, 150));
    ui.promptInput.addEventListener("paste", handlePaste);
    ui.promptInput.addEventListener("keydown", (event) => {
      if (suggest.mode && suggest.items.length) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          suggest.index = (suggest.index + step + suggest.items.length) % suggest.items.length;
          renderSuggest();
          return;
        }
        if ((event.key === "Enter" && !event.shiftKey && !event.isComposing) || event.key === "Tab") {
          event.preventDefault();
          pickSuggest(suggest.items[suggest.index]);
          return;
        }
      }
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submitPrompt();
      }
    });
    ui.sendButton.addEventListener("click", () => {
      if (state.busy && state.abortController) {
        state.abortController.abort();
        resolveConfirm(false);
      } else {
        submitPrompt();
      }
    });
    ui.modelSelect.addEventListener("change", () => {
      state.currentModel = ui.modelSelect.value;
    });
    ui.effortSelect.addEventListener("change", () => {
      state.currentEffort = ui.effortSelect.value;
    });

    /* Einstellungen */
    ui.toggleKeyButton.addEventListener("click", (event) => {
      event.preventDefault();
      const hidden = ui.apiKeyInput.type === "password";
      ui.apiKeyInput.type = hidden ? "text" : "password";
      ui.toggleKeyButton.textContent = t(hidden ? "settings.hide" : "settings.show");
    });
    for (const control of [
      ui.apiKeyInput, ui.customModelInput, ui.defaultModelSelect, ui.defaultEffortSelect, ui.languageSelect, ui.appearanceSelect,
      ui.backgroundModeSelect, ui.backgroundColorInput, ui.webSearchCheckbox, ui.regionSelect, ui.confirmChangesCheckbox, ui.profileInput, ui.customCommandsInput
    ]) {
      control.addEventListener("change", saveSettingsFromForm);
    }
    ui.clearHistoryButton.addEventListener("click", handleClearHistory);
    ui.shortcutButton.addEventListener("click", () => {
      if (browser.commands && typeof browser.commands.openShortcutSettings === "function") browser.commands.openShortcutSettings();
    });
    ui.copyCssButton.addEventListener("click", () => copyText(HEADER_CSS, ui.copyCssButton, "settings.copyCss"));

    browser.tabs.onActivated.addListener(refreshActiveTab);
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (state.activeTab && tabId === state.activeTab.id && (changeInfo.title || changeInfo.url || changeInfo.status === "complete")) {
        refreshActiveTab();
      }
      if (state.extraTabs.has(tabId) && changeInfo.title) {
        state.extraTabs.set(tabId, changeInfo.title);
        renderContextChips();
      }
    });
    browser.tabs.onRemoved.addListener((tabId) => {
      if (state.extraTabs.delete(tabId)) renderContextChips();
    });
    browser.windows.onFocusChanged.addListener(refreshActiveTab);
    if (browser.theme && browser.theme.onUpdated) browser.theme.onUpdated.addListener(applyAppearance);
    if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyAppearance);

    /* Bilder reinziehen */
    let dragDepth = 0;
    const isUsefulDrag = (event) => {
      const types = event.dataTransfer ? [...event.dataTransfer.types] : [];
      return types.includes("Files") || types.includes("text/html") || types.includes("text/uri-list");
    };
    document.addEventListener("dragenter", (event) => {
      if (!isUsefulDrag(event) || ui.composer.hidden) return;
      dragDepth++;
      ui.dropOverlay.hidden = false;
    });
    document.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) ui.dropOverlay.hidden = true;
    });
    document.addEventListener("dragover", (event) => {
      if (isUsefulDrag(event)) event.preventDefault();
    });
    document.addEventListener(
      "drop",
      async (event) => {
        dragDepth = 0;
        ui.dropOverlay.hidden = true;
        if (!isUsefulDrag(event)) return;
        event.preventDefault();
        if (ui.composer.hidden) return;
        const dropped = imageSourcesFromTransfer(event.dataTransfer);
        let added = 0;
        for (const source of dropped) if (typeof source === "string" ? await addImage(source) : await addFile(source)) added++;
        if (!added && !dropped.length) flash(t("flash.noImage"));
        ui.promptInput.focus();
      },
      true
    );

    browser.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.pendingAction && changes.pendingAction.newValue) handlePendingAction(changes.pendingAction.newValue);
    });
  }

  function submitPrompt() {
    if (state.busy) return;
    const text = ui.promptInput.value.trim();
    if (!text && !state.attachments.length) return;
    ui.promptInput.value = "";
    autoGrow();
    hideSuggest();
    if (!text) {
      /* Nur Anhang: bei Bildern Produkt suchen, sonst Inhalt zusammenfassen */
      const onlyImages = state.attachments.every((attachment) => attachment.kind === "image");
      sendMessage(prompt(onlyImages ? "find" : "attachment"), onlyImages ? {} : { noPage: true });
      return;
    }
    const match = text.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
    const command = match && allCommands().find((entry) => entry.name === match[1].toLowerCase());
    if (command) runCommand(command, match[2] || "");
    else sendMessage(text);
  }

  /* ---------- Start ---------- */

  async function init() {
    await loadState();
    await applyAppearance();
    bindEvents();
    applyLanguage();
    await refreshActiveTab();
    if (!state.settings.apiKey) {
      ui.settingsNotice.textContent = t("error.welcome");
      showView("settingsView");
    } else {
      ui.promptInput.focus();
      const { pendingAction } = await browser.storage.local.get("pendingAction");
      if (pendingAction) handlePendingAction(pendingAction);
    }
  }

  init();
})();
