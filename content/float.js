/* Schwebendes Claude-Fenster über der Webseite.
   Ein Shadow-DOM hält die Styles der Seite fern. Eingeklappt bleibt nur das Claude-Logo.
   Offen/zu, Position und Grösse gelten für alle Tabs (browser.storage.local "floatState"). */
(() => {
  if (window.top !== window || window.__claudeFloat) return;
  window.__claudeFloat = true;

  const DEFAULT_STATE = { open: false, width: 400, height: 640, right: 16, top: 16 };
  const MIN_WIDTH = 300;
  const MIN_HEIGHT = 360;
  const LOGO =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M18.7 5.3 5.3 18.7"/></svg>';

  let state = Object.assign({}, DEFAULT_STATE);
  let mode = "float";
  let scheme = "light dark";

  const host = document.createElement("div");
  host.id = "claude-sidebar-float";
  /* Host selbst: nimmt keinen Platz ein und liegt über allem */
  host.style.cssText = "all: initial; position: fixed; inset: 0 auto auto 0; width: 0; height: 0; z-index: 2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .launcher {
        position: fixed; right: 18px; bottom: 18px; width: 40px; height: 40px; border-radius: 50%;
        display: grid; place-items: center; cursor: pointer; border: 0; padding: 0;
        color: #ededef; background: rgba(28, 28, 30, 0.55);
        -webkit-backdrop-filter: blur(16px) saturate(1.4); backdrop-filter: blur(16px) saturate(1.4);
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.25), inset 0 0 0 1px rgba(255, 255, 255, 0.12);
        opacity: 0.75; transition: opacity 0.15s, transform 0.15s;
      }
      .launcher:hover { opacity: 1; transform: scale(1.06); }
      .launcher svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
      .panel {
        position: fixed; display: flex; flex-direction: column; overflow: hidden; border-radius: 16px;
        -webkit-backdrop-filter: blur(28px) saturate(1.5); backdrop-filter: blur(28px) saturate(1.5);
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35), inset 0 0 0 1px rgba(255, 255, 255, 0.12);
      }
      .grip { position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 120px; height: 12px; z-index: 1; cursor: grab; display: grid; place-items: center; touch-action: none; }
      .grip::before { content: ""; width: 36px; height: 4px; border-radius: 2px; background: rgba(150, 150, 155, 0.55); }
      .grip:active { cursor: grabbing; }
      iframe { flex: 1; width: 100%; border: 0; background: transparent; color-scheme: light dark; }
      .resize { position: absolute; left: 0; bottom: 0; width: 18px; height: 18px; cursor: nesw-resize; touch-action: none; }
      .dragging iframe { pointer-events: none; }
      [hidden] { display: none !important; }
    </style>
    <button class="launcher" title="Claude (Alt+Shift+C)">${LOGO}</button>
    <div class="panel" hidden>
      <div class="grip" title="Verschieben"></div>
      <div class="resize" title="Grösse ändern"></div>
    </div>`;
  const launcher = root.querySelector(".launcher");
  const panel = root.querySelector(".panel");
  const grip = root.querySelector(".grip");
  const resize = root.querySelector(".resize");
  let frame = null;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function layout() {
    const width = clamp(state.width, MIN_WIDTH, Math.max(MIN_WIDTH, innerWidth - 16));
    const height = clamp(state.height, MIN_HEIGHT, Math.max(MIN_HEIGHT, innerHeight - 16));
    const right = clamp(state.right, 0, Math.max(0, innerWidth - width));
    const top = clamp(state.top, 0, Math.max(0, innerHeight - height));
    Object.assign(panel.style, { width: `${width}px`, height: `${height}px`, right: `${right}px`, top: `${top}px` });
  }

  function render() {
    const visible = mode === "float";
    host.hidden = !visible;
    if (!visible) return;
    panel.hidden = !state.open;
    launcher.hidden = state.open;
    if (state.open && !frame) {
      /* Erst beim Öffnen laden: ein Tab ohne geöffnetes Fenster kostet nichts */
      frame = document.createElement("iframe");
      frame.src = browser.runtime.getURL("sidebar/panel.html?mode=float");
      frame.allow = "clipboard-write";
      panel.insertBefore(frame, resize);
    }
    if (frame) frame.style.colorScheme = scheme;
    layout();
  }

  const save = (changes) => browser.storage.local.get("floatState").then(({ floatState }) =>
    browser.storage.local.set({ floatState: Object.assign({}, DEFAULT_STATE, floatState, changes) }));

  launcher.addEventListener("click", () => {
    state.open = true;
    render();
    save({ open: true });
  });

  /* Verschieben am Griff */
  grip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    panel.classList.add("dragging");
    const start = { x: event.clientX, y: event.clientY, right: parseFloat(panel.style.right), top: parseFloat(panel.style.top) };
    const move = (moveEvent) => {
      state.right = start.right - (moveEvent.clientX - start.x);
      state.top = start.top + (moveEvent.clientY - start.y);
      layout();
    };
    const end = () => {
      grip.removeEventListener("pointermove", move);
      panel.classList.remove("dragging");
      save({ right: parseFloat(panel.style.right), top: parseFloat(panel.style.top) });
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end, { once: true });
    grip.addEventListener("pointercancel", end, { once: true });
  });

  /* Grösse an der Ecke unten links (das Fenster hängt rechts) */
  resize.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    resize.setPointerCapture(event.pointerId);
    panel.classList.add("dragging");
    const start = { x: event.clientX, y: event.clientY, width: parseFloat(panel.style.width), height: parseFloat(panel.style.height) };
    const move = (moveEvent) => {
      state.width = start.width - (moveEvent.clientX - start.x);
      state.height = start.height + (moveEvent.clientY - start.y);
      layout();
    };
    const end = () => {
      resize.removeEventListener("pointermove", move);
      panel.classList.remove("dragging");
      save({ width: parseFloat(panel.style.width), height: parseFloat(panel.style.height) });
    };
    resize.addEventListener("pointermove", move);
    resize.addEventListener("pointerup", end, { once: true });
    resize.addEventListener("pointercancel", end, { once: true });
  });

  addEventListener("resize", () => state.open && layout());

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.floatState && changes.floatState.newValue) state = Object.assign({}, DEFAULT_STATE, changes.floatState.newValue);
    if (changes.floatScheme) scheme = changes.floatScheme.newValue || "light dark";
    if (changes.settings && changes.settings.newValue) mode = changes.settings.newValue.windowMode === "sidebar" ? "sidebar" : "float";
    if (changes.floatState || changes.floatScheme || changes.settings) render();
  });

  /* Für Screenshots kurz ausblenden */
  browser.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "claude-float-visibility") return undefined;
    host.style.visibility = message.visible ? "" : "hidden";
    return Promise.resolve(true);
  });

  browser.storage.local.get(["floatState", "floatScheme", "settings"]).then((stored) => {
    state = Object.assign({}, DEFAULT_STATE, stored.floatState);
    scheme = stored.floatScheme || "light dark";
    mode = stored.settings && stored.settings.windowMode === "sidebar" ? "sidebar" : "float";
    (document.body || document.documentElement).appendChild(host);
    render();
  });
})();
