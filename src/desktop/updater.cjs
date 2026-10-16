const { app, dialog, net, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { newerRelease, releasesApiUrl } = require("./releaseNotice.cjs");

// Проверка обновлений. Адрес берётся из настроек, а не зашивается в сборку:
// так площадку для файлов обновления можно сменить, ничего не пересобирая.
//
// Два ограничения, о которых лучше знать заранее:
//  * в режиме разработки обновление не проверяется — обновлять нечего;
//  * на macOS механизм обновления требует настоящей подписи приложения.
//    Пока сборка подписана ad-hoc, на Mac приложение только сообщает
//    о новой версии и предлагает скачать установщик (см. releaseNotice.cjs).

let status = { state: "idle", message: "Обновления ещё не проверялись" };
let notifyStatusChange = () => {};
let isWired = false;
// О версии, которую уже показали, фоновая проверка второй раз не напоминает.
let notifiedVersion = "";

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

async function checkMacRelease({
  currentVersion = app.getVersion(),
  silent = true,
  skippedVersion = "",
  onSkipVersion = () => {}
} = {}) {
  setStatus("checking", "Проверяю обновления…");

  try {
    const response = await net.fetch(releasesApiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `Messenger-Hub/${currentVersion}`
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub ответил ${response.status}`);
    }

    const release = newerRelease(await response.json(), currentVersion, process.arch);

    if (!release) {
      setStatus("current", "Установлена последняя версия");
      return status;
    }

    setStatus("available", `Вышла версия ${release.version} — её можно скачать`);

    // Сам человек нажал «Проверить» — показываем всегда. Фоновая проверка
    // молчит о пропущенной версии и не повторяет уже показанное.
    if (silent && (release.version === skippedVersion || release.version === notifiedVersion)) {
      return status;
    }

    notifiedVersion = release.version;
    const { response: choice } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Скачать", "Позже", "Пропустить эту версию"],
      defaultId: 0,
      cancelId: 1,
      title: "Новая версия",
      message: `Вышла версия ${release.version}`,
      detail:
        `Сейчас установлена ${currentVersion}. На Mac приложение не может обновиться само: ` +
        "скачайте установщик, откройте его и перетащите Messenger Hub в «Программы» с заменой. " +
        "Аккаунты и вход сохранятся."
    });

    if (choice === 0) {
      void shell.openExternal(release.downloadUrl);
    } else if (choice === 2) {
      onSkipVersion(release.version);
    }
  } catch (error) {
    console.error("Release check failed:", error?.message || error);
    setStatus("error", `Не удалось проверить обновления: ${error?.message || error}`);

    if (!silent) {
      await dialog.showMessageBox({
        type: "error",
        title: "Обновление не проверено",
        message: "Не удалось узнать, есть ли новая версия.",
        detail: String(error?.message || error)
      });
    }
  }

  return status;
}

async function checkForUpdates({ feedUrl, silent = true, skippedVersion, onSkipVersion } = {}) {
  if (!app.isPackaged) {
    setStatus("disabled", "В режиме разработки обновления не проверяются");
    return status;
  }

  if (process.platform === "darwin") {
    return checkMacRelease({ silent, skippedVersion, onSkipVersion });
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

  // Установщики на Windows не подписаны, и проверить скачанный файл нечем.
  // Остаётся хотя бы не брать его по незащищённому каналу.
  if (!/^https:\/\//i.test(String(feedUrl))) {
    setStatus("error", "Адрес обновлений должен начинаться с https://");
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
  checkMacRelease,
  getUpdateStatus,
  setStatusListener
};
