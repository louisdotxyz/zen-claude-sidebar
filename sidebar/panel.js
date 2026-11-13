/* Claude Sidebar – Logik des Panels */
(() => {
  const MODELS = [
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
    { id: "claude-opus-5-5", label: "Opus 5.5" },
    { id: "claude-haiku-5-5", label: "Haiku 5.5" }
  ];
  const MAX_CONVERSATIONS = 200;
  const MAX_TOOL_ROUNDS = 15;
  const PROMPTS = {
    summary: "Fasse diese Seite kurz zusammen: zuerst die Kernaussage in einem Satz, dann die wichtigsten Punkte.",
    overview: "Gib mir eine kurze Übersicht über meine offenen Tabs und Ordner, gruppiert nach Thema.",
    sort: "Sortiere die Tabs in meinem aktuellen Fenster nach Thema in Ordner. Bestehende Ordner kannst du weiterverwenden. Angepinnte Tabs und Essentials nicht anfassen.",
    cleanup: "Räum meine Tabs im aktuellen Fenster auf: Schlage Duplikate und Tabs, die ich lange nicht benutzt habe, zum Schliessen vor und sortiere den Rest nach Thema in Ordner. Bestehende Ordner kannst du weiterverwenden. Angepinnte Tabs und Essentials nicht anfassen.",
    compare: "Vergleiche die Produkte in den offenen Tabs dieses Fensters. Lies die Produktseiten, erstelle eine Vergleichstabelle mit den wichtigsten Kriterien und dem Preis und gib am Schluss eine kurze Empfehlung. Fehlende Angaben suchst du auf der Herstellerseite.",
    find: "Finde das Produkt auf diesem Bild: Was ist es genau (Marke, Modell)? Such im Web danach und nenn mir Preis und wo ich es kaufen kann, bevorzugt bei Shops, die in die Schweiz liefern. Wenn du das genaue Modell nicht sicher erkennst, sag das und nenn die ähnlichsten Treffer."
  };
  /* context: "page" = aktuelle Seite erzwingen, "none" = ohne Seite. fill = nur ins Eingabefeld schreiben. */
  const DEFAULT_COMMANDS = [
    { name: "zusammenfassen", prompt: PROMPTS.summary, context: "page" },
    { name: "recherche", prompt: "Recherchiere im Web und gib mir eine kurze Übersicht mit Quellen zu: ", fill: true, context: "none" },
    { name: "vergleichen", prompt: PROMPTS.compare, context: "none" },
    { name: "finden", prompt: PROMPTS.find },
    { name: "aufräumen", prompt: PROMPTS.cleanup, context: "none" },
    { name: "sortieren", prompt: PROMPTS.sort, context: "none" },
    { name: "übersicht", prompt: PROMPTS.overview, context: "none" },
    { name: "erklären", prompt: "Erkläre mir diese Seite einfach und kurz.", context: "page" },
    { name: "übersetzen", prompt: "Übersetze den Hauptinhalt dieser Seite auf Deutsch.", context: "page" }
  ];
  const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 6 };
  const MAX_IMAGES = 4;

  const element = (id) => document.getElementById(id);
  const ui = {
    chatView: element("chatView"),
    historyView: element("historyView"),
    settingsView: element("settingsView"),
    messageList: element("messageList"),
    emptyState: element("emptyState"),
    summarizeButton: element("summarizeButton"),
    overviewButton: element("overviewButton"),
    compareButton: element("compareButton"),
    profileInput: element("profileInput"),
    customCommandsInput: element("customCommandsInput"),
    webSearchCheckbox: element("webSearchCheckbox"),
    suggestBox: element("suggestBox"),
    dropOverlay: element("dropOverlay"),
    newChatButton: element("newChatButton"),
    historyButton: element("historyButton"),
    sortTabsButton: element("sortTabsButton"),
    settingsButton: element("settingsButton"),
    historyList: element("historyList"),
    apiKeyInput: element("apiKeyInput"),
    toggleKeyButton: element("toggleKeyButton"),
    defaultModelSelect: element("defaultModelSelect"),
    customModelInput: element("customModelInput"),
    confirmChangesCheckbox: element("confirmChangesCheckbox"),
    saveSettingsButton: element("saveSettingsButton"),
    settingsSaved: element("settingsSaved"),
    clearHistoryButton: element("clearHistoryButton"),
    composer: element("composer"),
    pageChip: element("pageChip"),
    pageChipLabel: element("pageChipLabel"),
    extraTabChips: element("extraTabChips"),
    addTabsButton: element("addTabsButton"),
    tabPicker: element("tabPicker"),
    tabPickerSearch: element("tabPickerSearch"),
    tabPickerList: element("tabPickerList"),
    promptInput: element("promptInput"),
    sendButton: element("sendButton"),
    modelSelect: element("modelSelect"),
    usageLabel: element("usageLabel")
  };

  const state = {
    settings: { apiKey: "", defaultModel: MODELS[0].id, customModel: "", confirmChanges: true, webSearch: true, profile: "", customCommands: "" },
    images: [], // { data (base64 JPEG), thumb (data-URL) }
    selection: "",
    lastActionTime: 0,
    conversations: [],
    currentId: null,
    currentModel: MODELS[0].id,
    includePage: true,
    activeTab: null,
    extraTabs: new Map(), // tabId -> title
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

  /* ---------- Modelle ---------- */

  function availableModels() {
    const list = MODELS.slice();
    const custom = (state.settings.customModel || "").trim();
    if (custom && !list.some((model) => model.id === custom)) list.push({ id: custom, label: custom });
    if (!list.some((model) => model.id === state.currentModel)) list.push({ id: state.currentModel, label: state.currentModel });
    return list;
  }

  function fillModelSelect(select, selectedId) {
    select.replaceChildren(
      ...availableModels().map((model) => {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = model.label;
        option.selected = model.id === selectedId;
        return option;
      })
    );
  }

  /* ---------- Ansichten ---------- */

  function showView(name) {
    for (const view of ["chatView", "historyView", "settingsView"]) ui[view].hidden = view !== name;
    ui.composer.hidden = name !== "chatView";
    closeTabPicker();
    if (name === "historyView") renderHistory();
    if (name === "settingsView") renderSettings();
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
      wrapper.appendChild(document.createTextNode(message.text));
      if (message.contexts && message.contexts.length) {
        const context = document.createElement("div");
        context.className = "message-context";
        context.textContent = "mit " + message.contexts.map((item) => item.title).join(", ");
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
    copyButton.textContent = "Kopieren";
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
    title.textContent = "Claude möchte deine Tabs ändern:";
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
      accept.textContent = "Ausführen";
      accept.addEventListener("click", () => resolveConfirm(true));
      const decline = document.createElement("button");
      decline.className = "ghost-button";
      decline.textContent = "Ablehnen";
      decline.addEventListener("click", () => resolveConfirm(false));
      row.append(accept, decline);
      card.appendChild(row);
    } else {
      const status = document.createElement("div");
      status.className = "confirm-state";
      status.textContent = part.state === "accepted" ? "Ausgeführt" : "Abgelehnt";
      card.appendChild(status);
    }
    return card;
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
        const box = document.createElement("div");
        box.className = "sources";
        box.textContent = "Quellen";
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
        body.appendChild(box);
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

  async function copyText(text, button) {
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
    const original = button.textContent;
    button.textContent = "Kopiert";
    setTimeout(() => (button.textContent = original), 1200);
  }

  /* ---------- Kontext: aktuelle Seite und weitere Tabs ---------- */

  async function refreshActiveTab() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    state.activeTab = tab || null;
    renderContextChips();
  }

  function renderContextChips() {
    const tab = state.activeTab;
    const readable = tab && TabTools.isReadableUrl(tab.url);
    ui.pageChip.setAttribute("aria-pressed", String(state.includePage && Boolean(readable)));
    ui.pageChip.disabled = !readable;
    ui.pageChipLabel.textContent = readable ? tab.title || "Diese Seite" : "Diese Seite (nicht lesbar)";
    ui.pageChip.title = readable ? `Aktuelle Seite mitschicken: ${tab.url}` : "Interne Seiten kann die Extension nicht lesen";

    ui.extraTabChips.replaceChildren(
      ...[...state.extraTabs.entries()].map(([tabId, title]) => {
        const chip = document.createElement("button");
        chip.className = "chip chip-tab";
        chip.title = "Entfernen";
        const label = document.createElement("span");
        label.className = "chip-label";
        label.textContent = title;
        const remove = document.createElement("span");
        remove.className = "chip-remove";
        remove.textContent = "×";
        chip.append(label, remove);
        chip.addEventListener("click", () => {
          state.extraTabs.delete(tabId);
          renderContextChips();
        });
        return chip;
      })
    );

    state.images.forEach((image, index) => {
      const chip = document.createElement("button");
      chip.className = "chip chip-tab chip-image";
      chip.title = "Bild entfernen";
      const preview = document.createElement("img");
      preview.src = image.thumb;
      preview.alt = "";
      const remove = document.createElement("span");
      remove.className = "chip-remove";
      remove.textContent = "×";
      chip.append(preview, remove);
      chip.addEventListener("click", () => {
        state.images.splice(index, 1);
        renderContextChips();
      });
      ui.extraTabChips.appendChild(chip);
    });

    if (state.selection) {
      const chip = document.createElement("button");
      chip.className = "chip chip-tab";
      chip.title = state.selection.slice(0, 300);
      const label = document.createElement("span");
      label.className = "chip-label";
      label.textContent = `Auswahl (${state.selection.length} Zeichen)`;
      const remove = document.createElement("span");
      remove.className = "chip-remove";
      remove.textContent = "×";
      chip.append(label, remove);
      chip.addEventListener("click", () => {
        state.selection = "";
        renderContextChips();
      });
      ui.extraTabChips.appendChild(chip);
    }
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
      empty.style.padding = "6px";
      empty.textContent = "Keine weiteren lesbaren Tabs in diesem Fenster.";
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
    if (forcePage && !activeReadable) throw new Error("Diese Seite kann nicht gelesen werden (interne Seite).");
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

  const RUNNING_LABELS = {
    list_tabs: "Lese Tabs und Ordner …",
    read_tab: "Lese Seite …",
    focus_tab: "Wechsle Tab …",
    move_tabs: "Plane Verschiebung …",
    group_tabs: "Plane Ordner …",
    ungroup_tabs: "Plane Änderung …",
    update_group: "Plane Ordner-Änderung …",
    move_group: "Plane Verschiebung …",
    close_tabs: "Plane Aufräumen …",
    web_search: "Suche im Web …"
  };

  function buildTools() {
    return state.settings.webSearch === false ? BrowserTools.definitions : BrowserTools.definitions.concat([WEB_SEARCH_TOOL]);
  }

  function buildSystemPrompt() {
    const profile = (state.settings.profile || "").trim();
    if (!profile) return ClaudeApi.SYSTEM_PROMPT;
    return `${ClaudeApi.SYSTEM_PROMPT}\n\nThe user wrote this about themselves and how they want answers. Follow it where it applies:\n<user_profile>\n${profile.slice(0, 6000)}\n</user_profile>`;
  }

  /* Websuche läuft bei Anthropic: Schritte beschriften und Quellen einsammeln. */
  function noteServerTools(content, parts, sources) {
    for (const block of content) {
      if (block.type === "server_tool_use") {
        const step = parts.find((part) => part.type === "tool" && part.id === block.id);
        if (step) {
          step.status = "done";
          step.label = `Websuche: ${(block.input && block.input.query) || ""}`;
        }
      } else if (block.type === "web_search_tool_result" && block.content && !Array.isArray(block.content)) {
        const step = parts.find((part) => part.type === "tool" && part.id === block.tool_use_id);
        if (step) {
          step.status = "error";
          step.label = "Websuche fehlgeschlagen";
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
      const result = await ClaudeApi.streamMessage({
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
          parts.push({ type: "tool", id: block.id, name: block.name, label: RUNNING_LABELS[block.name] || block.name, status: "running" });
          render();
        }
      });
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;

      if (result.content.length) conversation.apiMessages.push({ role: "assistant", content: result.content });
      noteServerTools(result.content, parts, sources);
      if (result.stopReason === "max_tokens") parts.push({ type: "text", text: "*[Antwort wegen Längenlimit abgeschnitten]*" });
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
          step.label = state.abortController.signal.aborted ? "Gestoppt" : "Abgelehnt";
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "The user declined this change.", is_error: true });
          continue;
        }
        const outcome = block.parseError
          ? { content: "Invalid tool input JSON.", label: "Fehler: ungültige Eingabe", isError: true }
          : await BrowserTools.execute(block.name, block.input);
        step.status = outcome.isError ? "error" : "done";
        step.label = outcome.label;
        const toolResult = { type: "tool_result", tool_use_id: block.id, content: outcome.content };
        if (outcome.isError) toolResult.is_error = true;
        toolResults.push(toolResult);
        render();
      }
      conversation.apiMessages.push({ role: "user", content: toolResults });
      if (state.abortController.signal.aborted) throw new DOMException("Gestoppt", "AbortError");
    }
    parts.push({ type: "text", text: "*[Zu viele Schritte, abgebrochen. Sag mir, wie ich weitermachen soll.]*" });
  }

  async function sendMessage(userText, options = {}) {
    const text = (userText || "").trim();
    if (!text || state.busy) return;
    if (!state.settings.apiKey) {
      showView("settingsView");
      ui.settingsSaved.textContent = "Bitte zuerst einen API-Key eintragen.";
      ui.apiKeyInput.focus();
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
      const title = pages[0] && options.forcePage ? `Zusammenfassung: ${pages[0].title}` : text;
      conversation = createConversation(title);
    }
    conversation.model = state.currentModel;

    const documents = pages.length ? TabTools.buildDocumentsBlock(pages) : "";
    const images = contextError ? [] : state.images;
    const selection = contextError ? "" : state.selection;
    if (!contextError) {
      state.images = [];
      state.selection = "";
      renderContextChips();
    }
    const contexts = pages.map((page) => ({ title: page.title, url: page.url }));
    if (selection) contexts.push({ title: "Auswahl" });
    const userMessage = { role: "user", text, contexts };
    if (images.length) userMessage.images = images.map((image) => image.thumb);
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
      assistantMessage.error = `${contextError} Schalte „Diese Seite“ aus oder entferne den Tab und versuch es nochmal.`;
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
    const imageBlocks = images.map((image) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.data } }));
    conversation.apiMessages.push({ role: "user", content: imageBlocks.length ? imageBlocks.concat([{ type: "text", text: apiText }]) : apiText });
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
        assistantMessage.parts.push({ type: "text", text: "*[gestoppt]*" });
      } else {
        if (nothingCompleted) conversation.apiMessages.length = snapshotLength;
        assistantMessage.error = error.message || "Unbekannter Fehler.";
        if (/web_search/i.test(assistantMessage.error)) {
          assistantMessage.error += " Die Websuche ist für deinen API-Account evtl. nicht freigeschaltet: in der Anthropic Console aktivieren oder hier in den Einstellungen ausschalten.";
        }
      }
    } finally {
      resolveConfirm(false);
      delete assistantMessage.streaming;
      state.abortController = null;
      conversation.updatedAt = Date.now();
      ui.usageLabel.textContent = `${formatNumber(usage.inputTokens)} in · ${formatNumber(usage.outputTokens)} out`;
      updateAssistantElement(assistantElement, assistantMessage);
      scrollToBottom(false);
      await saveConversations();
      setBusy(false);
    }
  }

  function setBusy(busy) {
    state.busy = busy;
    ui.sendButton.classList.toggle("is-busy", busy);
    ui.sendButton.title = busy ? "Stoppen" : "Senden (Enter)";
    ui.summarizeButton.disabled = busy;
    ui.overviewButton.disabled = busy;
    ui.compareButton.disabled = busy;
  }

  const formatNumber = (value) => new Intl.NumberFormat("de-CH").format(value || 0);

  function autoGrow() {
    ui.promptInput.style.height = "auto";
    ui.promptInput.style.height = `${Math.min(ui.promptInput.scrollHeight, 180)}px`;
  }

  function startNewChat() {
    if (state.busy) return;
    state.currentId = null;
    state.currentModel = state.settings.defaultModel;
    fillModelSelect(ui.modelSelect, state.currentModel);
    state.extraTabs.clear();
    state.images = [];
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
      empty.textContent = "Noch keine Chats.";
      ui.historyList.replaceChildren(empty);
      return;
    }
    const dateFormat = new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    ui.historyList.replaceChildren(
      ...sorted.map((conversation) => {
        const item = document.createElement("li");
        item.className = "history-item";
        const open = document.createElement("button");
        open.className = "history-open";
        const title = document.createElement("span");
        title.className = "history-title";
        title.textContent = conversation.title || "Ohne Titel";
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
        remove.title = "Chat löschen";
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

  /* ---------- Einstellungen ---------- */

  function renderSettings() {
    ui.apiKeyInput.value = state.settings.apiKey || "";
    ui.apiKeyInput.type = "password";
    ui.toggleKeyButton.textContent = "Zeigen";
    ui.customModelInput.value = state.settings.customModel || "";
    ui.confirmChangesCheckbox.checked = state.settings.confirmChanges !== false;
    ui.webSearchCheckbox.checked = state.settings.webSearch !== false;
    ui.profileInput.value = state.settings.profile || "";
    ui.customCommandsInput.value = state.settings.customCommands || "";
    fillModelSelect(ui.defaultModelSelect, state.settings.defaultModel);
  }

  let clearConfirmTimer = null;
  async function handleClearHistory() {
    if (state.busy) return;
    if (!clearConfirmTimer) {
      ui.clearHistoryButton.textContent = "Wirklich alles löschen? Nochmal klicken";
      clearConfirmTimer = setTimeout(() => {
        clearConfirmTimer = null;
        ui.clearHistoryButton.textContent = "Ganzen Verlauf löschen";
      }, 3000);
      return;
    }
    clearTimeout(clearConfirmTimer);
    clearConfirmTimer = null;
    state.conversations = [];
    state.currentId = null;
    await saveConversations();
    ui.clearHistoryButton.textContent = "Verlauf gelöscht";
    setTimeout(() => (ui.clearHistoryButton.textContent = "Ganzen Verlauf löschen"), 1500);
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
    return custom.concat(DEFAULT_COMMANDS.filter((command) => !customNames.has(command.name)));
  }

  function runCommand(command, extra) {
    const options = command.context === "page" ? { forcePage: true } : command.context === "none" ? { noPage: true } : {};
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
    const candidates = /\/\/i\.pinimg\.com\/(\d+x\d*|\d+x)\//.test(source)
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

  /* Nimmt eine Datei oder eine Bild-URL, verkleinert sie und hängt sie an die nächste Nachricht. */
  async function addImage(source) {
    if (state.images.length >= MAX_IMAGES) {
      flash(`Maximal ${MAX_IMAGES} Bilder pro Nachricht.`);
      return false;
    }
    try {
      const bitmap = await loadBitmap(source);
      const full = drawToJpeg(bitmap, 1568, 0.85);
      state.images.push({ data: full.split(",")[1], thumb: drawToJpeg(bitmap, 160, 0.7) });
      renderContextChips();
      return true;
    } catch (_) {
      return false;
    }
  }

  function imageSourcesFromTransfer(transfer) {
    const files = [...transfer.files].filter((file) => file.type.startsWith("image/"));
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
    const files = [...transfer.files].filter((file) => file.type.startsWith("image/"));
    const text = (transfer.getData("text/plain") || "").trim();
    const isImageLink = /^https?:\/\/\S+\.(png|jpe?g|webp|gif|avif)(\?\S*)?$/i.test(text);
    if (!files.length && !isImageLink) return;
    event.preventDefault();
    for (const source of files.length ? files : [text]) {
      if (!(await addImage(source))) flash("Bild konnte nicht geladen werden.");
    }
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
        flash("Bild konnte nicht geladen werden.");
        return;
      }
      if (action.prompt === "find") sendMessage(PROMPTS.find);
      else ui.promptInput.focus();
      return;
    }
    if (!action.text) return;
    state.selection = action.text;
    renderContextChips();
    if (action.prompt) sendMessage(action.prompt, { noPage: true });
    else ui.promptInput.focus();
  }

  /* ---------- Events ---------- */

  function bindEvents() {
    ui.newChatButton.addEventListener("click", startNewChat);
    ui.historyButton.addEventListener("click", () => showView(ui.historyView.hidden ? "historyView" : "chatView"));
    ui.settingsButton.addEventListener("click", () => showView(ui.settingsView.hidden ? "settingsView" : "chatView"));
    ui.sortTabsButton.addEventListener("click", () => {
      showView("chatView");
      sendMessage(PROMPTS.cleanup, { noPage: true });
    });
    ui.compareButton.addEventListener("click", () => sendMessage(PROMPTS.compare, { noPage: true }));
    document.querySelectorAll("[data-close-view]").forEach((button) => button.addEventListener("click", () => showView("chatView")));

    ui.summarizeButton.addEventListener("click", () => sendMessage(PROMPTS.summary, { forcePage: true }));
    ui.overviewButton.addEventListener("click", () => sendMessage(PROMPTS.overview, { noPage: true }));

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

    ui.toggleKeyButton.addEventListener("click", (event) => {
      event.preventDefault();
      const hidden = ui.apiKeyInput.type === "password";
      ui.apiKeyInput.type = hidden ? "text" : "password";
      ui.toggleKeyButton.textContent = hidden ? "Verbergen" : "Zeigen";
    });
    ui.saveSettingsButton.addEventListener("click", async () => {
      state.settings.apiKey = ui.apiKeyInput.value.trim();
      state.settings.customModel = ui.customModelInput.value.trim();
      state.settings.confirmChanges = ui.confirmChangesCheckbox.checked;
      state.settings.webSearch = ui.webSearchCheckbox.checked;
      state.settings.profile = ui.profileInput.value.trim();
      state.settings.customCommands = ui.customCommandsInput.value.trim();
      state.settings.defaultModel = ui.defaultModelSelect.value;
      await saveSettings();
      if (!currentConversation()) state.currentModel = state.settings.defaultModel;
      fillModelSelect(ui.modelSelect, state.currentModel);
      fillModelSelect(ui.defaultModelSelect, state.settings.defaultModel);
      ui.settingsSaved.textContent = "Gespeichert.";
      setTimeout(() => (ui.settingsSaved.textContent = ""), 2000);
    });
    ui.clearHistoryButton.addEventListener("click", handleClearHistory);

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
    document.addEventListener("drop", async (event) => {
      dragDepth = 0;
      ui.dropOverlay.hidden = true;
      if (!isUsefulDrag(event)) return;
      event.preventDefault();
      if (ui.composer.hidden) return;
      const dropped = imageSourcesFromTransfer(event.dataTransfer);
      let added = 0;
      for (const source of dropped) if (await addImage(source)) added++;
      if (!added) flash("Kein Bild erkannt.");
      ui.promptInput.focus();
    }, true);

    browser.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.pendingAction && changes.pendingAction.newValue) handlePendingAction(changes.pendingAction.newValue);
    });
  }

  function submitPrompt() {
    if (state.busy) return;
    const text = ui.promptInput.value.trim();
    if (!text && !state.images.length) return;
    ui.promptInput.value = "";
    autoGrow();
    hideSuggest();
    if (!text) {
      sendMessage(PROMPTS.find); // nur ein Bild: Produkt suchen
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
    fillModelSelect(ui.modelSelect, state.currentModel);
    bindEvents();
    await refreshActiveTab();
    renderConversation();
    if (!state.settings.apiKey) {
      showView("settingsView");
      ui.settingsSaved.textContent = "Willkommen! Trag deinen Anthropic API-Key ein.";
    } else {
      ui.promptInput.focus();
      const { pendingAction } = await browser.storage.local.get("pendingAction");
      if (pendingAction) handlePendingAction(pendingAction);
    }
  }

  init();
})();
