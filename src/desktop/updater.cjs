const { app, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");

// Проверка обновлений. Адрес берётся из настроек, а не зашивается в сборку:
// так площадку для файлов обновления можно сменить, ничего не пересобирая.
//
// Два ограничения, о которых лучше знать заранее:
//  * в режиме разработки обновление не проверяется — обновлять нечего;
//  * на macOS механизм обновления требует настоящей подписи приложения.
//    Пока сборка подписана ad-hoc, проверка на Mac завершится ошибкой,
//    и это ожидаемо, а не поломка.

let status = { state: "idle", message: "Обновления ещё не проверялись" };
let notifyStatusChange = () => {};
let isWired = false;

function setStatus(state, message) {
  status = { state, message };
  notifyStatusChange(status);
}

function getUpdateStatus() {
  return status;
}

function wireUpdaterEvents() {
  if (isWired) {
    return;
  }

  isWired = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => setStatus("checking", "Проверяю обновления…"));

  autoUpdater.on("update-not-available", () => {
    setStatus("current", "Установлена последняя версия");
  });

  autoUpdater.on("update-available", (info) => {
    setStatus("downloading", `Скачиваю версию ${info.version}…`);
  });

  autoUpdater.on("download-progress", (progress) => {
    setStatus("downloading", `Скачиваю обновление: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    setStatus("ready", `Версия ${info.version} готова к установке`);

    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Перезапустить сейчас", "Позже"],
      defaultId: 0,
      cancelId: 1,
      title: "Обновление готово",
      message: `Скачана версия ${info.version}.`,
      detail: "Обновление установится при перезапуске приложения."
    });

    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", (error) => {
    console.error("Updater error:", error?.message || error);
    setStatus("error", `Не удалось проверить обновления: ${error?.message || error}`);
  });
}

async function checkForUpdates({ feedUrl, silent = true } = {}) {
  if (!app.isPackaged) {
    setStatus("disabled", "В режиме разработки обновления не проверяются");
    return status;
  }

  if (!feedUrl) {
    setStatus("unconfigured", "Адрес для обновлений не задан в настройках");

    if (!silent) {
      await dialog.showMessageBox({
        type: "info",
        title: "Обновления не настроены",
        message: "Не задан адрес, откуда брать обновления.",
        detail:
          'Укажите поле "updateFeedUrl" в файле настроек — это адрес папки, ' +
          "куда выкладываются собранные файлы обновления."
      });
    }

    return status;
  }

  try {
    wireUpdaterEvents();
    autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error("Update check failed:", error?.message || error);
    setStatus("error", `Не удалось проверить обновления: ${error?.message || error}`);

    if (!silent) {
      await dialog.showMessageBox({
        type: "error",
        title: "Обновление не проверено",
        message: "Не удалось связаться с сервером обновлений.",
        detail: String(error?.message || error)
      });
    }
  }

  return status;
}

function setStatusListener(listener) {
  notifyStatusChange = typeof listener === "function" ? listener : () => {};
}

module.exports = {
  checkForUpdates,
  getUpdateStatus,
  setStatusListener
};
