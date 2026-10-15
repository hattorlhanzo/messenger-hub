const $ = (id) => document.getElementById(id);

const sidebar = $("sidebar");
const workspaceLine = $("workspaceLine");
const collapseButton = $("collapseButton");
const collapseArrow = $("collapseArrow");
const searchButton = $("searchButton");
const searchKbd = $("searchKbd");
const unreadLine = $("unreadLine");
const accountList = $("accountList");
const addButton = $("addButton");
const lockButton = $("lockButton");
const settingsButton = $("settingsButton");

const emptyScreen = $("emptyScreen");
const emptyAddButton = $("emptyAddButton");
const offlineScreen = $("offlineScreen");
const offlineTitle = $("offlineTitle");
const offlineText = $("offlineText");
const offlineMeta = $("offlineMeta");
const retryButton = $("retryButton");
const offlineLogsButton = $("offlineLogsButton");

const addBackdrop = $("addBackdrop");
const addForm = $("addForm");
const addCancelButton = $("addCancelButton");
const labelInput = $("labelInput");
const phoneField = $("phoneField");
const phoneInput = $("phoneInput");
const addNote = $("addNote");

const editBackdrop = $("editBackdrop");
const editForm = $("editForm");
const editLabelInput = $("editLabelInput");
const editPhoneField = $("editPhoneField");
const editPhoneInput = $("editPhoneInput");
const editCancelButton = $("editCancelButton");

const settingsBackdrop = $("settingsBackdrop");
const settingsCloseButton = $("settingsCloseButton");
const settingsTabs = [...document.querySelectorAll(".settingsTab")];
const settingsPanels = [...document.querySelectorAll(".settingsPanel")];
const settingsAccounts = $("settingsAccounts");
const startAccountInput = $("startAccountInput");
const notificationsInput = $("notificationsInput");
const messagePreviewsInput = $("messagePreviewsInput");
const pinStatusText = $("pinStatusText");
const lockNowButton = $("lockNowButton");
const lockAfterRow = $("lockAfterRow");
const lockAfterInput = $("lockAfterInput");
const pinForm = $("pinForm");
const pinFormTitle = $("pinFormTitle");
const currentPinField = $("currentPinField");
const currentPinInput = $("currentPinInput");
const newPinInput = $("newPinInput");
const savePinButton = $("savePinButton");
const disablePinButton = $("disablePinButton");
const pinMessage = $("pinMessage");
const operatorNameInput = $("operatorNameInput");
const themeInput = $("themeInput");
const compactModeInput = $("compactModeInput");
const launchAtLoginInput = $("launchAtLoginInput");
const backgroundInput = $("backgroundInput");
const globalShortcutLabel = $("globalShortcutLabel");
const globalShortcutStatus = $("globalShortcutStatus");
const globalShortcutInput = $("globalShortcutInput");
const appVersionText = $("appVersionText");
const updateBox = $("updateBox");
const updateStatusText = $("updateStatusText");
const checkUpdatesButton = $("checkUpdatesButton");
const openLogsButton = $("openLogsButton");
const openSettingsFileButton = $("openSettingsFileButton");
const devtoolsButton = $("devtoolsButton");
const settingsPath = $("settingsPath");

const commandBackdrop = $("commandBackdrop");
const commandInput = $("commandInput");
const commandResults = $("commandResults");
const commandShortcutHint = $("commandShortcutHint");

const onboardingBackdrop = $("onboardingBackdrop");
const onboardingForm = $("onboardingForm");
const onboardingNameInput = $("onboardingNameInput");

const lockBackdrop = $("lockBackdrop");
const lockForm = $("lockForm");
const lockPinInput = $("lockPinInput");
const lockError = $("lockError");
const unlockButton = $("unlockButton");
const lockHint = $("lockHint");

const currentPlatform = window.messengerShell.platform || "";
// Сочетания в подсказках: на Mac — значок Command, на Windows — Ctrl.
const modKey = currentPlatform === "darwin" ? "⌘" : "Ctrl+";

let accounts = [];
let activeAccountId;
let unreadCounts = {};
let accountStatuses = {};
let accountRetries = {};
let settings = {};
let currentSettingsPath = "";
let currentGlobalShortcut = {};
let currentUpdateStatus = {};
let appVersion = "";
let isDevToolsEnabled = false;
let editingAccountId;
let draggedAccountId;
let commandMatches = [];
let commandSelectedIndex = 0;
let isLocked = false;
let lockPausedUntil = 0;
let drawnTaskbarBadge = "";
let operatorNameTimer;

document.documentElement.classList.add(`platform-${currentPlatform}`);

// Значки мессенджеров — условные силуэты, не логотипы. Строки постоянные,
// пользовательских данных в них нет, поэтому их можно вставлять разметкой.
const platformIcons = {
  whatsapp:
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 4.5a7.5 7.5 0 0 0-6.5 11.2l-1 3.8 3.9-1A7.5 7.5 0 1 0 12 4.5z"></path></svg>',
  telegram:
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20.5 4.5L3.5 11.2l5.6 2.1 2.1 6.2 3.1-3.9 4.3 3.1z"></path><path d="M9.1 13.3l11.4-8.8"></path></svg>',
  instagram:
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4.5" y="4.5" width="15" height="15" rx="4.5"></rect><circle cx="12" cy="12" r="3.6"></circle><circle cx="16.6" cy="7.4" r="0.7" fill="currentColor"></circle></svg>'
};

const moreIcon =
  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="18" cy="12" r="1.6"></circle></svg>';

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function platformName(platform) {
  if (platform === "whatsapp") return "WhatsApp";
  if (platform === "telegram") return "Telegram";
  return "Instagram";
}

function platformTile(platform, size = "") {
  const tile = el("span", `tile ${platform} ${size}`.trim());
  tile.innerHTML = platformIcons[platform] || platformIcons.instagram;
  return tile;
}

function hasPhone(platform) {
  return platform === "whatsapp" || platform === "telegram";
}

function pluralize(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function badgeText(count) {
  return count > 99 ? "99+" : String(count);
}

// ───────────── Состояние ─────────────

// Главному процессу достаточно знать, открыто ли что-то поверх страницы: он
// прячет вкладку аккаунта целиком, потому что она рисуется поверх оболочки.
function isOverlayOpen() {
  return [commandBackdrop, settingsBackdrop, addBackdrop, editBackdrop, onboardingBackdrop].some(
    (element) => !element.hidden
  );
}

function syncOverlay() {
  void window.messengerShell.setOverlayOpen(isOverlayOpen());
}

function applyState(state) {
  accounts = state.accounts || accounts;
  activeAccountId = state.activeAccountId;
  unreadCounts = state.unreadCounts || {};
  accountStatuses = state.accountStatuses || accountStatuses;
  accountRetries = state.accountRetries || {};
  settings = state.settings || settings;
  currentSettingsPath = state.settingsPath || currentSettingsPath;
  currentGlobalShortcut = state.globalShortcut || currentGlobalShortcut;
  currentUpdateStatus = state.updateStatus || currentUpdateStatus;
  appVersion = state.appVersion || appVersion;
  isDevToolsEnabled = Boolean(state.isDevToolsEnabled);

  applySettingsMode();
  renderSidebar();
  renderContent();
  syncTaskbarBadge(state.taskbarBadge);

  if (!settingsBackdrop.hidden) {
    renderSettingsLive();
  }
}

function applySettingsMode() {
  document.body.classList.toggle("compactMode", Boolean(settings.compactMode));
}

// ───────────── Боковая панель ─────────────

// Что показать под названием аккаунта. Пока страница не поднялась — именно
// это, а не номер: «нет связи» и «выкинуло из аккаунта» со стороны выглядят
// одинаково, и различить их — половина решения проблемы.
function accountState(account) {
  const status = accountStatuses[account.id] || "ready";

  if (status === "offline") {
    const retry = accountRetries[account.id];
    if (retry?.at) {
      const seconds = Math.ceil((retry.at - Date.now()) / 1000);
      return {
        sub: seconds > 0 ? `Нет связи · повтор через ${seconds} с` : "Подключаюсь…",
        tone: "warn",
        dot: "offline"
      };
    }
    return { sub: "Страница не отвечает", tone: "error", dot: "error" };
  }

  if (status === "loading") return { sub: "Загружается…", dot: "busy" };
  if (status === "idle") return { sub: "В очереди на загрузку", queued: true };

  return {
    sub: account.phone && hasPhone(account.platform)
      ? `${platformName(account.platform)} · ${account.phone}`
      : platformName(account.platform)
  };
}

function renderSidebar() {
  const total = Object.values(unreadCounts).reduce((sum, count) => sum + count, 0);
  const countText = `${accounts.length} ${pluralize(accounts.length, "аккаунт", "аккаунта", "аккаунтов")}`;
  workspaceLine.textContent = settings.operatorName
    ? `${settings.operatorName} · ${countText}`
    : countText;
  unreadLine.textContent =
    total > 0 ? `${total} ${pluralize(total, "непрочитанное", "непрочитанных", "непрочитанных")}` : "";

  const compact = Boolean(settings.compactMode);
  collapseButton.setAttribute("aria-label", compact ? "Развернуть панель" : "Свернуть панель");
  collapseButton.title = compact ? "Развернуть панель" : "Свернуть панель";
  collapseArrow.setAttribute("d", compact ? "M13 10l2 2-2 2" : "M15 10l-2 2 2 2");
  searchKbd.textContent = `${modKey}K`;
  searchButton.title = compact ? `Перейти к аккаунту (${modKey}K)` : "";
  addButton.title = compact ? "Добавить аккаунт" : "";
  lockButton.hidden = !settings.pinEnabled;

  if (accounts.length === 0) {
    accountList.replaceChildren(el("p", "emptyAccounts", "Добавьте первый аккаунт кнопкой внизу."));
    return;
  }

  accountList.replaceChildren(...accounts.map(renderAccountItem));
}

function renderAccountItem(account, index) {
  const state = accountState(account);
  const unread = unreadCounts[account.id] || 0;
  const muted = account.notificationsEnabled === false;
  const isActive = account.id === activeAccountId;

  const row = el("button", `account${isActive ? " active" : ""}${state.queued ? " queued" : ""}`);
  row.type = "button";
  row.draggable = true;
  row.dataset.accountId = account.id;
  if (isActive) row.setAttribute("aria-current", "page");
  row.setAttribute(
    "aria-label",
    `${account.label}, ${state.sub}${unread ? `, ${unread} ${pluralize(unread, "непрочитанное", "непрочитанных", "непрочитанных")}` : ""}`
  );
  // Свернутую панель видно только значками: название и состояние — в системной
  // подсказке. Своя подсказка не годится: её закрыла бы страница мессенджера.
  row.title = settings.compactMode
    ? `${account.label} — ${state.sub}${unread ? ` · непрочитанных: ${unread}` : ""}${index < 9 ? ` · ${modKey}${index + 1}` : ""}`
    : "";

  const tile = platformTile(account.platform);
  if (state.dot) tile.append(el("span", `statusDot ${state.dot}`));
  if (unread > 0) tile.append(el("span", `railBadge${muted ? " muted" : ""}`, badgeText(unread)));

  const text = el("span", "accountText");
  text.append(
    el("span", "accountName", account.label),
    el("span", `accountSub${state.tone ? ` ${state.tone}` : ""}`, state.sub)
  );

  row.append(tile, text);
  if (unread > 0) row.append(el("span", `badge${muted ? " muted" : ""}`, badgeText(unread)));

  row.addEventListener("click", () => {
    void window.messengerShell.selectAccount(account.id);
  });
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    void window.messengerShell.openAccountMenu(account.id);
  });
  bindDrag(row, account.id);

  return row;
}

// Отсчёт «повтор через N с» обновляется раз в секунду точечно: пересборка
// списка сбила бы перетаскивание и наведение.
function refreshCountdowns() {
  const offline = accounts.filter((account) => accountRetries[account.id]?.at);

  for (const account of offline) {
    const sub = accountList.querySelector(`[data-account-id="${CSS.escape(account.id)}"] .accountSub`);
    if (sub) sub.textContent = accountState(account).sub;
  }

  if (offline.some((account) => account.id === activeAccountId)) {
    renderContent();
  }
}

// ───────────── Перетаскивание ─────────────

function bindDrag(row, accountId) {
  row.addEventListener("dragstart", (event) => {
    draggedAccountId = accountId;
    row.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", accountId);
  });

  row.addEventListener("dragover", (event) => {
    if (!draggedAccountId || draggedAccountId === accountId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const after = isLowerHalf(event, row);
    row.classList.toggle("dropAfter", after);
    row.classList.toggle("dropBefore", !after);
  });

  row.addEventListener("dragleave", () => {
    row.classList.remove("dropBefore", "dropAfter");
  });

  row.addEventListener("drop", (event) => {
    event.preventDefault();
    const after = isLowerHalf(event, row);
    row.classList.remove("dropBefore", "dropAfter");
    void reorderDraggedAccount(accountId, after);
  });

  row.addEventListener("dragend", clearDragState);
}

function isLowerHalf(event, row) {
  const rect = row.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
}

async function reorderDraggedAccount(targetAccountId, placeAfter) {
  if (!draggedAccountId || draggedAccountId === targetAccountId) {
    clearDragState();
    return;
  }

  const next = accounts.filter((account) => account.id !== draggedAccountId);
  const dragged = accounts.find((account) => account.id === draggedAccountId);
  const targetIndex = next.findIndex((account) => account.id === targetAccountId);

  if (!dragged || targetIndex < 0) {
    clearDragState();
    return;
  }

  next.splice(targetIndex + (placeAfter ? 1 : 0), 0, dragged);
  accounts = next;
  clearDragState();
  renderSidebar();

  const state = await window.messengerShell.reorderAccounts(next.map((account) => account.id));
  accounts = state.accounts;
  renderSidebar();
}

function clearDragState() {
  draggedAccountId = undefined;
  accountList.querySelectorAll(".dragging, .dropBefore, .dropAfter").forEach((row) => {
    row.classList.remove("dragging", "dropBefore", "dropAfter");
  });
}

// ───────────── Область мессенджера ─────────────

// Видна, только когда страница мессенджера спрятана: аккаунтов нет или у
// открытого аккаунта нет связи.
function renderContent() {
  const active = accounts.find((account) => account.id === activeAccountId);
  const isOffline = Boolean(active) && accountStatuses[active.id] === "offline";

  emptyScreen.hidden = accounts.length > 0;
  offlineScreen.hidden = !isOffline;

  if (!isOffline) {
    return;
  }

  const name = platformName(active.platform);
  const retry = accountRetries[active.id] || {};
  const relogin = active.platform === "instagram" ? "входить заново" : "сканировать QR-код заново";

  if (retry.at) {
    const seconds = Math.ceil((retry.at - Date.now()) / 1000);
    offlineTitle.textContent = `Нет связи с ${name}`;
    offlineText.textContent = `${
      seconds > 0
        ? `Аккаунт «${active.label}» переподключится сам через ${seconds} с.`
        : `Аккаунт «${active.label}» переподключается.`
    } Сессия входа сохранена — ${relogin} не придётся.`;
  } else {
    offlineTitle.textContent = "Страница аккаунта не поднимается";
    offlineText.textContent = `Страница «${active.label}» несколько раз подряд закрылась с ошибкой. Нажмите «Повторить сейчас» — вход при этом сохранится.`;
  }

  offlineMeta.textContent = [retry.attempt ? `Попытка ${retry.attempt}` : "", retry.error || ""]
    .filter(Boolean)
    .join(" · ");
}

// ───────────── Быстрый переход ─────────────

function openCommandPalette() {
  if (isLocked) {
    return;
  }

  closeAddModal();
  closeSettings();
  closeEdit();
  commandInput.value = "";
  commandSelectedIndex = Math.max(
    0,
    accounts.findIndex((account) => account.id === activeAccountId)
  );
  commandShortcutHint.replaceChildren(
    el("kbd", "", `${modKey}1`),
    document.createTextNode("–"),
    el("kbd", "", `${modKey}9`),
    document.createTextNode(" сразу к аккаунту")
  );
  commandBackdrop.hidden = false;
  renderCommandResults();
  syncOverlay();
  commandInput.focus();
}

function closeCommandPalette() {
  if (commandBackdrop.hidden) return;
  commandBackdrop.hidden = true;
  commandInput.value = "";
  commandMatches = [];
  syncOverlay();
}

function commandSearchText(account) {
  return [
    account.label,
    account.phone,
    String(account.phone || "").replace(/\D/g, ""),
    platformName(account.platform)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function renderCommandResults() {
  const query = commandInput.value.trim().toLowerCase().replace(/^\+/, "");
  commandMatches = accounts.filter((account) => commandSearchText(account).includes(query));

  if (commandMatches.length === 0) {
    commandSelectedIndex = 0;
    commandResults.replaceChildren(el("p", "commandEmpty", "Ничего не нашлось"));
    return;
  }

  commandSelectedIndex = Math.min(commandSelectedIndex, commandMatches.length - 1);
  commandResults.replaceChildren(
    ...commandMatches.map((account, index) => {
      const state = accountState(account);
      const unread = unreadCounts[account.id] || 0;
      const position = accounts.indexOf(account);
      const selected = index === commandSelectedIndex;

      const row = el("button", `commandResult${selected ? " selected" : ""}`);
      row.type = "button";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(selected));

      const text = el("span", "accountText");
      text.append(
        el("span", "accountName", account.label),
        el("span", `accountSub${state.tone ? ` ${state.tone}` : ""}`, state.sub)
      );

      row.append(platformTile(account.platform, "small"), text);
      if (unread > 0) {
        row.append(el("span", `badge${account.notificationsEnabled === false ? " muted" : ""}`, badgeText(unread)));
      }
      if (position < 9) {
        row.append(el("kbd", "", `${modKey}${position + 1}`));
      }

      row.addEventListener("mouseenter", () => {
        if (commandSelectedIndex !== index) {
          commandSelectedIndex = index;
          renderCommandResults();
        }
      });
      row.addEventListener("click", () => void selectCommandAccount(account.id));
      return row;
    })
  );

  commandResults.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
}

async function selectCommandAccount(accountId = commandMatches[commandSelectedIndex]?.id) {
  if (!accountId) {
    return;
  }

  closeCommandPalette();
  await window.messengerShell.selectAccount(accountId);
}

commandInput.addEventListener("input", () => {
  commandSelectedIndex = 0;
  renderCommandResults();
});

commandInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    commandSelectedIndex = Math.min(commandSelectedIndex + 1, commandMatches.length - 1);
    renderCommandResults();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    commandSelectedIndex = Math.max(commandSelectedIndex - 1, 0);
    renderCommandResults();
  } else if (event.key === "Enter") {
    event.preventDefault();
    void selectCommandAccount();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeCommandPalette();
  }
});

commandBackdrop.addEventListener("click", (event) => {
  if (event.target === commandBackdrop) closeCommandPalette();
});

// ───────────── Новый аккаунт ─────────────

function selectedPlatform() {
  return addForm.elements.platform.value || "whatsapp";
}

function openAddModal() {
  if (isLocked) {
    return;
  }

  closeCommandPalette();
  closeSettings();
  addForm.reset();
  updateAddForm();
  addBackdrop.hidden = false;
  syncOverlay();
  labelInput.focus();
}

function closeAddModal() {
  if (addBackdrop.hidden) return;
  addBackdrop.hidden = true;
  syncOverlay();
}

function updateAddForm() {
  const platform = selectedPlatform();
  const name = platformName(platform);
  phoneField.hidden = !hasPhone(platform);
  labelInput.placeholder = `Например, ${name} — поддержка`;
  addNote.textContent =
    platform === "instagram"
      ? "Дальше откроется страница входа Instagram: введите логин и пароль. Это нужно один раз — потом вход сохраняется."
      : `Дальше откроется страница входа ${name}: отсканируйте QR-код телефоном. Это нужно один раз — потом вход сохраняется.`;
}

addForm.addEventListener("change", (event) => {
  if (event.target.name === "platform") updateAddForm();
});

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const platform = selectedPlatform();
  const state = await window.messengerShell.addAccount({
    platform,
    label: labelInput.value.trim() || platformName(platform),
    phone: hasPhone(platform) ? phoneInput.value.trim() : ""
  });

  closeAddModal();
  applyState(state);
});

addCancelButton.addEventListener("click", closeAddModal);
addBackdrop.addEventListener("click", (event) => {
  if (event.target === addBackdrop) closeAddModal();
});
addButton.addEventListener("click", openAddModal);
emptyAddButton.addEventListener("click", openAddModal);

// ───────────── Редактирование аккаунта ─────────────

function editAccount(account) {
  closeSettings();
  editingAccountId = account.id;
  editLabelInput.value = account.label;
  editPhoneInput.value = account.phone || "";
  editPhoneField.hidden = !hasPhone(account.platform);
  editBackdrop.hidden = false;
  syncOverlay();
  editLabelInput.focus();
  editLabelInput.select();
}

function closeEdit() {
  if (editBackdrop.hidden) return;
  editBackdrop.hidden = true;
  editingAccountId = undefined;
  editForm.reset();
  syncOverlay();
}

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const account = accounts.find((item) => item.id === editingAccountId);
  if (!account) {
    closeEdit();
    return;
  }

  const state = await window.messengerShell.updateAccount(account.id, {
    label: editLabelInput.value.trim() || account.label,
    phone: hasPhone(account.platform) ? editPhoneInput.value.trim() : ""
  });

  closeEdit();
  applyState(state);
});

editCancelButton.addEventListener("click", closeEdit);
editBackdrop.addEventListener("click", (event) => {
  if (event.target === editBackdrop) closeEdit();
});

// ───────────── Настройки ─────────────

function openSettings(tab = "accounts") {
  if (isLocked) {
    return;
  }

  closeCommandPalette();
  closeAddModal();
  renderSettingsForm();
  setSettingsTab(tab);
  settingsBackdrop.hidden = false;
  syncOverlay();
}

function closeSettings() {
  if (settingsBackdrop.hidden) return;
  settingsBackdrop.hidden = true;
  syncOverlay();
}

function setSettingsTab(tab) {
  settingsTabs.forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  settingsPanels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });
  pinMessage.hidden = true;
}

// Значения полей — только при открытии: иначе каждая рассылка состояния
// (а она приходит при любом новом сообщении) затирала бы то, что сейчас печатают.
function renderSettingsForm() {
  notificationsInput.checked = settings.notificationsEnabled !== false;
  messagePreviewsInput.checked = settings.messagePreviewsEnabled !== false;
  lockAfterInput.value = String(lockAfterMinutesValue(settings.lockAfterMinutes));
  operatorNameInput.value = settings.operatorName || "";
  themeInput.value = ["light", "dark"].includes(settings.theme) ? settings.theme : "system";
  compactModeInput.checked = Boolean(settings.compactMode);
  launchAtLoginInput.checked = Boolean(settings.launchAtLogin);
  backgroundInput.checked = settings.keepInBackground !== false;
  globalShortcutInput.checked = settings.globalShortcutEnabled !== false;
  currentPinInput.value = "";
  newPinInput.value = "";
  renderSettingsLive();
}

function renderSettingsLive() {
  renderSettingsAccounts();
  renderStartAccountOptions();
  renderPinSection();
  renderGlobalShortcut();
  renderAbout();
  compactModeInput.checked = Boolean(settings.compactMode);
}

function renderSettingsAccounts() {
  if (accounts.length === 0) {
    settingsAccounts.replaceChildren(el("p", "settingDesc", "Аккаунтов пока нет."));
    return;
  }

  settingsAccounts.replaceChildren(
    ...accounts.map((account) => {
      const row = el("div", "settingsAccount");
      const muted = account.notificationsEnabled === false;

      const text = el("span", "accountText");
      text.append(
        el("span", "accountName", account.label),
        el(
          "span",
          "accountSub",
          account.phone && hasPhone(account.platform)
            ? `${platformName(account.platform)} · ${account.phone}`
            : platformName(account.platform)
        )
      );

      const switchLabel = el("label", "switchLabel", "Уведомления");
      const toggle = el("input", "switch");
      toggle.type = "checkbox";
      toggle.checked = !muted;
      toggle.setAttribute("aria-label", `Уведомления «${account.label}»`);
      toggle.addEventListener("change", async () => {
        applyState(
          await window.messengerShell.updateAccount(account.id, {
            notificationsEnabled: toggle.checked
          })
        );
      });
      switchLabel.append(toggle);

      const more = el("button", "iconButton");
      more.type = "button";
      more.innerHTML = moreIcon;
      more.setAttribute("aria-label", `Действия с «${account.label}»`);
      more.title = "Переименовать, удалить, очистить вход";
      more.addEventListener("click", () => void window.messengerShell.openAccountMenu(account.id));

      row.append(platformTile(account.platform, "small"), text, switchLabel, more);
      return row;
    })
  );
}

function renderStartAccountOptions() {
  if (document.activeElement === startAccountInput) {
    return;
  }

  const options = [["", "Последний открытый"], ...accounts.map((account) => [account.id, account.label])];
  startAccountInput.replaceChildren(
    ...options.map(([value, label]) => {
      const option = el("option", "", label);
      option.value = value;
      return option;
    })
  );
  startAccountInput.value = accounts.some((account) => account.id === settings.startAccountId)
    ? settings.startAccountId
    : "";
}

function renderPinSection() {
  const enabled = Boolean(settings.pinEnabled);
  const minutes = lockAfterMinutesValue(settings.lockAfterMinutes);

  pinStatusText.textContent = enabled
    ? `Включена: при запуске, скрытии окна, блокировке экрана${minutes > 0 ? ` и после ${minutes} мин. бездействия` : ""}`
    : "Выключена — задайте PIN ниже, чтобы включить";
  lockNowButton.hidden = !enabled;
  lockAfterRow.hidden = !enabled;
  currentPinField.hidden = !enabled;
  disablePinButton.hidden = !enabled;
  pinFormTitle.textContent = enabled ? "Сменить PIN" : "Включить PIN";
  savePinButton.textContent = enabled ? "Сменить PIN" : "Включить";
}

function showPinMessage(text, ok) {
  pinMessage.textContent = text;
  pinMessage.className = `formMessage ${ok ? "ok" : "error"}`;
  pinMessage.hidden = false;
}

function renderGlobalShortcut() {
  const accelerator = currentGlobalShortcut.accelerator || settings.globalShortcut || "Alt+Space";
  const requested = currentGlobalShortcut.requested || accelerator;
  globalShortcutLabel.textContent = `Показывать и скрывать по ${formatAccelerator(requested)}`;

  let text;
  let tone = "";
  if (settings.globalShortcutEnabled === false) {
    text = "Выключено";
  } else if (!currentGlobalShortcut.registered) {
    text = `Не удалось занять ни одно сочетание, включая ${formatAccelerator(requested)}: похоже, все они заняты другими программами`;
    tone = "warn";
  } else if (accelerator !== requested) {
    // Запрошенное сочетание оказалось занятым — сработало запасное, и об этом
    // нужно сказать прямо, иначе клавиша «не работает» без объяснений.
    text = `${formatAccelerator(requested)} занято другой программой — работает ${formatAccelerator(accelerator)}`;
    tone = "warn";
  } else {
    text = "Сочетание свободно и работает";
    tone = "ok";
  }

  globalShortcutStatus.textContent = text;
  globalShortcutStatus.className = `settingDesc ${tone}`.trim();
}

function formatAccelerator(accelerator) {
  // Option — название клавиши только на Mac; на Windows она называется Alt.
  return currentPlatform === "darwin"
    ? String(accelerator).replace("Alt", "Option")
    : String(accelerator);
}

function renderAbout() {
  appVersionText.textContent = appVersion ? `Версия ${appVersion}` : "";
  updateStatusText.textContent = currentUpdateStatus.message || "Обновления ещё не проверялись";
  updateBox.classList.toggle("ok", currentUpdateStatus.state === "current");
  checkUpdatesButton.disabled = ["checking", "downloading"].includes(currentUpdateStatus.state);
  devtoolsButton.hidden = !isDevToolsEnabled;
  settingsPath.textContent = currentSettingsPath ? `Файл настроек: ${currentSettingsPath}` : "";
}

// Настройки применяются сразу, без кнопки «Сохранить».
async function saveSettings(patch) {
  const state = await window.messengerShell.updateSettings(patch);
  settings = state.settings || settings;
  currentSettingsPath = state.settingsPath || currentSettingsPath;
  currentGlobalShortcut = state.globalShortcut || currentGlobalShortcut;
  applySettingsMode();
  renderSidebar();
  if (!settingsBackdrop.hidden) {
    renderSettingsLive();
  }
}

function bindSwitch(input, key) {
  input.addEventListener("change", () => void saveSettings({ [key]: input.checked }));
}

bindSwitch(notificationsInput, "notificationsEnabled");
bindSwitch(messagePreviewsInput, "messagePreviewsEnabled");
bindSwitch(compactModeInput, "compactMode");
bindSwitch(launchAtLoginInput, "launchAtLogin");
bindSwitch(backgroundInput, "keepInBackground");
bindSwitch(globalShortcutInput, "globalShortcutEnabled");

themeInput.addEventListener("change", () => void saveSettings({ theme: themeInput.value }));
startAccountInput.addEventListener("change", () => {
  void saveSettings({ startAccountId: startAccountInput.value });
});
lockAfterInput.addEventListener("change", () => {
  void saveSettings({ lockAfterMinutes: Number(lockAfterInput.value) });
});
operatorNameInput.addEventListener("input", () => {
  clearTimeout(operatorNameTimer);
  operatorNameTimer = setTimeout(() => {
    void saveSettings({ operatorName: operatorNameInput.value.trim() });
  }, 400);
});

settingsTabs.forEach((button) => {
  button.addEventListener("click", () => setSettingsTab(button.dataset.tab));
});

pinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const currentPin = currentPinInput.value.trim();
  const newPin = newPinInput.value.trim();

  if (settings.pinEnabled && !currentPin) {
    showPinMessage("Введите текущий PIN", false);
    currentPinInput.focus();
    return;
  }

  if (!/^\d{4,12}$/.test(newPin)) {
    showPinMessage("Новый PIN — от 4 до 12 цифр", false);
    newPinInput.focus();
    return;
  }

  const wasEnabled = Boolean(settings.pinEnabled);
  const result = await window.messengerShell.setPin(newPin, currentPin);
  settings = result.settings || settings;

  if (!result.ok) {
    showPinMessage(pinErrorText(result), false);
    currentPinInput.value = "";
    (settings.pinEnabled ? currentPinInput : newPinInput).focus();
    return;
  }

  currentPinInput.value = "";
  newPinInput.value = "";
  renderSidebar();
  renderPinSection();
  showPinMessage(wasEnabled ? "PIN изменён" : "PIN-блокировка включена", true);
});

disablePinButton.addEventListener("click", async () => {
  const currentPin = currentPinInput.value.trim();
  if (!currentPin) {
    showPinMessage("Чтобы выключить PIN, введите текущий", false);
    currentPinInput.focus();
    return;
  }

  const result = await window.messengerShell.disablePin(currentPin);
  settings = result.settings || settings;

  if (!result.ok) {
    showPinMessage(pinErrorText(result), false);
    currentPinInput.value = "";
    currentPinInput.focus();
    return;
  }

  currentPinInput.value = "";
  newPinInput.value = "";
  renderSidebar();
  renderPinSection();
  showPinMessage("PIN-блокировка выключена", true);
});

lockNowButton.addEventListener("click", () => {
  closeSettings();
  showLock();
});

checkUpdatesButton.addEventListener("click", async () => {
  checkUpdatesButton.disabled = true;
  updateStatusText.textContent = "Проверяю обновления…";
  const result = await window.messengerShell.checkForUpdates();
  currentUpdateStatus = result?.updateStatus || currentUpdateStatus;
  renderAbout();
});

settingsCloseButton.addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", (event) => {
  if (event.target === settingsBackdrop) closeSettings();
});
settingsButton.addEventListener("click", () => openSettings());
openLogsButton.addEventListener("click", () => void window.messengerShell.showLogs());
openSettingsFileButton.addEventListener("click", () => void window.messengerShell.showSettingsFile());
devtoolsButton.addEventListener("click", () => void window.messengerShell.openDevTools());

// ───────────── Блокировка ─────────────

// Отсчёт бездействия ведёт главный процесс по времени бездействия системы,
// а сюда приходит только команда заблокироваться.
function lockAfterMinutesValue(value) {
  const minutes = Number(value);
  return value !== undefined && value !== null && [0, 1, 5, 15, 30].includes(minutes)
    ? minutes
    : 5;
}

function pinErrorText(result = {}) {
  if (result.reason === "invalid") {
    return "PIN должен состоять из 4–12 цифр";
  }

  if (result.retryAfterMs > 0) {
    return pauseText(Math.ceil(result.retryAfterMs / 1000));
  }

  return "Неверный PIN";
}

function pauseText(seconds) {
  const wait = seconds < 120 ? `${seconds} сек.` : `${Math.ceil(seconds / 60)} мин.`;
  return `Слишком много неверных попыток. Попробуйте снова через ${wait}`;
}

function showLock() {
  if (!settings.pinEnabled) {
    return;
  }

  isLocked = true;
  closeCommandPalette();
  closeAddModal();
  closeSettings();
  closeEdit();
  onboardingBackdrop.hidden = true;
  lockError.hidden = true;
  lockPinInput.value = "";

  const minutes = lockAfterMinutesValue(settings.lockAfterMinutes);
  lockHint.textContent = `Приложение блокируется при скрытии окна, при блокировке экрана${
    minutes > 0 ? ` и после ${minutes} мин. бездействия` : ""
  }`;

  lockBackdrop.hidden = false;
  void window.messengerShell.setLocked(true);
  requestAnimationFrame(() => lockPinInput.focus());
}

function hideLock() {
  isLocked = false;
  lockPausedUntil = 0;
  lockBackdrop.hidden = true;
  lockPinInput.value = "";
  lockError.hidden = true;
  void window.messengerShell.setLocked(false);
}

function refreshLockPause() {
  if (!lockPausedUntil) {
    return;
  }

  const seconds = Math.ceil((lockPausedUntil - Date.now()) / 1000);
  if (seconds > 0) {
    lockError.textContent = pauseText(seconds);
    return;
  }

  lockPausedUntil = 0;
  lockError.hidden = true;
  lockPinInput.disabled = false;
  unlockButton.disabled = false;
  lockPinInput.focus();
}

lockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (lockPausedUntil) {
    return;
  }

  const result = await window.messengerShell.verifyPin(lockPinInput.value);

  if (result.ok) {
    settings = result.settings || settings;
    hideLock();
    return;
  }

  lockPinInput.value = "";
  lockError.hidden = false;

  if (result.retryAfterMs > 0) {
    lockPausedUntil = Date.now() + result.retryAfterMs;
    lockError.className = "lockError paused";
    lockError.textContent = pauseText(Math.ceil(result.retryAfterMs / 1000));
    lockPinInput.disabled = true;
    unlockButton.disabled = true;
    return;
  }

  lockError.className = "lockError";
  lockError.textContent = pinErrorText(result);
  lockPinInput.focus();
});

lockButton.addEventListener("click", showLock);

// ───────────── Первый запуск ─────────────

function maybeOpenOnboarding() {
  if (settings.onboardingComplete) {
    return;
  }

  if (accounts.length > 0) {
    settings = { ...settings, onboardingComplete: true };
    void window.messengerShell.updateSettings({ onboardingComplete: true });
    return;
  }

  onboardingNameInput.value = settings.operatorName || "";
  onboardingBackdrop.hidden = false;
  syncOverlay();
  onboardingNameInput.focus();
}

onboardingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const state = await window.messengerShell.updateSettings({
    operatorName: onboardingNameInput.value.trim(),
    onboardingComplete: true
  });
  settings = state.settings;
  onboardingBackdrop.hidden = true;
  syncOverlay();
  renderSidebar();
  openAddModal();
});

// ───────────── Значок в панели задач Windows ─────────────

// Что писать, решает главный процесс; здесь только рисунок — в главном
// процессе нет canvas.
function syncTaskbarBadge(text = "") {
  if (currentPlatform !== "win32" || text === drawnTaskbarBadge) {
    return;
  }

  drawnTaskbarBadge = text;
  window.messengerShell.setTaskbarBadge(text ? drawTaskbarBadge(text) : "", text);
}

// Значок поверх иконки в панели задач — 16×16 точек. Рисуем вдвое крупнее,
// чтобы на экранах с масштабом 150–200% цифры не расплывались.
function drawTaskbarBadge(text) {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  context.fillStyle = "#cd2b31";
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  context.fill();

  const fontSize = text.length >= 3 ? 13 : text.length === 2 ? 18 : 22;
  context.fillStyle = "#ffffff";
  context.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, size / 2, size / 2 + 1);

  return canvas.toDataURL("image/png");
}

// ───────────── Общие события ─────────────

collapseButton.addEventListener("click", () => {
  void saveSettings({ compactMode: !settings.compactMode });
});
searchButton.addEventListener("click", openCommandPalette);
retryButton.addEventListener("click", () => void window.messengerShell.reload());
offlineLogsButton.addEventListener("click", () => void window.messengerShell.showLogs());

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandPalette();
    return;
  }

  if (event.key !== "Escape") {
    return;
  }

  closeCommandPalette();
  closeAddModal();
  closeEdit();
  closeSettings();
});

window.messengerShell.onAccountChanged((state) => {
  activeAccountId = state.activeAccountId;
  renderSidebar();
  renderContent();
});

window.messengerShell.onAccountListChanged(applyState);
window.messengerShell.onCommandOpen(openCommandPalette);
window.messengerShell.onSecurityLock(showLock);

window.messengerShell.onAccountEditRequested(({ accountId }) => {
  const account = accounts.find((item) => item.id === accountId);
  if (account) {
    editAccount(account);
  }
});

// Ошибки страницы оболочки живут в отдельном процессе и в файл сами не попадут.
// Без этого падение интерфейса выглядело бы как «просто перестало работать».
window.addEventListener("error", (event) => {
  window.messengerShell.reportError("ERROR", `${event.message} (${event.filename}:${event.lineno})`);
});

window.addEventListener("unhandledrejection", (event) => {
  window.messengerShell.reportError("ERROR", `необработанный отказ: ${event.reason}`);
});

setInterval(() => {
  refreshCountdowns();
  refreshLockPause();
}, 1000);

async function init() {
  document.querySelectorAll("[data-platform-icon]").forEach((tile) => {
    tile.innerHTML = platformIcons[tile.dataset.platformIcon];
  });

  applyState(await window.messengerShell.getAccounts());
  maybeOpenOnboarding();

  if (settings.pinEnabled) {
    showLock();
  }
}

void init();
