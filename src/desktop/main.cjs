const path = require("node:path");
const crypto = require("node:crypto");
const {
  app,
  BrowserWindow,
  dialog,
  WebContentsView,
  globalShortcut,
  ipcMain,
  Menu,
  net,
  Notification,
  powerMonitor,
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
const { createTray, destroyTray, updateTray } = require("./tray.cjs");
const { checkForUpdates, getUpdateStatus, setStatusListener } = require("./updater.cjs");
const { chooseGlobalShortcut, defaultGlobalShortcut } = require("./shortcuts.cjs");
const { canOpenExternally, isAllowedInsideView } = require("./navigation.cjs");
const { getLogFilePath, initLogger, logFromRenderer } = require("./logger.cjs");

// Папку профиля Electron по умолчанию выводит из поля name в package.json. Любое
// переименование пакета увело бы приложение на пустой профиль — со стороны это
// выглядит как одновременный разлогин во всех аккаунтах. Закрепляем путь явно.
// Переменная окружения нужна, чтобы проверять сборку на отдельном профиле,
// не трогая рабочие сессии.
app.setPath(
  "userData",
  process.env.MESSENGER_HUB_PROFILE_DIR ||
    path.join(app.getPath("appData"), "all-in-one-messengers")
);

initLogger(app.getPath("userData"), {
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron
});

// Без этого падение в главном процессе не оставляет следа вообще: окно просто
// исчезает, и понять причину на чужой машине невозможно.
process.on("uncaughtException", (error) => {
  console.error("Необработанная ошибка:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("Необработанный отказ промиса:", reason);
});

const regularTopbarHeight = 76;
const regularToolbarHeight = 52;
const compactTopbarHeight = 56;
const compactToolbarHeight = 44;
// Восемь тяжёлых веб-приложений, стартующих одновременно, забивали сеть и процессор
// настолько, что часть из них не успевала подняться. Разносим запуск во времени.
const accountLoadStaggerMs = 1500;
const storageFlushIntervalMs = 3 * 60 * 1000;
const onlineCheckIntervalMs = 5000;
const retryDelaysMs = [2000, 5000, 10000, 30000, 60000, 120000];
const maxReloadsAfterCrash = 3;

let windowRef;
let webAccounts = [];
let activeAccountId;
let appSettings = {};
const views = new Map();
const unreadCounts = new Map();
const configuredSessionPartitions = new Set();
const recentPreviewKeys = new Map();
const recentPreviewAt = new Map();
// "loading" | "ready" | "offline" — состояние загрузки страницы аккаунта.
// Раньше отличить «нет сети» от «разлогинило» было невозможно даже в коде.
const accountStatuses = new Map();
const retryTimers = new Map();
const retryAttempts = new Map();
// Аккаунты, чья текущая загрузка провалилась. Нужен отдельный признак, потому что
// страница ошибки Chromium — это тоже успешно загруженная страница.
const failedAccounts = new Set();
const reloadsAfterCrash = new Map();
const pendingLoadTimers = new Set();
const isDevToolsEnabled = process.env.MESSENGER_HUB_DEVTOOLS === "1";
let storageFlushTimer;
let startupUpdateCheckTimer;
let onlineWatchTimer;
let wasOnline = true;
let isFlushingBeforeQuit = false;
let isQuitting = false;
let isOverlayOpen = false;
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

  webAccounts.forEach((account) => createAccountView(account, { load: false }));
  startStaggeredLoad();
  startStorageFlushTimer();
  startOnlineWatch();

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
      // Закрытие окна пользователь воспринимает как выход, так что это
      // подходящий момент дописать сессии на диск.
      void flushAllSessions();
    }
  });
  win.on("closed", () => {
    windowRef = undefined;
  });

  createApplicationMenu();
  registerGlobalShortcut();
}

function createAccountView(account, { load = true } = {}) {
  const existingView = views.get(account.id);

  if (existingView) {
    if (!existingView.webContents.isDestroyed()) {
      return existingView;
    }

    // Окно закрыли и открыли заново: прежние вьюхи умерли вместе с ним.
    // Без этой проверки в списке оставались бы мёртвые пустые вкладки.
    views.delete(account.id);
    accountStatuses.delete(account.id);
  }

  configureAccountSession(account);

  const view = new WebContentsView({
    webPreferences: {
      partition: account.partition,
      preload: path.join(__dirname, "accountPreload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (canOpenExternally(url)) {
      void shell.openExternal(url);
    } else {
      console.info(`Blocked window.open with unsupported scheme: ${url}`);
    }

    return { action: "deny" };
  });

  // Вкладка должна оставаться на сайте своего мессенджера. Уход на посторонний
  // сайт внутри оболочки приложения — удобная площадка для поддельной формы входа,
  // поэтому такие переходы отправляем в системный браузер.
  view.webContents.on("will-navigate", (event, url) => {
    if (isAllowedInsideView(url, account.url)) {
      return;
    }

    event.preventDefault();
    console.info(`Navigation to ${url} moved out to the system browser`);

    if (canOpenExternally(url)) {
      void shell.openExternal(url);
    }
  });

  view.webContents.setUserAgent(account.userAgent);
  view.webContents.on("did-navigate", () => sendNavigationState());
  view.webContents.on("did-navigate-in-page", () => sendNavigationState());
  view.webContents.on("page-title-updated", () => updateAccountTitleState(account));
  view.webContents.on("did-finish-load", () => {
    // Chromium присылает did-finish-load и когда показал свою страницу ошибки.
    // Без этой проверки неудачная загрузка считалась успешной, а запланированный
    // повтор отменялся сразу после того, как был назначен.
    if (failedAccounts.has(account.id)) {
      return;
    }

    requestPersistentStorage(view, account);
    markAccountReady(account);
    updateAccountTitleState(account);
  });

  // Раньше этого обработчика не было вовсе: при обрыве связи вьюха навсегда
  // оставалась на странице ошибки Chromium, и пользователь читал это как разлогин.
  view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) {
      return; // -3 = ERR_ABORTED, обычная отмена при быстрой смене страницы.
    }

    console.error(`Account ${account.id} failed to load: ${errorDescription} (${errorCode})`);
    failedAccounts.add(account.id);
    scheduleAccountRetry(account);
  });

  view.webContents.on("render-process-gone", (_event, details) => {
    // При закрытии приложения вьюхи гибнут штатно — это не сбой.
    if (isQuitting) {
      return;
    }

    unreadCounts.set(account.id, 0);
    broadcastAccountState();

    if (details?.reason === "clean-exit") {
      return;
    }

    // Упавшая вкладка раньше оставалась белым прямоугольником до перезапуска
    // приложения. Поднимаем её сами, но не бесконечно: если страница падает
    // раз за разом, циклическая перезагрузка сделает только хуже.
    const attempts = (reloadsAfterCrash.get(account.id) || 0) + 1;
    reloadsAfterCrash.set(account.id, attempts);

    if (attempts > maxReloadsAfterCrash) {
      console.error(`Account ${account.id} keeps crashing, giving up after ${attempts} reloads`);
      setAccountStatus(account.id, "offline");
      return;
    }

    scheduleAccountRetry(account);
  });

  views.set(account.id, view);
  setAccountStatus(account.id, load ? "loading" : "idle");

  if (load) {
    loadAccountView(account);
  }

  return view;
}

function loadAccountView(account) {
  const view = views.get(account.id);
  if (!view || view.webContents.isDestroyed()) {
    return;
  }

  failedAccounts.delete(account.id);
  setAccountStatus(account.id, "loading");
  view.webContents.loadURL(account.url).catch((error) => {
    // loadURL отклоняется тем же кодом, что придёт в did-fail-load,
    // поэтому здесь только гасим необработанное отклонение промиса.
    console.error(`Account ${account.id} load rejected:`, error.message);
  });
}

// Активный аккаунт поднимаем сразу, остальные — по очереди. Счётчики непрочитанных
// по-прежнему приходят со всех аккаунтов, просто страницы стартуют не разом.
function startStaggeredLoad() {
  // Уже поднятые аккаунты не трогаем: повторный вызов при переоткрытии окна
  // не должен перезагружать работающие мессенджеры.
  const pending = webAccounts.filter(
    (account) => (accountStatuses.get(account.id) || "idle") === "idle"
  );
  const ordered = [
    ...pending.filter((account) => account.id === activeAccountId),
    ...pending.filter((account) => account.id !== activeAccountId)
  ];

  ordered.forEach((account, index) => {
    if (index === 0) {
      loadAccountView(account);
      return;
    }

    const timer = setTimeout(() => {
      pendingLoadTimers.delete(timer);
      loadAccountView(account);
    }, index * accountLoadStaggerMs);

    pendingLoadTimers.add(timer);
  });
}

function selectAccount(accountId = activeAccountId) {
  const win = windowRef;
  const nextView = views.get(accountId);

  if (!win || !nextView) {
    return;
  }

  const currentView = views.get(activeAccountId);
  if (currentView && currentView !== nextView) {
    win.contentView.removeChildView(currentView);
  }

  activeAccountId = accountId;
  appSettings = updateSettings({ lastAccountId: accountId });

  // Аккаунт, до которого ещё не дошла очередь ступенчатого запуска,
  // поднимаем немедленно — пользователь его как раз открыл.
  if (accountStatuses.get(accountId) === "idle") {
    const account = webAccounts.find((item) => item.id === accountId);
    if (account) {
      loadAccountView(account);
    }
  }

  win.contentView.addChildView(nextView);
  layoutActiveView();
  createApplicationMenu();
  sendToRenderer("accounts:changed", { activeAccountId });
  sendNavigationState();
}

function layoutActiveView() {
  const win = windowRef;
  const view = views.get(activeAccountId);

  if (!win || !view) {
    return;
  }

  // Пока открыт диалог или включена блокировка, вкладка просто прячется.
  // Раньше её приходилось сдвигать и сжимать вниз на высоту диалога, а при
  // блокировке уводить за нижний край окна: BrowserView всегда рисовался поверх
  // собственной страницы окна, и перекрыть его было нечем. Заодно исчезла
  // перевёрстка страницы мессенджера при каждом открытии настроек.
  if (isInterfaceLocked || isOverlayOpen) {
    view.setVisible(false);
    return;
  }

  view.setVisible(true);

  const bounds = win.getContentBounds();
  const reservedHeight = getTopbarHeight() + getToolbarHeight();

  view.setBounds({
    x: 0,
    y: reservedHeight,
    width: Math.max(320, bounds.width),
    height: Math.max(240, bounds.height - reservedHeight)
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

  sendToRenderer("view:navigation", {
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
  accountStatuses: Object.fromEntries(accountStatuses),
  updateStatus: getUpdateStatus(),
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
  sendToRenderer("accounts:list-changed", payload);
  return payload;
});

ipcMain.handle("accounts:update", (_event, id, patch) => {
  const account = updateAccount(id, patch);
  webAccounts = loadAccounts();
  createApplicationMenu();
  const payload = accountStatePayload({ account });
  sendToRenderer("accounts:list-changed", payload);
  return payload;
});

// Меню аккаунта нативное: раскрывается поверх вкладки мессенджера и не требует
// прятать её, как это было с меню, свёрстанным на странице оболочки.
ipcMain.handle("accounts:menu", (_event, id) => {
  const account = webAccounts.find((item) => item.id === id);

  if (!account || !windowRef) {
    return { ok: false };
  }

  Menu.buildFromTemplate([
    {
      label: "Редактировать",
      click: () => sendToRenderer("accounts:edit", { accountId: account.id })
    },
    { type: "separator" },
    {
      label: "Удалить",
      click: () => void confirmRemoveAccount(account, false)
    },
    {
      label: "Удалить и очистить вход",
      click: () => void confirmRemoveAccount(account, true)
    }
  ]).popup({ window: windowRef });

  return { ok: true };
});

ipcMain.handle("accounts:request-remove", (_event, id, options = {}) => {
  const account = webAccounts.find((item) => item.id === id);

  if (!account) {
    return { ok: false };
  }

  void confirmRemoveAccount(account, Boolean(options.clearSession));
  return { ok: true };
});

// Подтверждение спрашивается здесь, а не на странице оболочки. Раньше оно
// висело на window.prompt, а его Electron не поддерживает: вызов бросал
// исключение сразу после согласия пользователя, и аккаунт молча не удалялся.
async function confirmRemoveAccount(account, clearSession) {
  if (!windowRef) {
    return;
  }

  const confirmed = await askToRemove({
    title: "Удаление аккаунта",
    message: `Удалить «${account.label}»?`,
    detail: clearSession
      ? "Сессия входа будет очищена. Чтобы вернуться в этот аккаунт, понадобится войти заново с телефона."
      : "Сессия входа останется на диске, и аккаунт можно будет добавить обратно без повторного входа.",
    confirmLabel: clearSession ? "Удалить и очистить" : "Удалить"
  });

  if (!confirmed) {
    return;
  }

  // Очистка входа необратима, поэтому спрашиваем второй раз. Раньше вместо
  // этого предлагалось напечатать название аккаунта вручную.
  if (clearSession) {
    const confirmedAgain = await askToRemove({
      title: "Очистка входа",
      message: `Точно очистить вход для «${account.label}»?`,
      detail: "Отменить это будет нельзя: код придётся сканировать заново с телефона.",
      confirmLabel: "Да, очистить вход"
    });

    if (!confirmedAgain) {
      return;
    }
  }

  await removeAccountById(account.id, { clearSession });
}

async function askToRemove({ title, message, detail, confirmLabel }) {
  const { response } = await dialog.showMessageBox(windowRef, {
    type: "warning",
    buttons: ["Отмена", confirmLabel],
    defaultId: 0,
    cancelId: 0,
    title,
    message,
    detail
  });

  return response === 1;
}

async function removeAccountById(id, options = {}) {
  const account = webAccounts.find((item) => item.id === id);
  const view = views.get(id);
  const win = windowRef;

  if (view && win) {
    win.contentView.removeChildView(view);
    view.webContents.close();
    views.delete(id);
  }

  if (options.clearSession && account?.partition) {
    await clearAccountSession(account.partition);
  }

  clearAccountRetry(id);
  unreadCounts.delete(id);
  accountStatuses.delete(id);
  retryAttempts.delete(id);
  reloadsAfterCrash.delete(id);
  failedAccounts.delete(id);
  webAccounts = removeAccount(id);
  activeAccountId = activeAccountId === id ? webAccounts[0]?.id : activeAccountId;
  webAccounts.forEach(createAccountView);
  createApplicationMenu();

  if (activeAccountId) {
    selectAccount(activeAccountId);
  } else {
    broadcastAccountState();
  }
}

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

ipcMain.handle("logs:show", () => {
  const target = getLogFilePath();
  if (target) {
    shell.showItemInFolder(target);
  }
  return { ok: Boolean(target) };
});

ipcMain.on("log:renderer", (_event, level, text) => {
  logFromRenderer(level, String(text || "").slice(0, 2000));
});

ipcMain.handle("settings:show-file", () => {
  shell.showItemInFolder(getSettingsPath());
  return { ok: true };
});

ipcMain.handle("view:reload", () => {
  const account = webAccounts.find((item) => item.id === activeAccountId);

  // На странице ошибки reload() повторил бы саму ошибку, поэтому упавший
  // аккаунт грузим с его адреса заново и сбрасываем счётчик попыток.
  if (account && accountStatuses.get(account.id) === "offline") {
    retryAttempts.delete(account.id);
    clearAccountRetry(account.id);
    loadAccountView(account);
    return { ok: true };
  }

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

ipcMain.handle("view:overlay", (_event, open) => {
  isOverlayOpen = Boolean(open);
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
  sendToRenderer("accounts:list-changed", accountStatePayload());
  updateDockBadge();
}

// Состояние аккаунтов рассылается заметно чаще, чем раньше, и при выходе окно
// успевает исчезнуть раньше последней рассылки. Само по себе это не ошибка,
// поэтому просто молча пропускаем отправку в уже закрытое окно.
function sendToRenderer(channel, payload) {
  // При выходе кадр рендерера исчезает раньше, чем webContents помечается
  // уничтоженным, и Electron пишет в лог ошибку отправки. Обновлять интерфейс
  // на этом этапе всё равно незачем.
  if (isQuitting || !windowRef || windowRef.isDestroyed() || windowRef.webContents.isDestroyed()) {
    return;
  }

  try {
    windowRef.webContents.send(channel, payload);
  } catch {
    // Кадр рендерера мог быть уничтожен между проверкой и отправкой.
  }
}

function accountStatePayload(extra = {}) {
  return {
    accounts: webAccounts,
    activeAccountId,
    unreadCounts: Object.fromEntries(unreadCounts),
    accountStatuses: Object.fromEntries(accountStatuses),
    updateStatus: getUpdateStatus(),
    isDevToolsEnabled,
    settings: appSettings,
    settingsPath: getSettingsPath(),
    appVersion: app.getVersion(),
    globalShortcut: globalShortcutStatus,
    platform: process.platform,
    ...extra
  };
}

function updateDockBadge() {
  const total = [...unreadCounts.values()].reduce((sum, count) => sum + count, 0);
  app.setBadgeCount(total);
  refreshTray(total);
}

function refreshTray(totalUnread) {
  const offlineCount = webAccounts.filter(
    (account) => accountStatuses.get(account.id) === "offline"
  ).length;

  updateTray({
    totalUnread,
    offlineCount,
    items: webAccounts.map((account) => ({
      id: account.id,
      title: `${account.label} · ${platformName(account.platform)}`,
      detail: trayAccountDetail(account),
      isActive: account.id === activeAccountId
    }))
  });
}

function trayAccountDetail(account) {
  const status = accountStatuses.get(account.id);
  if (status === "offline") return "нет связи";
  if (status === "loading") return "загружается";
  if (status === "idle") return "в очереди";

  const unread = unreadCounts.get(account.id) || 0;
  return unread > 0 ? `${unread}` : "";
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

function setAccountStatus(accountId, status) {
  if (accountStatuses.get(accountId) === status) {
    return;
  }

  accountStatuses.set(accountId, status);
  broadcastAccountState();
}

function markAccountReady(account) {
  if (retryAttempts.has(account.id)) {
    console.info(`Account ${account.id} is back online`);
  }

  retryAttempts.delete(account.id);
  reloadsAfterCrash.delete(account.id);
  clearAccountRetry(account.id);
  setAccountStatus(account.id, "ready");
}

// Повтор с нарастающей паузой: короткие обрывы связи чинятся за пару секунд,
// а долгое отсутствие сети не превращается в бесконечный поток запросов.
function scheduleAccountRetry(account) {
  // При выходе вьюхи закрываются штатно, и поднимать их заново уже незачем.
  if (isQuitting) {
    return;
  }

  setAccountStatus(account.id, "offline");
  clearAccountRetry(account.id);

  const attempt = retryAttempts.get(account.id) || 0;
  const delay = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)];
  retryAttempts.set(account.id, attempt + 1);
  console.info(`Account ${account.id} retry #${attempt + 1} in ${delay}ms`);

  const timer = setTimeout(() => {
    retryTimers.delete(account.id);
    loadAccountView(account);
  }, delay);

  retryTimers.set(account.id, timer);
}

function clearAccountRetry(accountId) {
  const timer = retryTimers.get(accountId);
  if (timer) {
    clearTimeout(timer);
    retryTimers.delete(accountId);
  }
}

function retryOfflineAccounts(reason) {
  const offlineAccounts = webAccounts.filter(
    (account) => accountStatuses.get(account.id) === "offline"
  );

  if (offlineAccounts.length === 0) {
    return;
  }

  console.info(`Reloading ${offlineAccounts.length} account(s): ${reason}`);
  offlineAccounts.forEach((account, index) => {
    retryAttempts.delete(account.id);
    clearAccountRetry(account.id);

    const timer = setTimeout(() => {
      pendingLoadTimers.delete(timer);
      loadAccountView(account);
    }, index * 600);

    pendingLoadTimers.add(timer);
  });
}

// Ждать истечения паузы после возвращения сети незачем — поднимаем упавшие
// аккаунты сразу, как только связь появилась или Mac проснулся.
function startOnlineWatch() {
  clearInterval(onlineWatchTimer);
  wasOnline = net.isOnline();

  onlineWatchTimer = setInterval(() => {
    const isOnline = net.isOnline();
    if (isOnline && !wasOnline) {
      retryOfflineAccounts("network is back");
    }
    wasOnline = isOnline;
  }, onlineCheckIntervalMs);
}

// Chromium держит свежие куки и localStorage в памяти. Instagram регулярно
// перевыпускает sessionid, и выход до записи на диск означал вход заново.
function startStorageFlushTimer() {
  clearInterval(storageFlushTimer);
  storageFlushTimer = setInterval(() => {
    void flushAllSessions();
  }, storageFlushIntervalMs);
}

async function flushAllSessions() {
  const partitions = new Set(
    webAccounts.map((account) => account.partition).filter(Boolean)
  );

  await Promise.all(
    [...partitions].map(async (partition) => {
      try {
        const accountSession = session.fromPartition(partition);
        await accountSession.cookies.flushStore();
        accountSession.flushStorageData();
      } catch (error) {
        console.error(`Failed to flush ${partition}:`, error.message);
      }
    })
  );
}

// Без этого права Chromium считает данные сайта расходными и вправе удалить их,
// когда решит освободить место — то есть разлогинить все аккаунты разом.
function requestPersistentStorage(view, account) {
  if (!view || view.webContents.isDestroyed()) {
    return;
  }

  view.webContents
    .executeJavaScript(
      `(async () => {
        try {
          if (!navigator.storage || !navigator.storage.persist) {
            return "unsupported";
          }
          if (await navigator.storage.persisted()) {
            return "already";
          }
          return (await navigator.storage.persist()) ? "granted" : "denied";
        } catch (error) {
          return "error";
        }
      })();`,
      false
    )
    .then((result) => {
      console.info(`Account ${account.id} persistent storage: ${result}`);
    })
    .catch(() => {});
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
    "clipboard-sanitized-write",
    // Право «не удаляй мои данные». Без него IndexedDB мессенджеров считается
    // расходной и вычищается при нехватке квоты — со всеми сессиями сразу.
    "persistent-storage",
    // Нужен service worker'ам мессенджеров, чтобы доставить сообщения,
    // накопившиеся, пока связи не было.
    "background-sync"
  ].includes(permission);
}

// Уведомление пришло из вкладки аккаунта по выделенному каналу. Отправителя
// определяем по самой вкладке: сообщение больше нельзя подделать записью
// в консоль, и посторонние логи страниц сюда не попадают.
ipcMain.on("account:notification", (event, payload) => {
  const account = accountForWebContents(event.sender);
  if (!account) {
    return;
  }

  showMessagePreviewNotification(account, {
    title: String(payload?.title || ""),
    body: String(payload?.body || "")
  });
});

function accountForWebContents(sender) {
  for (const [accountId, view] of views) {
    if (!view.webContents.isDestroyed() && view.webContents.id === sender.id) {
      return webAccounts.find((account) => account.id === accountId);
    }
  }

  return undefined;
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

function hideMainWindow() {
  if (!windowRef) {
    return;
  }

  requestRendererLock();
  windowRef.hide();
}

function toggleMainWindow() {
  if (!windowRef || !windowRef.isVisible() || windowRef.isMinimized()) {
    showMainWindow();
    return;
  }

  hideMainWindow();
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
  const requested = appSettings.globalShortcut || defaultGlobalShortcut;

  if (appSettings.globalShortcutEnabled === false) {
    globalShortcutStatus = { accelerator: requested, requested, registered: false };
    broadcastAccountState();
    return;
  }

  globalShortcutStatus = chooseGlobalShortcut(requested, (accelerator) => {
    if (globalShortcut.register(accelerator, toggleMainWindow)) {
      return true;
    }

    console.info(`Global shortcut ${accelerator} is not available`);
    return false;
  });

  if (!globalShortcutStatus.registered) {
    console.error("No global shortcut could be registered");
  } else if (globalShortcutStatus.accelerator !== requested) {
    console.info(
      `Global shortcut ${requested} is taken, registered ${globalShortcutStatus.accelerator} instead`
    );
  } else {
    console.info(`Global shortcut registered: ${globalShortcutStatus.accelerator}`);
  }

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
          click: hideMainWindow
        },
        { type: "separator" },
        {
          label: "Quick Switch...",
          accelerator: "CommandOrControl+K",
          click: () => sendToRenderer("command:open")
        },
        { type: "separator" },
        {
          label: "Проверить обновления",
          click: () => {
            void checkForUpdates({ feedUrl: appSettings.updateFeedUrl, silent: false });
          }
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
  sendToRenderer("security:lock");
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

// Два экземпляра на одном профиле — это два процесса, пишущих в одни и те же базы
// Chromium. Так они повреждаются, и разлогинивает уже по-настоящему и навсегда.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    createWindow();
    createApplicationMenu();
    createTray({
      onShowWindow: showMainWindow,
      onHideWindow: hideMainWindow,
      onToggleWindow: toggleMainWindow,
      onSelectAccount: (accountId) => {
        showMainWindow();
        selectAccount(accountId);
      },
      onQuit: quitApp
    });
    refreshTray([...unreadCounts.values()].reduce((sum, count) => sum + count, 0));

    setStatusListener(() => broadcastAccountState());
    // Не на самом старте: сначала пусть поднимутся мессенджеры, ради которых
    // приложение и запускали.
    startupUpdateCheckTimer = setTimeout(() => {
      void checkForUpdates({ feedUrl: appSettings.updateFeedUrl, silent: true });
    }, 20000);

    // После пробуждения Mac сокеты мертвы, а страницы об этом ещё не знают.
    powerMonitor.on("resume", () => retryOfflineAccounts("system resumed"));
    powerMonitor.on("unlock-screen", () => retryOfflineAccounts("screen unlocked"));
  });

  app.on("before-quit", (event) => {
    isQuitting = true;
    globalShortcut.unregisterAll();
    clearInterval(storageFlushTimer);
    clearInterval(onlineWatchTimer);
    clearTimeout(startupUpdateCheckTimer);
    pendingLoadTimers.forEach(clearTimeout);
    pendingLoadTimers.clear();
    retryTimers.forEach(clearTimeout);
    retryTimers.clear();

    destroyTray();

    if (isFlushingBeforeQuit) {
      return;
    }

    // Откладываем выход, пока Chromium не допишет куки и localStorage на диск.
    // Ограничение по времени обязательно: приложение должно закрыться в любом случае.
    event.preventDefault();
    isFlushingBeforeQuit = true;

    Promise.race([
      flushAllSessions(),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ]).finally(() => app.quit());
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
}
