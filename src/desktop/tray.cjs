const path = require("node:path");
const { Menu, nativeImage, Tray } = require("electron");

// Значок в строке меню. Без него включённый режим «держать в фоне» прятал окно
// так, что вернуть его можно было только глобальной клавишей — а на Windows
// сочетание Alt+Space занято системой, и окно было нечем достать.

let tray;
let callbacks = {};

function trayImage() {
  if (process.platform === "darwin") {
    // Template-изображение: система сама перекрашивает его под тему меню.
    const image = nativeImage.createFromPath(
      path.join(__dirname, "assets", "trayTemplate.png")
    );
    image.setTemplateImage(true);
    return image;
  }

  return nativeImage.createFromPath(
    path.join(__dirname, "assets", "MessengerHub.iconset", "icon_16x16@2x.png")
  );
}

function createTray(handlers) {
  if (tray) {
    return tray;
  }

  callbacks = handlers;
  tray = new Tray(trayImage());
  tray.setToolTip("Messenger Hub");

  // На macOS левый клик по значку раскрывает меню сам. На Windows и Linux
  // меню висит на правой кнопке, а левая логичнее показывает окно.
  if (process.platform !== "darwin") {
    tray.on("click", () => callbacks.onToggleWindow?.());
  }

  return tray;
}

function updateTray({ items = [], totalUnread = 0, offlineCount = 0 } = {}) {
  if (!tray || tray.isDestroyed()) {
    return;
  }

  const accountItems = items.length
    ? items.map((item) => ({
        label: item.detail ? `${item.title} — ${item.detail}` : item.title,
        type: "checkbox",
        checked: Boolean(item.isActive),
        click: () => callbacks.onSelectAccount?.(item.id)
      }))
    : [{ label: "Аккаунтов пока нет", enabled: false }];

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: trayHeadline(totalUnread, offlineCount), enabled: false },
      { type: "separator" },
      ...accountItems,
      { type: "separator" },
      { label: "Показать окно", click: () => callbacks.onShowWindow?.() },
      { label: "Скрыть окно", click: () => callbacks.onHideWindow?.() },
      { type: "separator" },
      { label: "Выйти", click: () => callbacks.onQuit?.() }
    ])
  );

  tray.setToolTip(`Messenger Hub · ${trayHeadline(totalUnread, offlineCount)}`);
}

function trayHeadline(totalUnread, offlineCount) {
  if (offlineCount > 0) {
    return offlineCount === 1 ? "1 аккаунт без связи" : `${offlineCount} аккаунта(ов) без связи`;
  }

  if (totalUnread > 0) {
    return `Непрочитанных: ${totalUnread}`;
  }

  return "Всё прочитано";
}

function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }

  tray = undefined;
  callbacks = {};
}

module.exports = {
  createTray,
  destroyTray,
  updateTray
};
