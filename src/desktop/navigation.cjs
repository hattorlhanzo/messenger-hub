// Правила навигации для вкладок аккаунтов.
//
// Две отдельные задачи:
//  * ссылки из переписки открываются в системном браузере, но только те, схему
//    которых мы понимаем. Раньше shell.openExternal получал вообще любой адрес,
//    включая file: и произвольные схемы, зарегистрированные в системе;
//  * сама вкладка должна оставаться на сайте своего мессенджера. Если страница
//    уводит её на посторонний сайт, оболочка приложения вокруг чужой страницы
//    выглядит как настоящий мессенджер, и это удобная площадка для подделки
//    формы входа.
//
// Список доменов намеренно широкий: вход в Instagram и WhatsApp ходит через
// сайты Meta, и лучше пропустить лишний домен, чем сломать вход в аккаунт.

const externalSchemes = new Set(["http:", "https:", "mailto:", "tel:"]);

const allowedDomains = [
  "whatsapp.com",
  "whatsapp.net",
  "telegram.org",
  "t.me",
  "telegram.me",
  "instagram.com",
  "cdninstagram.com",
  "facebook.com",
  "fbcdn.net",
  "fb.com",
  "messenger.com",
  "meta.com",
  "threads.com",
  "threads.net"
];

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

// Домен считается своим, если совпадает с разрешённым или является его поддоменом.
// Простое вхождение подстроки здесь не годится: "evil-instagram.com" и
// "instagram.com.attacker.net" не должны пройти.
function isAllowedHost(hostname, extraDomains = []) {
  const host = String(hostname || "").toLowerCase();

  return [...allowedDomains, ...extraDomains].some((domain) => {
    const allowed = String(domain || "").toLowerCase();
    return Boolean(allowed) && (host === allowed || host.endsWith(`.${allowed}`));
  });
}

// Адрес аккаунта можно задать вручную. Свой же сайт вкладка покидать не должна,
// поэтому его хост всегда добавляется к разрешённым.
function hostOf(url) {
  return parseUrl(url)?.hostname || "";
}

function canOpenExternally(url) {
  const parsed = parseUrl(url);
  return Boolean(parsed) && externalSchemes.has(parsed.protocol);
}

function isAllowedInsideView(url, accountUrl) {
  const parsed = parseUrl(url);

  if (!parsed) {
    return false;
  }

  // about:blank и подобное мессенджеры используют для служебных кадров.
  if (parsed.protocol === "about:" || parsed.protocol === "blob:") {
    return true;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }

  return isAllowedHost(parsed.hostname, [hostOf(accountUrl)]);
}

module.exports = {
  allowedDomains,
  canOpenExternally,
  hostOf,
  isAllowedHost,
  isAllowedInsideView
};
