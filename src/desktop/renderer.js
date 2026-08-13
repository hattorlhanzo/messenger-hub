const accountList = document.getElementById("accountList");
const accountCount = document.getElementById("accountCount");
const pageTitle = document.getElementById("pageTitle");
const pageUrl = document.getElementById("pageUrl");
const backButton = document.getElementById("backButton");
const forwardButton = document.getElementById("forwardButton");
const reloadButton = document.getElementById("reloadButton");
const devtoolsButton = document.getElementById("devtoolsButton");
const addButton = document.getElementById("addButton");
const settingsButton = document.getElementById("settingsButton");
const accountMenu = document.getElementById("accountMenu");
const editAccountButton = document.getElementById("editAccountButton");
const deleteAccountButton = document.getElementById("deleteAccountButton");
const clearDeleteAccountButton = document.getElementById("clearDeleteAccountButton");
const modalBackdrop = document.getElementById("modalBackdrop");
const addForm = document.getElementById("addForm");
const cancelButton = document.getElementById("cancelButton");
const platformInput = document.getElementById("platformInput");
const labelInput = document.getElementById("labelInput");
const phoneInput = document.getElementById("phoneInput");
const phoneField = document.getElementById("phoneField");
const settingsBackdrop = document.getElementById("settingsBackdrop");
const settingsForm = document.getElementById("settingsForm");
const settingsCancelButton = document.getElementById("settingsCancelButton");
const managementAccounts = document.getElementById("managementAccounts");
const managementAccountCount = document.getElementById("managementAccountCount");
const operatorNameInput = document.getElementById("operatorNameInput");
const startAccountInput = document.getElementById("startAccountInput");
const notificationsInput = document.getElementById("notificationsInput");
const messagePreviewsInput = document.getElementById("messagePreviewsInput");
const launchAtLoginInput = document.getElementById("launchAtLoginInput");
const backgroundInput = document.getElementById("backgroundInput");
const compactModeInput = document.getElementById("compactModeInput");
const globalShortcutInput = document.getElementById("globalShortcutInput");
const globalShortcutStatus = document.getElementById("globalShortcutStatus");
const pinEnabledInput = document.getElementById("pinEnabledInput");
const pinInput = document.getElementById("pinInput");
const pinStatus = document.getElementById("pinStatus");
const settingsPath = document.getElementById("settingsPath");
const appVersionText = document.getElementById("appVersionText");
const openSettingsFileButton = document.getElementById("openSettingsFileButton");
const editBackdrop = document.getElementById("editBackdrop");
const editForm = document.getElementById("editForm");
const editLabelInput = document.getElementById("editLabelInput");
const editPhoneField = document.getElementById("editPhoneField");
const editPhoneInput = document.getElementById("editPhoneInput");
const editCancelButton = document.getElementById("editCancelButton");
const commandBackdrop = document.getElementById("commandBackdrop");
const commandInput = document.getElementById("commandInput");
const commandResults = document.getElementById("commandResults");
const onboardingBackdrop = document.getElementById("onboardingBackdrop");
const onboardingForm = document.getElementById("onboardingForm");
const onboardingNameInput = document.getElementById("onboardingNameInput");
const lockBackdrop = document.getElementById("lockBackdrop");
const lockForm = document.getElementById("lockForm");
const lockPinInput = document.getElementById("lockPinInput");
const lockError = document.getElementById("lockError");

let accounts = [];
let activeAccountId;
let unreadCounts = {};
let accountStatuses = {};
let settings = {};
let currentSettingsPath = "";
let currentGlobalShortcut = {};
let appVersion = "";
let menuAccountId;
let editingAccountId;
let draggedAccountId;
let didDragAccount = false;
let commandMatches = [];
let commandSelectedIndex = 0;
let lockTimer;
let isLocked = false;

function overlayHeight() {
  if (!commandBackdrop.hidden) {
    return 288;
  }

  if (!settingsBackdrop.hidden) {
    return 468;
  }

  if (!modalBackdrop.hidden || !settingsBackdrop.hidden || !editBackdrop.hidden || !onboardingBackdrop.hidden) {
    return 344;
  }

  if (!accountMenu.hidden) {
    return 132;
  }

  return 0;
}

function syncOverlay() {
  void window.messengerShell.setOverlayOpen(overlayHeight());
}

function createPlatformIcon(platform) {
  const glyph = document.createElement("span");
  glyph.className = `platformGlyph ${platform}`;
  glyph.setAttribute("aria-hidden", "true");
  return glyph;
}

function platformName(platform) {
  if (platform === "whatsapp") return "WhatsApp";
  if (platform === "telegram") return "Telegram";
  return "Instagram";
}

function renderAccounts() {
  accountCount.textContent = subtitleText();

  if (accounts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "emptyAccounts";
    empty.textContent = "Добавьте первый мессенджер";
    accountList.replaceChildren(empty);
    if (!settingsBackdrop.hidden) {
      renderManagementAccounts();
    }
    pageTitle.textContent = "Messenger Hub";
    pageUrl.textContent = "Добавьте WhatsApp, Telegram или Instagram";
    return;
  }

  accountList.replaceChildren(
    ...accounts.map((account) => {
      const status = accountStatuses[account.id] || "ready";
      const row = document.createElement("div");
      row.className = `account ${account.platform} status-${status}${account.id === activeAccountId ? " active" : ""}`;
      row.role = "button";
      row.tabIndex = 0;
      row.draggable = true;
      row.dataset.accountId = account.id;
      row.title = statusNote(account.id) || "Перетащите, чтобы изменить порядок";

      const icon = document.createElement("div");
      icon.className = "accountIcon";
      icon.append(createPlatformIcon(account.platform));

      // В компактном режиме подпись под названием скрыта, поэтому состояние
      // дублируется точкой на иконке — её видно всегда.
      const statusDot = document.createElement("span");
      statusDot.className = "statusDot";
      statusDot.setAttribute("aria-hidden", "true");
      icon.append(statusDot);

      const text = document.createElement("div");
      text.className = "accountText";
      const label = document.createElement("strong");
      label.textContent = account.label;
      const detail = document.createElement("span");
      detail.textContent = accountSubtitle(account);
      text.append(label, detail);

      const more = document.createElement("button");
      more.className = "accountMore";
      more.type = "button";
      more.title = "Действия";
      more.textContent = "⋯";
      more.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleAccountMenu(account, more);
      });

      const unread = unreadCounts[account.id] || 0;
      const badge = document.createElement("span");
      badge.className = "unreadBadge";
      badge.textContent = unread > 99 ? "99+" : String(unread);
      badge.hidden = unread === 0;

      row.append(icon, text, badge, more);
      row.addEventListener("click", () => {
        if (didDragAccount) {
          didDragAccount = false;
          return;
        }
        closeAccountMenu();
        void window.messengerShell.selectAccount(account.id);
      });
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          closeAccountMenu();
          void window.messengerShell.selectAccount(account.id);
        }
      });
      row.addEventListener("dragstart", (event) => {
        draggedAccountId = account.id;
        didDragAccount = true;
        row.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", account.id);
      });
      row.addEventListener("dragenter", () => {
        if (draggedAccountId && draggedAccountId !== account.id) {
          row.classList.add("dragOver");
        }
      });
      row.addEventListener("dragover", (event) => {
        if (!draggedAccountId || draggedAccountId === account.id) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      });
      row.addEventListener("dragleave", () => {
        row.classList.remove("dragOver");
      });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        row.classList.remove("dragOver");
        void reorderDraggedAccount(account.id, event.clientX, row.getBoundingClientRect());
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        clearDragState();
      });

      return row;
    })
  );

  if (!settingsBackdrop.hidden) {
    renderManagementAccounts();
  }
}

function openCommandPalette() {
  closeAccountMenu();
  closeModal();
  closeSettings();
  closeEdit();
  commandInput.value = "";
  commandSelectedIndex = Math.max(
    0,
    accounts.findIndex((account) => account.id === activeAccountId)
  );
  commandBackdrop.hidden = false;
  renderCommandResults();
  syncOverlay();
  commandInput.focus();
  commandInput.select();
}

function closeCommandPalette() {
  commandBackdrop.hidden = true;
  commandInput.value = "";
  commandMatches = [];
  commandSelectedIndex = 0;
  syncOverlay();
}

function renderCommandResults() {
  const query = commandInput.value.trim().toLowerCase();
  commandMatches = accounts.filter((account) => commandSearchText(account).includes(query));

  if (commandMatches.length === 0) {
    commandSelectedIndex = 0;
    const empty = document.createElement("div");
    empty.className = "commandEmpty";
    empty.textContent = "Ничего не найдено";
    commandResults.replaceChildren(empty);
    return;
  }

  commandSelectedIndex = Math.min(commandSelectedIndex, commandMatches.length - 1);
  commandResults.replaceChildren(
    ...commandMatches.map((account, index) => {
      const row = document.createElement("button");
      row.className = `commandResult ${account.platform}${index === commandSelectedIndex ? " selected" : ""}`;
      row.type = "button";
      row.dataset.accountId = account.id;

      const icon = document.createElement("div");
      icon.className = "accountIcon";
      icon.append(createPlatformIcon(account.platform));

      const text = document.createElement("div");
      text.className = "commandResultText";
      const title = document.createElement("strong");
      title.textContent = account.label;
      const meta = document.createElement("span");
      meta.textContent = `${platformName(account.platform)} · ${accountSubtitle(account)}`;
      text.append(title, meta);

      const hint = document.createElement("span");
      hint.className = "commandHint";
      hint.textContent = account.id === activeAccountId ? "Открыт" : "Enter";

      row.append(icon, text, hint);
      row.addEventListener("mouseenter", () => {
        commandSelectedIndex = index;
        renderCommandResults();
      });
      row.addEventListener("click", () => {
        void selectCommandAccount(account.id);
      });
      return row;
    })
  );
}

function commandSearchText(account) {
  return [
    account.label,
    account.phone,
    account.platform,
    platformName(account.platform),
    account.id
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

async function selectCommandAccount(accountId = commandMatches[commandSelectedIndex]?.id) {
  if (!accountId) {
    return;
  }

  closeCommandPalette();
  await window.messengerShell.selectAccount(accountId);
}

function renderManagementAccounts() {
  managementAccountCount.textContent = `${accounts.length}`;
  managementAccounts.replaceChildren(
    ...accounts.map((account, index) => {
      const row = document.createElement("div");
      row.className = `managementAccount ${account.platform}${account.id === activeAccountId ? " active" : ""}${account.notificationsEnabled === false ? " muted" : ""}`;
      row.dataset.accountId = account.id;

      const icon = document.createElement("div");
      icon.className = "accountIcon";
      icon.append(createPlatformIcon(account.platform));

      const text = document.createElement("div");
      text.className = "managementAccountText";
      const title = document.createElement("strong");
      title.textContent = account.label;
      const meta = document.createElement("span");
      meta.textContent = `${platformName(account.platform)} · ${accountSubtitle(account)}${account.notificationsEnabled === false ? " · уведомления выкл." : ""}`;
      text.append(title, meta);

      const shortcut = document.createElement("span");
      shortcut.className = "shortcutHint";
      shortcut.textContent = index < 9 ? `Cmd+${index + 1}` : "";

      const actions = document.createElement("div");
      actions.className = "managementActions";
      actions.append(
        createManagementButton("Открыть", "select"),
        createManagementButton("Ред.", "edit"),
        createManagementButton(
          account.notificationsEnabled === false ? "Вкл. увед." : "Без увед.",
          "notifications"
        ),
        createManagementButton("Удал.+вход", "clear", "danger"),
        createManagementButton("Удалить", "delete", "danger")
      );

      row.append(icon, text, shortcut, actions);
      return row;
    })
  );
}

function createManagementButton(label, action, tone = "") {
  const button = document.createElement("button");
  button.className = `miniButton ${tone}`;
  button.type = "button";
  button.dataset.action = action;
  button.textContent = label;
  return button;
}

accountList.addEventListener("dragover", (event) => {
  if (!draggedAccountId) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
});

accountList.addEventListener("drop", (event) => {
  if (!draggedAccountId || event.target.closest?.(".account")) {
    return;
  }

  event.preventDefault();
  const lastAccount = accounts.at(-1);
  if (lastAccount) {
    void reorderDraggedAccount(lastAccount.id, Number.POSITIVE_INFINITY);
  }
});

async function reorderDraggedAccount(targetAccountId, pointerX, targetRect) {
  if (!draggedAccountId || draggedAccountId === targetAccountId) {
    clearDragState();
    return;
  }

  const nextAccounts = [...accounts];
  const fromIndex = nextAccounts.findIndex((account) => account.id === draggedAccountId);
  const targetIndex = nextAccounts.findIndex((account) => account.id === targetAccountId);

  if (fromIndex < 0 || targetIndex < 0) {
    clearDragState();
    return;
  }

  const [draggedAccount] = nextAccounts.splice(fromIndex, 1);
  const adjustedTargetIndex = nextAccounts.findIndex((account) => account.id === targetAccountId);
  const shouldPlaceAfter = targetRect
    ? pointerX > targetRect.left + targetRect.width / 2
    : true;
  const insertIndex = adjustedTargetIndex + (shouldPlaceAfter ? 1 : 0);
  nextAccounts.splice(insertIndex, 0, draggedAccount);

  accounts = nextAccounts;
  renderAccounts();

  const state = await window.messengerShell.reorderAccounts(
    nextAccounts.map((account) => account.id)
  );
  accounts = state.accounts;
  activeAccountId = state.activeAccountId;
  unreadCounts = state.unreadCounts || {};
  settings = state.settings || settings;
  renderAccounts();
  clearDragState();
}

function clearDragState() {
  draggedAccountId = undefined;
  document.querySelectorAll(".account.dragOver, .account.dragging").forEach((row) => {
    row.classList.remove("dragOver", "dragging");
  });
  setTimeout(() => {
    didDragAccount = false;
  }, 120);
}

function editAccount(account) {
  editingAccountId = account.id;
  editLabelInput.value = account.label;
  editPhoneInput.value = account.phone || "";
  editPhoneField.hidden = account.platform !== "whatsapp";
  editBackdrop.hidden = false;
  syncOverlay();
  editLabelInput.focus();
  editLabelInput.select();
}

function toggleAccountMenu(account, anchor) {
  if (!accountMenu.hidden && menuAccountId === account.id) {
    closeAccountMenu();
    return;
  }

  menuAccountId = account.id;
  const rect = anchor.getBoundingClientRect();
  const menuWidth = 220;
  accountMenu.style.top = `${Math.round(rect.bottom + 8)}px`;
  accountMenu.style.left = `${Math.min(
    window.innerWidth - menuWidth - 8,
    Math.max(8, Math.round(rect.right - menuWidth))
  )}px`;
  accountMenu.hidden = false;
  syncOverlay();
}

function closeAccountMenu() {
  accountMenu.hidden = true;
  menuAccountId = undefined;
  syncOverlay();
}

function menuAccount() {
  return accounts.find((account) => account.id === menuAccountId);
}

function accountSubtitle(account) {
  const status = statusNote(account.id);
  if (status) {
    return status;
  }

  if (account.platform === "whatsapp") {
    return account.phone || "номер не задан";
  }

  return account.platform;
}

// Пока страница не поднялась, показываем именно это, а не номер телефона:
// «нет связи» и «выкинуло из аккаунта» со стороны выглядят одинаково,
// и различить их — половина решения проблемы.
function statusNote(accountId) {
  const status = accountStatuses[accountId];
  if (status === "offline") return "нет связи, переподключаюсь";
  if (status === "loading") return "загружается…";
  if (status === "idle") return "в очереди на загрузку";
  return "";
}

async function init() {
  const state = await window.messengerShell.getAccounts();
  accounts = state.accounts;
  activeAccountId = state.activeAccountId;
  unreadCounts = state.unreadCounts || {};
  accountStatuses = state.accountStatuses || {};
  settings = state.settings || {};
  currentSettingsPath = state.settingsPath || "";
  currentGlobalShortcut = state.globalShortcut || {};
  appVersion = state.appVersion || "";
  devtoolsButton.hidden = !state.isDevToolsEnabled;
  applySettingsMode();
  renderAccounts();
  maybeOpenOnboarding();
  setupIdleLock();
  if (settings.pinEnabled) {
    showLock();
  }
}

window.messengerShell.onAccountChanged((state) => {
  activeAccountId = state.activeAccountId;
  renderAccounts();
});

window.messengerShell.onAccountListChanged((state) => {
  accounts = state.accounts;
  activeAccountId = state.activeAccountId;
  unreadCounts = state.unreadCounts || {};
  accountStatuses = state.accountStatuses || {};
  settings = state.settings || settings;
  currentSettingsPath = state.settingsPath || currentSettingsPath;
  currentGlobalShortcut = state.globalShortcut || currentGlobalShortcut;
  appVersion = state.appVersion || appVersion;
  devtoolsButton.hidden = !state.isDevToolsEnabled;
  applySettingsMode();
  renderAccounts();
  setupIdleLock();
});

window.messengerShell.onNavigationChanged((state) => {
  pageTitle.textContent = state.title || "Loading";
  pageUrl.textContent = state.url || "";
  backButton.disabled = !state.canGoBack;
  forwardButton.disabled = !state.canGoForward;
});

window.messengerShell.onCommandOpen(() => {
  openCommandPalette();
});

window.messengerShell.onSecurityLock(() => {
  showLock();
});

backButton.addEventListener("click", () => {
  void window.messengerShell.goBack();
});

forwardButton.addEventListener("click", () => {
  void window.messengerShell.goForward();
});

reloadButton.addEventListener("click", () => {
  void window.messengerShell.reload();
});

devtoolsButton.addEventListener("click", () => {
  void window.messengerShell.openDevTools();
});

document.addEventListener("click", (event) => {
  if (!accountMenu.hidden && !accountMenu.contains(event.target)) {
    closeAccountMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandPalette();
    return;
  }

  if (event.key !== "Escape") {
    return;
  }

  if (!commandBackdrop.hidden) closeCommandPalette();
  closeAccountMenu();
  if (!modalBackdrop.hidden) closeModal();
  if (!settingsBackdrop.hidden) closeSettings();
  if (!editBackdrop.hidden) closeEdit();
});

commandInput.addEventListener("input", () => {
  commandSelectedIndex = 0;
  renderCommandResults();
});

commandInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    commandSelectedIndex = Math.min(commandSelectedIndex + 1, commandMatches.length - 1);
    renderCommandResults();
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    commandSelectedIndex = Math.max(commandSelectedIndex - 1, 0);
    renderCommandResults();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    void selectCommandAccount();
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeCommandPalette();
  }
});

commandBackdrop.addEventListener("click", (event) => {
  if (event.target === commandBackdrop) {
    closeCommandPalette();
  }
});

editAccountButton.addEventListener("click", async () => {
  const account = menuAccount();
  closeAccountMenu();
  if (account) {
    editAccount(account);
  }
});

managementAccounts.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  const row = event.target.closest(".managementAccount");

  if (!button || !row) {
    return;
  }

  const account = accounts.find((item) => item.id === row.dataset.accountId);
  if (!account) {
    return;
  }

  const action = button.dataset.action;
  if (action === "select") {
    await window.messengerShell.selectAccount(account.id);
    return;
  }

  if (action === "edit") {
    closeSettings();
    editAccount(account);
    return;
  }

  if (action === "notifications") {
    await toggleAccountNotifications(account);
    return;
  }

  if (action === "clear") {
    await removeAccountWithConfirm(account, true);
    return;
  }

  if (action === "delete") {
    await removeAccountWithConfirm(account, false);
  }
});

editCancelButton.addEventListener("click", () => {
  closeEdit();
});

editBackdrop.addEventListener("click", (event) => {
  if (event.target === editBackdrop) {
    closeEdit();
  }
});

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const account = accounts.find((item) => item.id === editingAccountId);
  if (!account) {
    closeEdit();
    return;
  }

  const state = await window.messengerShell.updateAccount(account.id, {
    label: editLabelInput.value.trim() || account.label,
    phone: account.platform === "whatsapp" ? editPhoneInput.value.trim() : ""
  });

  accounts = state.accounts;
  activeAccountId = state.activeAccountId;
  unreadCounts = state.unreadCounts || {};
  settings = state.settings || settings;
  renderAccounts();
  closeEdit();
});

deleteAccountButton.addEventListener("click", async () => {
  const account = menuAccount();
  closeAccountMenu();
  await removeAccountWithConfirm(account, false);
});

clearDeleteAccountButton.addEventListener("click", async () => {
  const account = menuAccount();
  closeAccountMenu();
  await removeAccountWithConfirm(account, true);
});

addButton.addEventListener("click", () => {
  openAddMessenger();
});

settingsButton.addEventListener("click", () => {
  closeAccountMenu();
  renderSettingsForm();
  settingsBackdrop.hidden = false;
  syncOverlay();
  startAccountInput.focus();
});

settingsCancelButton.addEventListener("click", () => {
  closeSettings();
});

openSettingsFileButton.addEventListener("click", () => {
  void window.messengerShell.showSettingsFile();
});

settingsBackdrop.addEventListener("click", (event) => {
  if (event.target === settingsBackdrop) {
    closeSettings();
  }
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pinValue = pinInput.value.trim();

  if (pinValue && !/^\d{4,12}$/.test(pinValue)) {
    window.alert("PIN должен состоять из 4-12 цифр.");
    pinInput.focus();
    return;
  }

  if (pinEnabledInput.checked && !settings.pinEnabled && !pinValue) {
    window.alert("Введите новый PIN, чтобы включить блокировку.");
    pinInput.focus();
    return;
  }

  const state = await window.messengerShell.updateSettings({
    operatorName: operatorNameInput.value.trim(),
    startAccountId: startAccountInput.value,
    notificationsEnabled: notificationsInput.checked,
    messagePreviewsEnabled: messagePreviewsInput.checked,
    launchAtLogin: launchAtLoginInput.checked,
    keepInBackground: backgroundInput.checked,
    compactMode: compactModeInput.checked,
    globalShortcutEnabled: globalShortcutInput.checked,
    lockAfterMinutes: Number(settings.lockAfterMinutes) || 5
  });
  settings = state.settings;
  currentSettingsPath = state.settingsPath || currentSettingsPath;
  currentGlobalShortcut = state.globalShortcut || currentGlobalShortcut;

  if (pinValue) {
    const pinState = await window.messengerShell.setPin(pinValue);
    settings = pinState.settings || settings;
  } else if (!pinEnabledInput.checked && settings.pinEnabled) {
    const pinState = await window.messengerShell.disablePin();
    settings = pinState.settings || settings;
  }

  pinInput.value = "";
  setupIdleLock();
  applySettingsMode();
  closeSettings();
});

lockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = await window.messengerShell.verifyPin(lockPinInput.value);

  if (!result.ok) {
    lockError.hidden = false;
    lockPinInput.select();
    return;
  }

  settings = result.settings || settings;
  hideLock();
});

["mousemove", "mousedown", "keydown", "touchstart", "wheel"].forEach((eventName) => {
  document.addEventListener(
    eventName,
    () => {
      if (!isLocked) {
        resetIdleLockTimer();
      }
    },
    { passive: true }
  );
});

onboardingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const state = await window.messengerShell.updateSettings({
    operatorName: onboardingNameInput.value.trim(),
    onboardingComplete: true
  });
  settings = state.settings;
  currentSettingsPath = state.settingsPath || currentSettingsPath;
  onboardingBackdrop.hidden = true;
  renderAccounts();
  syncOverlay();
  openAddMessenger();
});

cancelButton.addEventListener("click", () => {
  closeModal();
});

modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) {
    closeModal();
  }
});

platformInput.addEventListener("change", () => {
  updatePhoneField();
  if (!labelInput.value.trim()) {
    labelInput.value =
      platformInput.value === "whatsapp"
        ? "WhatsApp"
        : platformInput.value === "telegram"
          ? "Telegram"
          : "Instagram";
  }
});

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const platform = platformInput.value;
  const label = labelInput.value.trim();
  const phone = phoneInput.value.trim();

  const state = await window.messengerShell.addAccount({
    platform,
    label,
    phone
  });

  accounts = state.accounts;
  activeAccountId = state.activeAccountId;
  unreadCounts = state.unreadCounts || {};
  renderAccounts();
  closeModal();
});

function closeModal() {
  modalBackdrop.hidden = true;
  addForm.reset();
  updatePhoneField();
  syncOverlay();
}

function renderSettingsForm() {
  operatorNameInput.value = settings.operatorName || "";
  startAccountInput.replaceChildren(
    ...accounts.map((account) => {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = account.label;
      option.selected = account.id === (settings.startAccountId || activeAccountId);
      return option;
    })
  );
  notificationsInput.checked = settings.notificationsEnabled !== false;
  messagePreviewsInput.checked = settings.messagePreviewsEnabled !== false;
  launchAtLoginInput.checked = Boolean(settings.launchAtLogin);
  backgroundInput.checked = settings.keepInBackground !== false;
  compactModeInput.checked = Boolean(settings.compactMode);
  globalShortcutInput.checked = settings.globalShortcutEnabled !== false;
  pinEnabledInput.checked = Boolean(settings.pinEnabled);
  pinInput.value = "";
  pinStatus.textContent = settings.pinEnabled ? "Включена" : "Выключена";
  renderGlobalShortcutStatus();
  settingsPath.textContent = currentSettingsPath ? `Файл: ${currentSettingsPath}` : "";
  appVersionText.textContent = appVersion ? `Версия: ${appVersion}` : "";
  renderManagementAccounts();
}

function subtitleText() {
  const countText = `${accounts.length} ${accounts.length === 1 ? "session" : "sessions"}`;
  return settings.operatorName ? `${settings.operatorName} · ${countText}` : countText;
}

function maybeOpenOnboarding() {
  if (settings.onboardingComplete) {
    return;
  }

  if (accounts.length > 0) {
    settings = { ...settings, onboardingComplete: true };
    void window.messengerShell.updateSettings({ onboardingComplete: true });
    return;
  }

  closeAccountMenu();
  onboardingNameInput.value = settings.operatorName || "";
  onboardingBackdrop.hidden = false;
  syncOverlay();
  onboardingNameInput.focus();
}

function openAddMessenger() {
  closeAccountMenu();
  modalBackdrop.hidden = false;
  updatePhoneField();
  syncOverlay();
  platformInput.focus();
}

function applySettingsMode() {
  document.body.classList.toggle("compactMode", Boolean(settings.compactMode));
}

function setupIdleLock() {
  clearTimeout(lockTimer);
  if (!settings.pinEnabled || isLocked) {
    return;
  }
  resetIdleLockTimer();
}

function resetIdleLockTimer() {
  clearTimeout(lockTimer);
  if (!settings.pinEnabled || isLocked) {
    return;
  }

  const minutes = Math.max(1, Number(settings.lockAfterMinutes) || 5);
  lockTimer = setTimeout(showLock, minutes * 60 * 1000);
}

function showLock() {
  if (!settings.pinEnabled) {
    return;
  }

  isLocked = true;
  clearTimeout(lockTimer);
  closeAccountMenu();
  closeCommandPalette();
  closeModal();
  closeSettings();
  closeEdit();
  onboardingBackdrop.hidden = true;
  lockError.hidden = true;
  lockPinInput.value = "";
  lockBackdrop.hidden = false;
  void window.messengerShell.setLocked(true);
  requestAnimationFrame(() => lockPinInput.focus());
}

function hideLock() {
  isLocked = false;
  lockBackdrop.hidden = true;
  lockPinInput.value = "";
  lockError.hidden = true;
  void window.messengerShell.setLocked(false);
  resetIdleLockTimer();
}

function renderGlobalShortcutStatus() {
  const accelerator = currentGlobalShortcut.accelerator || settings.globalShortcut || "Alt+Space";

  if (settings.globalShortcutEnabled === false) {
    globalShortcutStatus.textContent = "Глобальная горячая клавиша выключена";
    return;
  }

  globalShortcutStatus.textContent = currentGlobalShortcut.registered
    ? `Глобальная горячая клавиша активна: ${formatAccelerator(accelerator)}`
    : `${formatAccelerator(accelerator)} не зарегистрировалась. Возможно, сочетание занято.`;
}

function formatAccelerator(accelerator) {
  return String(accelerator).replace("Alt", "Option").replace(/\+/g, "+");
}

function closeSettings() {
  settingsBackdrop.hidden = true;
  syncOverlay();
}

function closeEdit() {
  editBackdrop.hidden = true;
  editingAccountId = undefined;
  editForm.reset();
  syncOverlay();
}

function updatePhoneField() {
  const isWhatsApp = platformInput.value === "whatsapp";
  phoneField.hidden = !isWhatsApp;
  if (!isWhatsApp) {
    phoneInput.value = "";
  }
}

async function removeAccountWithConfirm(account, clearSession) {
  if (!account) return;

  const message = clearSession
    ? `Удалить ${account.label} и очистить его web-сессию?\n\nПосле этого нужно будет входить заново.`
    : `Удалить ${account.label}? Сессия входа сохранится.`;

  if (!window.confirm(message)) {
    return;
  }

  const typedLabel = window.prompt(`Для подтверждения введите название аккаунта:\n${account.label}`);
  if (typedLabel !== account.label) {
    window.alert("Удаление отменено: название введено не полностью.");
    return;
  }

  const state = await window.messengerShell.removeAccount(account.id, {
    clearSession
  });
  accounts = state.accounts;
  activeAccountId = state.activeAccountId;
  unreadCounts = state.unreadCounts || {};
  settings = state.settings || settings;
  renderAccounts();
  if (!settingsBackdrop.hidden) {
    renderSettingsForm();
  }
}

async function toggleAccountNotifications(account) {
  const state = await window.messengerShell.updateAccount(account.id, {
    notificationsEnabled: account.notificationsEnabled === false
  });

  accounts = state.accounts;
  activeAccountId = state.activeAccountId;
  unreadCounts = state.unreadCounts || {};
  settings = state.settings || settings;
  renderAccounts();
  renderSettingsForm();
}

void init();
