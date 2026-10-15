const path = require("node:path");
const {
  app,
  BrowserWindow,
  dialog,
  WebContentsView,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  screen,
  shell
} = require("electron");
const {
  addAccount,
  desktopChromeUserAgent,
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
const { extractUnreadCount, shouldNotifyAboutUnread } = require("./unread.cjs");
const {
  createPinGuard,
  createPinSalt,
  hashPin,
  normalizePin,
  shouldLockForIdle
} = require("./security.cjs");
const { normalizeWindowBounds } = require("./windowBounds.cjs");
const {
  clearAccountSession,
  configureAccountSession,
  flushSessions
} = require("./sessions.cjs");
const { applyApplicationMenu } = require("./appMenu.cjs");
const { attachContextMenu } = require("./contextMenu.cjs");
const { nextZoomFactor } = require("./zoom.cjs");
const {
  normalizeLayout,
  toggleHiddenLayout,
  viewRects,
  windowButtonPosition
} = require("./layout.cjs");
const {
  isBadgeDataUrl,
  shouldFlashTaskbar,
  taskbarBadgeText
} = require("./taskbarBadge.cjs");
const {
  forgetAccount,
  hadRecentPreview,
  initNotifications,
  platformName,
  showAccountNotification,
  showMessagePreviewNotification
} = require("./notifications.cjs");

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

// Восемь тяжёлых веб-приложений, стартующих одновременно, забивали сеть и процессор
// настолько, что часть из них не успевала подняться. Разносим запуск во времени.
const accountLoadStaggerMs = 1500;
const storageFlushIntervalMs = 3 * 60 * 1000;
const onlineCheckIntervalMs = 5000;
const idleLockCheckIntervalMs = 15000;
const retryDelaysMs = [2000, 5000, 10000, 30000, 60000, 120000];
const maxReloadsAfterCrash = 3;

let windowRef;
let webAccounts = [];
let activeAccountId;
// Раскладка «два аккаунта рядом»: правая половина и та, где сейчас работают.
// В неё попадает выбранный аккаунт, Cmd+R, масштаб и клик по уведомлению.
let secondaryAccountId;
let focusedPane = 0;
// Страницы, которые сейчас вставлены в окно.
const attachedViewIds = new Set();
let appSettings = {};
const views = new Map();
const unreadCounts = new Map();
// "loading" | "ready" | "offline" — состояние загрузки страницы аккаунта.
// Раньше отличить «нет сети» от «разлогинило» было невозможно даже в коде.
const accountStatuses = new Map();
const retryTimers = new Map();
const retryAttempts = new Map();
// Аккаунты, чья текущая загрузка провалилась. Нужен отдельный признак, потому что
// страница ошибки Chromium — это тоже успешно загруженная страница.
const failedAccounts = new Set();
// Когда назначен следующий повтор и чем закончилась последняя попытка —
// для экрана «Нет связи», который оболочка показывает вместо страницы ошибки.
const retryAt = new Map();
const lastLoadErrors = new Map();
// Аккаунты, для которых счётчик непрочитанных уже был замечен после загрузки.
// До этого уведомлять не о чем: первое значение — то, что накопилось,
// пока приложение было закрыто.
const seenUnreadBaseline = new Set();
const reloadsAfterCrash = new Map();
const pendingLoadTimers = new Set();
const isDevToolsEnabled = process.env.MESSENGER_HUB_DEVTOOLS === "1";
let storageFlushTimer;
let startupUpdateCheckTimer;
let onlineWatchTimer;
let idleLockTimer;
let wasOnline = true;
const pinGuard = createPinGuard();
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
  applyTheme();
  // Стартовый аккаунт, если его выбрали явно, важнее последнего открытого.
  // Раньше порядок был обратным, и настройка не действовала никогда: последний
  // открытый аккаунт записывается при каждом переключении.
  activeAccountId =
    webAccounts.find((account) => account.id === appSettings.startAccountId)?.id ||
    webAccounts.find((account) => account.id === appSettings.lastAccountId)?.id ||
    webAccounts[0]?.id;
  secondaryAccountId = appSettings.splitAccountId || undefined;
  ensureSecondaryAccount();

  const windowBounds = normalizeWindowBounds(appSettings.windowBounds, (rect) =>
    screen.getDisplayMatching(rect)
  );
  const win = new BrowserWindow({
    ...windowBounds,
    minWidth: 980,
    minHeight: 680,
    title: "Messenger Hub",
    backgroundColor: windowBackgroundColor(),
    // На macOS заголовок окна убран: кнопки окна встают в боковую панель,
    // и мессенджеру достаётся вся высота.
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: windowButtonPosition(currentLayout())
        }
      : {}),
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
  // Поля настроек и формы аккаунта тоже получают меню «Вырезать / Вставить».
  attachContextMenu(win.webContents, () => windowRef);

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
  win.on("focus", () => win.flashFrame(false));

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

  configureAccountSession(account.partition);

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

  view.webContents.setUserAgent(desktopChromeUserAgent());
  // Клик внутрь страницы делает её половину активной.
  view.webContents.on("focus", () => focusPaneOfAccount(account.id));
  attachContextMenu(view.webContents, () => windowRef);
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
    applyAccountZoom(view, account.id);
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
    lastLoadErrors.set(account.id, errorDescription);
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
  // Страница грузится заново, прежний счётчик больше не точка отсчёта:
  // иначе после каждого переподключения сыпались бы уведомления о старом.
  seenUnreadBaseline.delete(account.id);
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
  if (!windowRef || !views.get(accountId)) {
    return;
  }

  // В правую половину, если работают в ней. Аккаунт, который уже открыт
  // в другой половине, меняется с ней местами, а не открывается дважды.
  if (currentLayout() === "split" && focusedPane === 1 && secondaryAccountId) {
    if (accountId === activeAccountId) {
      activeAccountId = secondaryAccountId;
    }
    secondaryAccountId = accountId;
  } else {
    if (accountId === secondaryAccountId) {
      secondaryAccountId = activeAccountId;
    }
    activeAccountId = accountId;
  }

  ensureSecondaryAccount();
  appSettings = updateSettings({
    lastAccountId: activeAccountId,
    splitAccountId: secondaryAccountId || ""
  });

  // Аккаунт, до которого ещё не дошла очередь ступенчатого запуска,
  // поднимаем немедленно — пользователь его как раз открыл.
  for (const id of visibleAccountIds()) {
    if (accountStatuses.get(id) === "idle") {
      const account = webAccounts.find((item) => item.id === id);
      if (account) {
        loadAccountView(account);
      }
    }
  }

  layoutActiveView();
  createApplicationMenu();
  sendToRenderer("accounts:changed", { activeAccountId, secondaryAccountId, focusedPane });
  broadcastAccountState();
  sendNavigationState();
}

function currentLayout() {
  return normalizeLayout(appSettings);
}

// Правая половина должна показывать другой аккаунт, чем левая. Если прежний
// удалили или его нет, берётся первый подходящий.
function ensureSecondaryAccount() {
  if (currentLayout() !== "split") {
    return;
  }

  const isValid =
    secondaryAccountId !== activeAccountId &&
    webAccounts.some((account) => account.id === secondaryAccountId);

  if (!isValid) {
    secondaryAccountId = webAccounts.find((account) => account.id !== activeAccountId)?.id;
  }

  if (!secondaryAccountId) {
    focusedPane = 0;
  }
}

function visibleAccountIds() {
  const ids = [activeAccountId];
  if (currentLayout() === "split" && secondaryAccountId) {
    ids.push(secondaryAccountId);
  }
  return ids.filter(Boolean);
}

function focusedAccountId() {
  return currentLayout() === "split" && focusedPane === 1 && secondaryAccountId
    ? secondaryAccountId
    : activeAccountId;
}

function focusPaneOfAccount(accountId) {
  if (currentLayout() !== "split") {
    return;
  }

  const pane = accountId === secondaryAccountId ? 1 : accountId === activeAccountId ? 0 : focusedPane;
  if (pane !== focusedPane) {
    focusedPane = pane;
    createApplicationMenu();
    broadcastAccountState();
  }
}

// Раскладка поменялась: кнопки окна macOS переезжают, страницы раскладываются заново.
function applyLayout() {
  ensureSecondaryAccount();

  if (windowRef && process.platform === "darwin" && windowRef.setWindowButtonPosition) {
    windowRef.setWindowButtonPosition(windowButtonPosition(currentLayout()));
  }

  for (const id of visibleAccountIds()) {
    if (accountStatuses.get(id) === "idle") {
      const account = webAccounts.find((item) => item.id === id);
      if (account) {
        loadAccountView(account);
      }
    }
  }

  layoutActiveView();
}

function layoutActiveView() {
  const win = windowRef;

  if (!win) {
    return;
  }

  ensureSecondaryAccount();
  const ids = visibleAccountIds();

  for (const id of [...attachedViewIds]) {
    if (!ids.includes(id)) {
      const view = views.get(id);
      if (view && !view.webContents.isDestroyed()) {
        win.contentView.removeChildView(view);
      }
      attachedViewIds.delete(id);
    }
  }

  const { width, height } = win.getContentBounds();
  const rects = viewRects(currentLayout(), { width, height });
  ids.forEach((id, index) => layoutView(id, index === 0 ? rects.primary : rects.secondary));
}

function layoutView(accountId, bounds) {
  const win = windowRef;
  const view = views.get(accountId);

  if (!win || !view || view.webContents.isDestroyed() || !bounds) {
    return;
  }

  if (!attachedViewIds.has(accountId)) {
    win.contentView.addChildView(view);
    attachedViewIds.add(accountId);
  }

  // Пока открыт диалог или включена блокировка, вкладка просто прячется.
  // Раньше её приходилось сдвигать и сжимать вниз на высоту диалога, а при
  // блокировке уводить за нижний край окна: BrowserView всегда рисовался поверх
  // собственной страницы окна, и перекрыть его было нечем. Заодно исчезла
  // перевёрстка страницы мессенджера при каждом открытии настроек.
  //
  // Без связи вкладка тоже прячется: вместо страницы ошибки Chromium, которую
  // легко принять за выход из аккаунта, оболочка показывает свой экран.
  if (isInterfaceLocked || isOverlayOpen || accountStatuses.get(accountId) === "offline") {
    view.setVisible(false);
    return;
  }

  view.setVisible(true);
  view.setBounds(bounds);
}

function scheduleLayoutActiveView() {
  layoutActiveView();
  setTimeout(layoutActiveView, 80);
  setTimeout(layoutActiveView, 260);
}

// Тема «как в системе», светлая или тёмная. nativeTheme меняет и
// prefers-color-scheme для всех страниц, поэтому вслед за оболочкой
// переключаются меню, диалоги и мессенджеры, которые следуют теме системы.
function applyTheme() {
  const theme = ["light", "dark"].includes(appSettings.theme) ? appSettings.theme : "system";
  nativeTheme.themeSource = theme;
  windowRef?.setBackgroundColor(windowBackgroundColor());
}

function windowBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? "#111317" : "#EEF0F3";
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

function activeView() {
  return views.get(activeAccountId);
}

// Половина, в которой сейчас работают: для обновления, масштаба и навигации.
function focusedView() {
  return views.get(focusedAccountId());
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

// Тот же набор, что и в рассылке: странице с самого начала нужны платформа
// и счётчик для значка в панели задач.
ipcMain.handle("accounts:list", () => accountStatePayload());

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
    {
      label: "Уведомления",
      type: "checkbox",
      checked: account.notificationsEnabled !== false,
      click: (menuItem) => {
        updateAccount(account.id, { notificationsEnabled: menuItem.checked });
        webAccounts = loadAccounts();
        broadcastAccountState();
      }
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
  attachedViewIds.delete(id);

  if (options.clearSession && account?.partition) {
    await clearAccountSession(account.partition);
  }

  clearAccountRetry(id);
  unreadCounts.delete(id);
  accountStatuses.delete(id);
  retryAttempts.delete(id);
  reloadsAfterCrash.delete(id);
  failedAccounts.delete(id);
  seenUnreadBaseline.delete(id);
  lastLoadErrors.delete(id);
  forgetAccount(id);
  webAccounts = removeAccount(id);
  activeAccountId = activeAccountId === id ? webAccounts[0]?.id : activeAccountId;
  secondaryAccountId = secondaryAccountId === id ? undefined : secondaryAccountId;
  ensureSecondaryAccount();
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
  // PIN меняется только через свои обработчики, где спрашивается текущий PIN.
  // Общий путь настроек не должен позволять выключить блокировку в обход.
  const { pinEnabled, pinHash, pinSalt, ...safePatch } = patch || {};
  appSettings = updateSettings(safePatch);
  applyLoginItemSettings();
  applyTheme();
  applyLayout();
  createApplicationMenu();
  registerGlobalShortcut();
  broadcastAccountState();
  return {
    settings: appSettings,
    settingsPath: getSettingsPath(),
    appVersion: app.getVersion(),
    globalShortcut: globalShortcutStatus
  };
});

// Сменить или выключить уже заданный PIN можно, только назвав текущий:
// иначе любой, кто подошёл к открытому окну, снимал бы блокировку в настройках.
function checkCurrentPin(currentPin) {
  if (!appSettings.pinEnabled) {
    return { ok: true, retryAfterMs: 0 };
  }

  return pinGuard.check(currentPin, appSettings);
}

ipcMain.handle("security:set-pin", (_event, pin, currentPin) => {
  let normalizedPin;
  try {
    normalizedPin = normalizePin(pin);
  } catch {
    return { ok: false, reason: "invalid", settings: appSettings };
  }

  const current = checkCurrentPin(currentPin);
  if (!current.ok) {
    return { ok: false, reason: "wrong-pin", ...current, settings: appSettings };
  }

  const salt = createPinSalt();
  appSettings = updateSettings({
    pinEnabled: true,
    pinSalt: salt,
    pinHash: hashPin(normalizedPin, salt)
  });
  broadcastAccountState();
  return { ok: true, settings: appSettings };
});

ipcMain.handle("security:disable-pin", (_event, currentPin) => {
  const current = checkCurrentPin(currentPin);
  if (!current.ok) {
    return { ok: false, reason: "wrong-pin", ...current, settings: appSettings };
  }

  appSettings = updateSettings({
    pinEnabled: false,
    pinSalt: "",
    pinHash: ""
  });
  isInterfaceLocked = false;
  layoutActiveView();
  broadcastAccountState();
  return { ok: true, settings: appSettings };
});

ipcMain.handle("security:verify-pin", (_event, pin) => {
  const result = pinGuard.check(pin, appSettings);
  if (result.ok) {
    isInterfaceLocked = false;
    layoutActiveView();
  }
  return { ...result, settings: appSettings };
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

// Экран «Нет связи» в одной из двух половин обновляет именно свой аккаунт.
ipcMain.handle("view:reload", (_event, accountId) => {
  reloadActiveAccount(views.has(accountId) ? accountId : undefined);
  return { ok: true };
});

function setLayout(patch) {
  appSettings = updateSettings(patch);
  applyLayout();
  createApplicationMenu();
  broadcastAccountState();
}

function togglePanel() {
  setLayout(toggleHiddenLayout(appSettings));
}

ipcMain.handle("layout:toggle-panel", () => {
  togglePanel();
  return { ok: true };
});

// Шапка половины: щелчок делает её активной.
ipcMain.handle("layout:focus-pane", (_event, pane) => {
  if (currentLayout() === "split" && (pane === 0 || pane === 1)) {
    focusedPane = pane === 1 && !secondaryAccountId ? 0 : pane;
    views.get(focusedAccountId())?.webContents.focus();
    createApplicationMenu();
    broadcastAccountState();
  }
  return { ok: true };
});

ipcMain.handle("layout:swap", () => {
  if (currentLayout() === "split" && secondaryAccountId) {
    [activeAccountId, secondaryAccountId] = [secondaryAccountId, activeAccountId];
    appSettings = updateSettings({ lastAccountId: activeAccountId, splitAccountId: secondaryAccountId });
    layoutActiveView();
    createApplicationMenu();
    broadcastAccountState();
  }
  return { ok: true };
});

// Закрыть правую половину — вернуться к одному аккаунту в узкой полосе.
ipcMain.handle("layout:close-split", () => {
  if (focusedPane === 1 && secondaryAccountId) {
    activeAccountId = secondaryAccountId;
  }
  focusedPane = 0;
  setLayout({ layout: "rail", lastAccountId: activeAccountId });
  return { ok: true };
});

// Общая для кнопки в окне и Cmd+R в меню.
function reloadActiveAccount(accountId = focusedAccountId()) {
  const account = webAccounts.find((item) => item.id === accountId);

  // На странице ошибки reload() повторил бы саму ошибку, поэтому упавший
  // аккаунт грузим с его адреса заново и сбрасываем счётчик попыток.
  if (account && accountStatuses.get(account.id) === "offline") {
    retryAttempts.delete(account.id);
    clearAccountRetry(account.id);
    loadAccountView(account);
    return;
  }

  views.get(accountId)?.webContents.reload();
}

// Масштаб меняется у открытого аккаунта и запоминается в нём же.
function zoomActiveAccount(direction) {
  const account = webAccounts.find((item) => item.id === focusedAccountId());
  const view = focusedView();

  if (!account || !view || view.webContents.isDestroyed()) {
    return;
  }

  const zoomFactor = nextZoomFactor(account.zoomFactor, direction);
  view.webContents.setZoomFactor(zoomFactor);

  if (zoomFactor !== account.zoomFactor) {
    updateAccount(account.id, { zoomFactor });
    webAccounts = loadAccounts();
  }
}

// Chromium сбрасывает масштаб при переходе на другой сайт, поэтому
// сохранённое значение возвращается после каждой загрузки страницы.
function applyAccountZoom(view, accountId) {
  const account = webAccounts.find((item) => item.id === accountId);

  if (account && !view.webContents.isDestroyed()) {
    view.webContents.setZoomFactor(account.zoomFactor);
  }
}

ipcMain.handle("view:back", () => {
  goBackInActiveView();
  return { ok: true };
});

ipcMain.handle("view:forward", () => {
  goForwardInActiveView();
  return { ok: true };
});

// Кнопок «Назад» и «Вперёд» в окне больше нет — мессенджеру они почти не нужны.
// Остались пункты меню с Cmd+[ и Cmd+].
function goBackInActiveView() {
  const view = focusedView();
  if (view?.webContents.navigationHistory.canGoBack()) {
    view.webContents.navigationHistory.goBack();
  }
}

function goForwardInActiveView() {
  const view = focusedView();
  if (view?.webContents.navigationHistory.canGoForward()) {
    view.webContents.navigationHistory.goForward();
  }
}

ipcMain.handle("updates:check", async () => {
  await checkForUpdates({ feedUrl: appSettings.updateFeedUrl, silent: false });
  return { updateStatus: getUpdateStatus() };
});

ipcMain.handle("view:devtools", () => {
  if (isDevToolsEnabled) {
    focusedView()?.webContents.openDevTools({ mode: "detach" });
  }
  return { ok: true };
});

ipcMain.handle("view:overlay", (_event, open) => {
  isOverlayOpen = Boolean(open);
  layoutActiveView();
  return { ok: true };
});

ipcMain.handle("view:locked", (_event, locked) => {
  // Заблокироваться окно может само, а снять блокировку — только верный PIN
  // в security:verify-pin. Иначе разблокировка не зависела бы от PIN вовсе.
  if (locked) {
    isInterfaceLocked = true;
  } else if (!appSettings.pinEnabled) {
    isInterfaceLocked = false;
  }
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

  const hasBaseline = seenUnreadBaseline.has(account.id);
  seenUnreadBaseline.add(account.id);

  if (
    shouldNotifyAboutUnread({
      hasBaseline,
      previous,
      next,
      hadRecentPreview: hadRecentPreview(account.id)
    })
  ) {
    showAccountNotification(currentAccount, next - previous, appSettings);
  }

  if (
    windowRef &&
    shouldFlashTaskbar({
      platform: process.platform,
      hasBaseline,
      previous,
      next,
      isWindowFocused: windowRef.isFocused(),
      notificationsAllowed:
        appSettings.notificationsEnabled && currentAccount.notificationsEnabled !== false
    })
  ) {
    windowRef.flashFrame(true);
  }

  broadcastAccountState();
  sendNavigationState();
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
    secondaryAccountId: currentLayout() === "split" ? secondaryAccountId : undefined,
    focusedPane,
    layout: currentLayout(),
    unreadCounts: Object.fromEntries(unreadCounts),
    accountStatuses: Object.fromEntries(accountStatuses),
    accountRetries: accountRetryInfo(),
    updateStatus: getUpdateStatus(),
    isDevToolsEnabled,
    settings: appSettings,
    settingsPath: getSettingsPath(),
    appVersion: app.getVersion(),
    globalShortcut: globalShortcutStatus,
    platform: process.platform,
    taskbarBadge: process.platform === "win32" ? taskbarBadgeText(totalUnreadCount()) : "",
    ...extra
  };
}

function totalUnreadCount() {
  return [...unreadCounts.values()].reduce((sum, count) => sum + count, 0);
}

// Страница оболочки нарисовала счётчик — ставим его поверх значка в панели задач.
// Картинка, опоздавшая к уже изменившемуся счётчику, отбрасывается.
ipcMain.on("badge:overlay", (_event, dataUrl, text) => {
  if (process.platform !== "win32" || !windowRef || windowRef.isDestroyed()) {
    return;
  }

  const current = taskbarBadgeText(totalUnreadCount());
  if (text !== current) {
    return;
  }

  if (!current) {
    windowRef.setOverlayIcon(null, "");
    return;
  }

  if (!isBadgeDataUrl(dataUrl)) {
    return;
  }

  const image = nativeImage.createFromDataURL(dataUrl);
  if (!image.isEmpty()) {
    windowRef.setOverlayIcon(image, `Непрочитанных: ${current}`);
  }
});

function updateDockBadge() {
  const total = totalUnreadCount();
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

function setAccountStatus(accountId, status) {
  if (accountStatuses.get(accountId) === status) {
    return;
  }

  accountStatuses.set(accountId, status);

  // Открытый аккаунт потерял связь или вернулся — вкладку надо спрятать
  // или показать снова.
  if (visibleAccountIds().includes(accountId)) {
    layoutActiveView();
  }

  broadcastAccountState();
}

function markAccountReady(account) {
  if (retryAttempts.has(account.id)) {
    console.info(`Account ${account.id} is back online`);
  }

  retryAttempts.delete(account.id);
  reloadsAfterCrash.delete(account.id);
  lastLoadErrors.delete(account.id);
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
    retryAt.delete(account.id);
    loadAccountView(account);
  }, delay);

  retryTimers.set(account.id, timer);
  retryAt.set(account.id, Date.now() + delay);
  // Статус «нет связи» уже разослан, а время повтора стало известно только сейчас.
  broadcastAccountState();
}

function clearAccountRetry(accountId) {
  retryAt.delete(accountId);
  const timer = retryTimers.get(accountId);
  if (timer) {
    clearTimeout(timer);
    retryTimers.delete(accountId);
  }
}

// Для аккаунтов без связи: когда следующий повтор (0 — повтора не будет,
// страница сдалась после нескольких падений), какая попытка и с какой ошибкой.
function accountRetryInfo() {
  const info = {};

  for (const account of webAccounts) {
    if (accountStatuses.get(account.id) !== "offline") {
      continue;
    }

    info[account.id] = {
      at: retryAt.get(account.id) || 0,
      attempt: retryAttempts.get(account.id) || 0,
      error: lastLoadErrors.get(account.id) || ""
    };
  }

  return info;
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

// Автоблокировка по бездействию. Время берётся у системы: так набор текста
// в мессенджере считается работой, а входящие сообщения не сбрасывают отсчёт.
function startIdleLockWatch() {
  clearInterval(idleLockTimer);
  idleLockTimer = setInterval(() => {
    if (
      shouldLockForIdle({
        pinEnabled: appSettings.pinEnabled,
        isLocked: isInterfaceLocked,
        idleSeconds: powerMonitor.getSystemIdleTime(),
        lockAfterMinutes: appSettings.lockAfterMinutes
      })
    ) {
      console.info("Locking after system idle");
      requestRendererLock();
    }
  }, idleLockCheckIntervalMs);
}

// Chromium держит свежие куки и localStorage в памяти. Instagram регулярно
// перевыпускает sessionid, и выход до записи на диск означал вход заново.
function startStorageFlushTimer() {
  clearInterval(storageFlushTimer);
  storageFlushTimer = setInterval(() => {
    void flushAllSessions();
  }, storageFlushIntervalMs);
}

function flushAllSessions() {
  return flushSessions(webAccounts.map((account) => account.partition));
}

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

ipcMain.on("account:notification", (event, payload) => {
  const account = accountForWebContents(event.sender);
  if (!account) {
    return;
  }

  showMessagePreviewNotification(
    account,
    {
      title: String(payload?.title || ""),
      body: String(payload?.body || ""),
      clickId: Number.isSafeInteger(payload?.id) ? payload.id : 0
    },
    appSettings
  );
});

// Клик по уведомлению с текстом передаётся странице мессенджера, и она сама
// открывает чат, из которого пришло сообщение.
function forwardNotificationClick(accountId, clickId) {
  const view = views.get(accountId);

  if (!Number.isSafeInteger(clickId) || clickId <= 0 || !view || view.webContents.isDestroyed()) {
    return;
  }

  view.webContents.focus();
  view.webContents.send("account:notification-click", clickId);
}

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
  applyApplicationMenu({
    accounts: webAccounts,
    activeAccountId: focusedAccountId(),
    layout: currentLayout(),
    settings: appSettings,
    isDevToolsEnabled,
    actions: {
      onShowWindow: showMainWindow,
      onHideWindow: hideMainWindow,
      onQuickSwitch: () => sendToRenderer("command:open"),
      onCheckUpdates: () => {
        void checkForUpdates({ feedUrl: appSettings.updateFeedUrl, silent: false });
      },
      onToggleLaunchAtLogin: (checked) => {
        appSettings = updateSettings({ launchAtLogin: checked });
        applyLoginItemSettings();
        broadcastAccountState();
      },
      onToggleKeepInBackground: (checked) => {
        appSettings = updateSettings({ keepInBackground: checked });
        broadcastAccountState();
      },
      onSelectAccount: selectAccount,
      // Пункт меню передаёт первым аргументом сам себя — не путать с аккаунтом.
      onReloadView: () => reloadActiveAccount(),
      onSetLayout: (layout) => setLayout({ layout }),
      onTogglePanel: togglePanel,
      onGoBack: goBackInActiveView,
      onGoForward: goForwardInActiveView,
      onZoom: zoomActiveAccount,
      onQuit: quitApp
    }
  });
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
    refreshTray(totalUnreadCount());

    // Клик по уведомлению открывает окно на нужном аккаунте.
    initNotifications({
      onOpenAccount: (accountId, clickId) => {
        showMainWindow();
        selectAccount(accountId);
        forwardNotificationClick(accountId, clickId);
      }
    });

    setStatusListener(() => broadcastAccountState());
    // Не на самом старте: сначала пусть поднимутся мессенджеры, ради которых
    // приложение и запускали.
    startupUpdateCheckTimer = setTimeout(() => {
      void checkForUpdates({ feedUrl: appSettings.updateFeedUrl, silent: true });
    }, 20000);

    // После пробуждения Mac сокеты мертвы, а страницы об этом ещё не знают.
    powerMonitor.on("resume", () => retryOfflineAccounts("system resumed"));
    powerMonitor.on("unlock-screen", () => retryOfflineAccounts("screen unlocked"));

    // Человек заблокировал компьютер или закрыл крышку — значит, отошёл.
    powerMonitor.on("lock-screen", requestRendererLock);
    // Тема «как в системе»: фон окна, видимый до отрисовки страницы, следует за ней.
    nativeTheme.on("updated", () => windowRef?.setBackgroundColor(windowBackgroundColor()));
    powerMonitor.on("suspend", requestRendererLock);
    startIdleLockWatch();
  });

  app.on("before-quit", (event) => {
    isQuitting = true;
    globalShortcut.unregisterAll();
    clearInterval(storageFlushTimer);
    clearInterval(onlineWatchTimer);
    clearInterval(idleLockTimer);
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
