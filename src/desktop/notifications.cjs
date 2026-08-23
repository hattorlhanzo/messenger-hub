const { Notification } = require("electron");

// Системные уведомления о новых сообщениях.
//
// Источников два, и они пересекаются: счётчик в заголовке вкладки и мост,
// который перехватывает Notification самой страницы мессенджера. Поэтому здесь
// же живёт защита от повторов — иначе об одном сообщении приходило бы два
// уведомления подряд.

// Насколько недавним считается превью, чтобы не дублировать его уведомлением
// по счётчику.
const recentPreviewWindowMs = 4000;
// Одинаковое превью, пришедшее повторно за это время, считается дублем.
const duplicatePreviewMs = 3000;
// Дольше этого помнить показанные превью незачем.
const previewMemoryMs = 15000;

const recentPreviewKeys = new Map();
const recentPreviewAt = new Map();

let openAccount = () => {};

function initNotifications({ onOpenAccount } = {}) {
  if (typeof onOpenAccount === "function") {
    openAccount = onOpenAccount;
  }
}

function platformName(platform) {
  if (platform === "whatsapp") return "WhatsApp";
  if (platform === "telegram") return "Telegram";
  return "Instagram";
}

// Текст из мессенджера приходит с переносами и может быть сколь угодно длинным.
function cleanNotificationText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 220);
}

function accountNotificationTitle(account) {
  const phone = cleanNotificationText(account.phone);
  return phone ? `${account.label} · ${phone}` : account.label;
}

function hadRecentPreview(accountId) {
  return Date.now() - (recentPreviewAt.get(accountId) || 0) < recentPreviewWindowMs;
}

function canNotify(account, settings) {
  return Boolean(
    settings.notificationsEnabled &&
      account.notificationsEnabled !== false &&
      Notification.isSupported()
  );
}

function show({ title, subtitle, body, accountId }) {
  const notification = new Notification({ title, subtitle, body });
  notification.on("click", () => openAccount(accountId));
  notification.show();
}

// Уведомление по счётчику непрочитанных: сколько сообщений прибавилось.
function showAccountNotification(account, delta, settings = {}) {
  if (!canNotify(account, settings)) {
    return;
  }

  show({
    title: accountNotificationTitle(account),
    subtitle: platformName(account.platform),
    body: delta === 1 ? "Новое сообщение" : `Новых сообщений: ${delta}`,
    accountId: account.id
  });
}

// Уведомление с текстом сообщения, пришедшее от самой страницы мессенджера.
function showMessagePreviewNotification(account, preview, settings = {}) {
  if (!canNotify(account, settings) || !settings.messagePreviewsEnabled) {
    return;
  }

  const title = cleanNotificationText(preview.title) || platformName(account.platform);
  const body = cleanNotificationText(preview.body) || "Новое сообщение";

  if (!shouldShowPreview(account.id, title, body)) {
    return;
  }

  recentPreviewAt.set(account.id, Date.now());

  show({
    title: accountNotificationTitle(account),
    subtitle: title,
    body,
    accountId: account.id
  });
}

// Мессенджеры повторяют одно и то же уведомление при переподключении,
// поэтому одинаковый текст в пределах пары секунд показывается один раз.
function shouldShowPreview(accountId, title, body) {
  const now = Date.now();
  const key = `${accountId}:${title}:${body}`;
  const previous = recentPreviewKeys.get(key) || 0;

  for (const [storedKey, timestamp] of recentPreviewKeys) {
    if (now - timestamp > previewMemoryMs) {
      recentPreviewKeys.delete(storedKey);
    }
  }

  if (now - previous < duplicatePreviewMs) {
    return false;
  }

  recentPreviewKeys.set(key, now);
  return true;
}

function forgetAccount(accountId) {
  recentPreviewAt.delete(accountId);
  for (const key of recentPreviewKeys.keys()) {
    if (key.startsWith(`${accountId}:`)) {
      recentPreviewKeys.delete(key);
    }
  }
}

module.exports = {
  accountNotificationTitle,
  cleanNotificationText,
  forgetAccount,
  hadRecentPreview,
  initNotifications,
  platformName,
  showAccountNotification,
  showMessagePreviewNotification,
  shouldShowPreview
};
