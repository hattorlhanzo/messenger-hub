const path = require("node:path");
const crypto = require("node:crypto");
const {
  app,
  BrowserWindow,
  BrowserView,
  globalShortcut,
  ipcMain,
  Menu,
  Notification,
  screen,
  session,
  shell
} = require("electron");
const {
  addAccount,
  loadAccounts,
  removeAccount,
  reorderAccounts,
  updateAccount
} = require("./accounts.cjs");
const { getSettingsPath, loadSettings, updateSettings } = require("./settings.cjs");

const regularTopbarHeight = 76;
const regularToolbarHeight = 52;
const compactTopbarHeight = 56;
const compactToolbarHeight = 44;
const defaultOverlayHeight = 344;
const defaultGlobalShortcut = "Alt+Space";

let windowRef;
let webAccounts = [];
let activeAccountId;
let appSettings = {};
const views = new Map();
const unreadCounts = new Map();
const configuredSessionPartitions = new Set();
const recentPreviewKeys = new Map();
const recentPreviewAt = new Map();
const isDevToolsEnabled = process.env.MESSENGER_HUB_DEVTOOLS === "1";
let isQuitting = false;
let reservedOverlayHeight = 0;
let isInterfaceLocked = false;
let persistWindowStateTimer;
let globalShortcutStatus = {
  accelerator: defaultGlobalShortcut,
  registered: false
};

function createWindow() {
  process.env.MESSENGER_HUB_DATA_DIR = app.getPath("userData");
  webAccounts = loadAccounts();
  appSettings = loadSettings();
  applyLoginItemSettings();
  activeAccountId =
    webAccounts.find((account) => account.id === appSettings.lastAccountId)?.id ||
    webAccounts.find((account) => account.id === appSettings.startAccountId)?.id ||
    webAccounts[0]?.id;

  const windowBounds = normalizeWindowBounds(appSettings.windowBounds);
  const win = new BrowserWindow({
    ...windowBounds,
    minWidth: 980,
    minHeight: 680,
    title: "Messenger Hub",
    backgroundColor: "#f8f6ef",
    icon: path.join(__dirname, "assets/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  windowRef = win;
  win.setMaxListeners(40);
  win.loadFile(path.join(__dirname, "renderer.html"));

  webAccounts.forEach(createAccountView);

  win.once("ready-to-show", () => {
    selectAccount(activeAccountId);
    if (appSettings.windowFullScreen) {
      win.setFullScreen(true);
    }
  });

  [
    "resize",
    "resized",
    "maximize",
    "unmaximize",
    "restore",
    "enter-full-screen",
    "leave-full-screen",
    "enter-html-full-screen",
    "leave-html-full-screen"
  ].forEach((eventName) => {
    win.on(eventName, scheduleLayoutActiveView);
  });
  ["move", "moved", "resize", "resized", "maximize", "unmaximize", "restore"].forEach(
    (eventName) => {
      win.on(eventName, schedulePersistWindowState);
    }
  );
  win.on("enter-full-screen", () => persistWindowState({ windowFullScreen: true }));
  win.on("leave-full-screen", () => persistWindowState({ windowFullScreen: false }));
  win.on("close", (event) => {
    persistWindowState();
    if (!isQuitting && appSettings.keepInBackground !== false) {
      event.preventDefault();
      requestRendererLock();
      win.hide();
    }
  });
  win.on("closed", () => {
    windowRef = undefined;
  });

  createApplicationMenu();
  registerGlobalShortcut();
}

function createAccountView(account) {
  if (views.has(account.id)) {
    return views.get(account.id);
  }

  configureAccountSession(account);

  const view = new BrowserView({
    webPreferences: {
      partition: account.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  view.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  view.webContents.setUserAgent(account.userAgent);
  view.webContents.on("did-navigate", () => sendNavigationState());
  view.webContents.on("did-navigate-in-page", () => sendNavigationState());
  view.webContents.on("dom-ready", () => installNotificationBridge(view));
  view.webContents.on("console-message", (details) => {
    handleNotificationBridgeMessage(account, details.message);
  });
  view.webContents.on("page-title-updated", () => updateAccountTitleState(account));
  view.webContents.on("did-finish-load", () => {
    installNotificationBridge(view);
    updateAccountTitleState(account);
  });
  view.webContents.on("render-process-gone", () => {
    unreadCounts.set(account.id, 0);
    broadcastAccountState();
  });
  view.webContents.loadURL(account.url);
  views.set(account.id, view);
  return view;
}

function selectAccount(accountId = activeAccountId) {
  const win = windowRef;
  const nextView = views.get(accountId);

  if (!win || !nextView) {
    return;
  }

  const currentView = views.get(activeAccountId);
  if (currentView && currentView !== nextView) {
    win.removeBrowserView(currentView);
  }

  activeAccountId = accountId;
  appSettings = updateSettings({ lastAccountId: accountId });
  win.addBrowserView(nextView);
  layoutActiveView();
  createApplicationMenu();
  win.webContents.send("accounts:changed", { activeAccountId });
  sendNavigationState();
}

function layoutActiveView() {
  const win = windowRef;
  const view = views.get(activeAccountId);

  if (!win || !view) {
    return;
  }

  const bounds = win.getContentBounds();
  const reservedHeight = getTopbarHeight() + getToolbarHeight() + reservedOverlayHeight;
  if (isInterfaceLocked) {
    view.setBounds({
      x: 0,
      y: bounds.height,
      width: Math.max(320, bounds.width),
      height: 1
    });
    return;
  }

  view.setBounds({
    x: 0,
    y: reservedHeight,
    width: Math.max(320, bounds.width),
    height: Math.max(240, bounds.height - reservedHeight)
  });
  view.setAutoResize({
    width: true,
    height: true,
    horizontal: false,
    vertical: false
  });
}

function scheduleLayoutActiveView() {
  layoutActiveView();
  setTimeout(layoutActiveView, 80);
  setTimeout(layoutActiveView, 260);
}

function getTopbarHeight() {
  return appSettings.compactMode ? compactTopbarHeight : regularTopbarHeight;
}

function getToolbarHeight() {
  return appSettings.compactMode ? compactToolbarHeight : regularToolbarHeight;
}

function schedulePersistWindowState() {
  clearTimeout(persistWindowStateTimer);
  persistWindowStateTimer = setTimeout(() => persistWindowState(), 250);
}

function persistWindowState(patch = {}) {
  const win = windowRef;
  if (!win) {
    return;
  }

  const nextSettings = {
    ...patch
  };

  if (!win.isFullScreen() && !win.isMinimized()) {
    nextSettings.windowBounds = win.getBounds();
  }

  if (!Object.prototype.hasOwnProperty.call(nextSettings, "windowFullScreen")) {
    nextSettings.windowFullScreen = win.isFullScreen();
  }

  appSettings = updateSettings(nextSettings);
}

function normalizeWindowBounds(bounds = {}) {
  const width = Math.max(980, Number(bounds.width) || 1440);
  const height = Math.max(680, Number(bounds.height) || 920);

  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
    return { width, height };
  }

  const display = screen.getDisplayMatching({
    x: bounds.x,
    y: bounds.y,
    width,
    height
  });
  const area = display.workArea;
  const x = Math.min(Math.max(bounds.x, area.x), area.x + Math.max(0, area.width - 200));
  const y = Math.min(Math.max(bounds.y, area.y), area.y + Math.max(0, area.height - 120));

  return { x, y, width, height };
}

function activeView() {
  return views.get(activeAccountId);
}

function sendNavigationState() {
  const win = windowRef;
  const view = activeView();
  if (!win || !view) {
    return;
  }

  win.webContents.send("view:navigation", {
    title: view.webContents.getTitle(),
    url: view.webContents.getURL(),
    canGoBack: view.webContents.navigationHistory.canGoBack(),
    canGoForward: view.webContents.navigationHistory.canGoForward()
  });
}

ipcMain.handle("accounts:list", () => ({
  accounts: webAccounts,
  activeAccountId,
  unreadCounts: Object.fromEntries(unreadCounts),
  isDevToolsEnabled,
  settings: appSettings,
  settingsPath: getSettingsPath(),
  appVersion: app.getVersion(),
  globalShortcut: globalShortcutStatus
}));

ipcMain.handle("accounts:add", (_event, input) => {
  const account = addAccount(input);
  webAccounts = loadAccounts();
  createAccountView(account);
  selectAccount(account.id);
  createApplicationMenu();
  const payload = accountStatePayload({ account });
  windowRef?.webContents.send("accounts:list-changed", payload);
  return payload;
});

ipcMain.handle("accounts:update", (_event, id, patch) => {
  const account = updateAccount(id, patch);
  webAccounts = loadAccounts();
  createApplicationMenu();
  const payload = accountStatePayload({ account });
  windowRef?.webContents.send("accounts:list-changed", payload);
  return payload;
});

ipcMain.handle("accounts:remove", async (_event, id, options = {}) => {
  const account = webAccounts.find((item) => item.id === id);
  const view = views.get(id);
  const win = windowRef;

  if (view && win) {
    win.removeBrowserView(view);
    view.webContents.close();
    views.delete(id);
  }

  if (options.clearSession && account?.partition) {
    await clearAccountSession(account.partition);
  }

  unreadCounts.delete(id);
  webAccounts = removeAccount(id);
  activeAccountId = activeAccountId === id ? webAccounts[0]?.id : activeAccountId;
  webAccounts.forEach(createAccountView);
  createApplicationMenu();

  if (activeAccountId) {
    selectAccount(activeAccountId);
  } else {
    broadcastAccountState();
  }

  return {
    accounts: webAccounts,
    activeAccountId,
    unreadCounts: Object.fromEntries(unreadCounts),
    settings: appSettings,
    appVersion: app.getVersion()
  };
});

ipcMain.handle("accounts:select", (_event, id) => {
  selectAccount(id);
  return { ok: true };
});

ipcMain.handle("accounts:reorder", (_event, ids) => {
  webAccounts = reorderAccounts(Array.isArray(ids) ? ids : []);
  createApplicationMenu();
  broadcastAccountState();
  return {
    accounts: webAccounts,
    activeAccountId,
    unreadCounts: Object.fromEntries(unreadCounts),
    settings: appSettings,
    appVersion: app.getVersion()
  };
});

ipcMain.handle("settings:update", (_event, patch) => {
  appSettings = updateSettings(patch);
  applyLoginItemSettings();
  createApplicationMenu();
  registerGlobalShortcut();
  layoutActiveView();
  broadcastAccountState();
  return {
    settings: appSettings,
    settingsPath: getSettingsPath(),
    appVersion: app.getVersion(),
    globalShortcut: globalShortcutStatus
  };
});

ipcMain.handle("security:set-pin", (_event, pin) => {
  const normalizedPin = normalizePin(pin);
  const salt = crypto.randomBytes(16).toString("hex");
  appSettings = updateSettings({
    pinEnabled: true,
    pinSalt: salt,
    pinHash: hashPin(normalizedPin, salt)
  });
  broadcastAccountState();
  return { settings: appSettings };
});

ipcMain.handle("security:disable-pin", () => {
  appSettings = updateSettings({
    pinEnabled: false,
    pinSalt: "",
    pinHash: ""
  });
  isInterfaceLocked = false;
  layoutActiveView();
  broadcastAccountState();
  return { settings: appSettings };
});

ipcMain.handle("security:verify-pin", (_event, pin) => {
  const ok = verifyPin(pin);
  if (ok) {
    isInterfaceLocked = false;
    layoutActiveView();
  }
  return { ok, settings: appSettings };
});

ipcMain.handle("settings:show-file", () => {
  shell.showItemInFolder(getSettingsPath());
  return { ok: true };
});

ipcMain.handle("view:reload", () => {
  activeView()?.webContents.reload();
  return { ok: true };
});

ipcMain.handle("view:back", () => {
  const view = activeView();
  if (view?.webContents.navigationHistory.canGoBack()) {
    view.webContents.navigationHistory.goBack();
  }
  return { ok: true };
});

ipcMain.handle("view:forward", () => {
  const view = activeView();
  if (view?.webContents.navigationHistory.canGoForward()) {
    view.webContents.navigationHistory.goForward();
  }
  return { ok: true };
});

ipcMain.handle("view:devtools", () => {
  if (isDevToolsEnabled) {
    activeView()?.webContents.openDevTools({ mode: "detach" });
  }
  return { ok: true };
});

ipcMain.handle("view:overlay", (_event, height) => {
  reservedOverlayHeight = Math.max(0, Number(height) || 0);
  if (reservedOverlayHeight > 0 && reservedOverlayHeight < 96) {
    reservedOverlayHeight = defaultOverlayHeight;
  }
  layoutActiveView();
  return { ok: true };
});

ipcMain.handle("view:locked", (_event, locked) => {
  isInterfaceLocked = Boolean(locked);
  layoutActiveView();
  return { ok: true };
});

function updateAccountTitleState(account) {
  const view = views.get(account.id);
  if (!view) {
    return;
  }

  const currentAccount = webAccounts.find((item) => item.id === account.id) || account;
  const title = view.webContents.getTitle();
  const previous = unreadCounts.get(account.id) || 0;
  const next = extractUnreadCount(title);
  unreadCounts.set(account.id, next);

  const hadRecentPreview = Date.now() - (recentPreviewAt.get(account.id) || 0) < 4000;
  if (next > previous && previous !== 0 && !hadRecentPreview) {
    showAccountNotification(currentAccount, next - previous);
  }

  broadcastAccountState();
  sendNavigationState();
}

function extractUnreadCount(title = "") {
  const match = title.match(/^\((\d+)\)/);
  return match ? Number(match[1]) : 0;
}

function broadcastAccountState() {
  const payload = accountStatePayload();
  windowRef?.webContents.send("accounts:list-changed", payload);
  updateDockBadge();
}

function accountStatePayload(extra = {}) {
  return {
    accounts: webAccounts,
    activeAccountId,
    unreadCounts: Object.fromEntries(unreadCounts),
    isDevToolsEnabled,
    settings: appSettings,
    settingsPath: getSettingsPath(),
    appVersion: app.getVersion(),
    globalShortcut: globalShortcutStatus,
    ...extra
  };
}

function updateDockBadge() {
  const total = [...unreadCounts.values()].reduce((sum, count) => sum + count, 0);
  app.setBadgeCount(total);
}

function showAccountNotification(account, delta) {
  if (
    !appSettings.notificationsEnabled ||
    account.notificationsEnabled === false ||
    !Notification.isSupported()
  ) {
    return;
  }

  const notification = new Notification({
    title: accountNotificationTitle(account),
    subtitle: platformName(account.platform),
    body: delta === 1 ? "Новое сообщение" : `Новых сообщений: ${delta}`
  });

  notification.on("click", () => {
    showMainWindow();
    selectAccount(account.id);
  });

  notification.show();
}

function showMessagePreviewNotification(account, preview) {
  if (
    !appSettings.notificationsEnabled ||
    !appSettings.messagePreviewsEnabled ||
    account.notificationsEnabled === false ||
    !Notification.isSupported()
  ) {
    return;
  }

  const title = cleanNotificationText(preview.title) || platformName(account.platform);
  const body = cleanNotificationText(preview.body) || "Новое сообщение";

  if (!shouldShowPreview(account.id, title, body)) {
    return;
  }

  recentPreviewAt.set(account.id, Date.now());

  const notification = new Notification({
    title: accountNotificationTitle(account),
    subtitle: title,
    body
  });

  notification.on("click", () => {
    showMainWindow();
    selectAccount(account.id);
  });

  notification.show();
}

function accountNotificationTitle(account) {
  const phone = cleanNotificationText(account.phone);
  return phone ? `${account.label} · ${phone}` : account.label;
}

function platformName(platform) {
  if (platform === "whatsapp") return "WhatsApp";
  if (platform === "telegram") return "Telegram";
  return "Instagram";
}

function cleanNotificationText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 220);
}

function shouldShowPreview(accountId, title, body) {
  const now = Date.now();
  const key = `${accountId}:${title}:${body}`;
  const previous = recentPreviewKeys.get(key) || 0;

  for (const [storedKey, timestamp] of recentPreviewKeys) {
    if (now - timestamp > 15000) {
      recentPreviewKeys.delete(storedKey);
    }
  }

  if (now - previous < 3000) {
    return false;
  }

  recentPreviewKeys.set(key, now);
  return true;
}

function configureAccountSession(account) {
  if (!account.partition || configuredSessionPartitions.has(account.partition)) {
    return;
  }

  configuredSessionPartitions.add(account.partition);
  const accountSession = session.fromPartition(account.partition);

  accountSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(isAllowedWebMessengerPermission(permission));
  });

  accountSession.setPermissionCheckHandler((_webContents, permission) => {
    return isAllowedWebMessengerPermission(permission);
  });
}

function isAllowedWebMessengerPermission(permission) {
  return [
    "notifications",
    "media",
    "fullscreen",
    "clipboard-sanitized-write"
  ].includes(permission);
}

function installNotificationBridge(view) {
  if (!view || view.webContents.isDestroyed()) {
    return;
  }

  view.webContents
    .executeJavaScript(notificationBridgeScript(), false)
    .catch(() => {});
}

function notificationBridgeScript() {
  return `
    (() => {
      if (window.__messengerHubNotificationBridgeInstalled) return;
      window.__messengerHubNotificationBridgeInstalled = true;

      const PREFIX = "__MESSENGER_HUB_NOTIFICATION__";
      const OriginalNotification = window.Notification;

      function emitNotification(title, options = {}) {
        try {
          console.info(PREFIX + JSON.stringify({
            title: String(title || ""),
            body: String(options.body || ""),
            tag: String(options.tag || ""),
            icon: String(options.icon || "")
          }));
        } catch (_) {}
      }

      function HubNotification(title, options = {}) {
        emitNotification(title, options);
        const target = document.createDocumentFragment();
        const notification = {
          title: String(title || ""),
          body: String(options.body || ""),
          tag: String(options.tag || ""),
          icon: String(options.icon || ""),
          dir: options.dir || "auto",
          lang: options.lang || "",
          data: options.data,
          onclick: null,
          onclose: null,
          onerror: null,
          onshow: null,
          close() {
            if (typeof notification.onclose === "function") {
              notification.onclose({ target: notification });
            }
          },
          addEventListener: target.addEventListener.bind(target),
          removeEventListener: target.removeEventListener.bind(target),
          dispatchEvent: target.dispatchEvent.bind(target)
        };
        setTimeout(() => {
          if (typeof notification.onshow === "function") {
            notification.onshow({ target: notification });
          }
        }, 0);
        return notification;
      }

      Object.defineProperty(HubNotification, "permission", {
        get() {
          return "granted";
        }
      });
      HubNotification.requestPermission = (callback) => {
        if (typeof callback === "function") callback("granted");
        return Promise.resolve("granted");
      };

      if (OriginalNotification) {
        HubNotification.prototype = OriginalNotification.prototype;
      }

      window.Notification = HubNotification;
    })();
  `;
}

function handleNotificationBridgeMessage(account, message) {
  const prefix = "__MESSENGER_HUB_NOTIFICATION__";
  if (typeof message !== "string" || !message.startsWith(prefix)) {
    return;
  }

  try {
    const preview = JSON.parse(message.slice(prefix.length));
    showMessagePreviewNotification(account, preview);
  } catch {
    // Ignore malformed page messages.
  }
}

function showMainWindow() {
  if (!windowRef) {
    createWindow();
    return;
  }

  if (windowRef.isMinimized()) {
    windowRef.restore();
  }

  windowRef.show();
  windowRef.focus();
}

function toggleMainWindow() {
  if (!windowRef || !windowRef.isVisible() || windowRef.isMinimized()) {
    showMainWindow();
    return;
  }

  requestRendererLock();
  windowRef.hide();
}

function applyLoginItemSettings() {
  if (!app.isReady() || !app.isPackaged) {
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: Boolean(appSettings.launchAtLogin),
    openAsHidden: true
  });
}

function registerGlobalShortcut() {
  if (!app.isReady()) {
    return;
  }

  globalShortcut.unregisterAll();
  const accelerator = appSettings.globalShortcut || defaultGlobalShortcut;

  if (appSettings.globalShortcutEnabled === false) {
    globalShortcutStatus = { accelerator, registered: false };
    broadcastAccountState();
    return;
  }

  const registered = globalShortcut.register(accelerator, toggleMainWindow);
  globalShortcutStatus = { accelerator, registered };
  broadcastAccountState();
}

function createApplicationMenu() {
  const template = [
    {
      label: "Messenger Hub",
      submenu: [
        {
          label: "Show Messenger Hub",
          accelerator: "CommandOrControl+Shift+M",
          click: showMainWindow
        },
        {
          label: "Hide Messenger Hub",
          accelerator: "CommandOrControl+H",
          click: () => {
            requestRendererLock();
            windowRef?.hide();
          }
        },
        { type: "separator" },
        {
          label: "Quick Switch...",
          accelerator: "CommandOrControl+K",
          click: () => windowRef?.webContents.send("command:open")
        },
        { type: "separator" },
        {
          label: "Launch at Login",
          type: "checkbox",
          checked: Boolean(appSettings.launchAtLogin),
          click: (menuItem) => {
            appSettings = updateSettings({ launchAtLogin: menuItem.checked });
            applyLoginItemSettings();
            broadcastAccountState();
          }
        },
        {
          label: "Keep Running in Background",
          type: "checkbox",
          checked: appSettings.keepInBackground !== false,
          click: (menuItem) => {
            appSettings = updateSettings({ keepInBackground: menuItem.checked });
            broadcastAccountState();
          }
        },
        { type: "separator" },
        {
          label: "Quit Messenger Hub",
          accelerator: "CommandOrControl+Q",
          click: quitApp
        }
      ]
    },
    {
      label: "Accounts",
      submenu: createAccountMenuItems()
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "togglefullscreen" },
        ...(isDevToolsEnabled ? [{ role: "toggleDevTools" }] : [])
      ]
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createAccountMenuItems() {
  if (webAccounts.length === 0) {
    return [{ label: "No accounts", enabled: false }];
  }

  return webAccounts.slice(0, 9).map((account, index) => ({
    label: `${index + 1}. ${account.label}`,
    accelerator: `CommandOrControl+${index + 1}`,
    type: "checkbox",
    checked: account.id === activeAccountId,
    click: () => selectAccount(account.id)
  }));
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function requestRendererLock() {
  if (!appSettings.pinEnabled || !windowRef) {
    return;
  }

  isInterfaceLocked = true;
  layoutActiveView();
  windowRef.webContents.send("security:lock");
}

function normalizePin(pin) {
  const normalizedPin = String(pin || "").trim();
  if (!/^\d{4,12}$/.test(normalizedPin)) {
    throw new Error("PIN must contain 4 to 12 digits");
  }
  return normalizedPin;
}

function hashPin(pin, salt) {
  return crypto.scryptSync(pin, salt, 32).toString("hex");
}

function verifyPin(pin) {
  if (!appSettings.pinEnabled || !appSettings.pinHash || !appSettings.pinSalt) {
    return true;
  }

  let candidate;
  try {
    candidate = hashPin(normalizePin(pin), appSettings.pinSalt);
  } catch {
    return false;
  }

  const saved = Buffer.from(appSettings.pinHash, "hex");
  const current = Buffer.from(candidate, "hex");
  return saved.length === current.length && crypto.timingSafeEqual(saved, current);
}

async function clearAccountSession(partition) {
  const accountSession = session.fromPartition(partition);
  await accountSession.clearStorageData({
    storages: [
      "cookies",
      "filesystem",
      "indexdb",
      "localstorage",
      "shadercache",
      "websql",
      "serviceworkers",
      "cachestorage"
    ]
  });
  await accountSession.clearCache();
}

app.whenReady().then(() => {
  createWindow();
  createApplicationMenu();
});

app.on("before-quit", () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (windowRef) {
    showMainWindow();
  } else {
    createWindow();
  }
});
