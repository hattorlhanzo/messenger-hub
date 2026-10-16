// Мессенджеры, которые можно добавить. Раньше название, адрес и префикс
// идентификатора были разбросаны по пяти файлам, и всё, что не WhatsApp и
// не Telegram, молча считалось Instagram.
//
// Страница оболочки работает в песочнице и этот файл подключить не может —
// у неё свой короткий список с названиями и значками в renderer.js.

const platforms = {
  whatsapp: { name: "WhatsApp", url: "https://web.whatsapp.com/", idPrefix: "wa" },
  telegram: { name: "Telegram", url: "https://web.telegram.org/k/", idPrefix: "tg" },
  instagram: {
    name: "Instagram",
    url: "https://www.instagram.com/direct/inbox/",
    idPrefix: "instagram"
  },
  vk: { name: "VK", url: "https://web.vk.me/", idPrefix: "vk" },
  max: { name: "MAX", url: "https://web.max.ru/", idPrefix: "max" }
};

const platformIds = Object.keys(platforms);

function isKnownPlatform(platform) {
  return Object.hasOwn(platforms, platform);
}

// Для аккаунтов, сохранённых до появления списка: всё незнакомое тогда
// и было Instagram.
function platformInfo(platform) {
  return platforms[isKnownPlatform(platform) ? platform : "instagram"];
}

module.exports = {
  isKnownPlatform,
  platformIds,
  platformInfo
};
