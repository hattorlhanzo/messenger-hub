// Сообщение «вышла новая версия» для Mac.
//
// Обновиться само приложение на Mac не может: механизм обновления macOS
// принимает только сборки с подписью Apple Developer, а наша подписана ad-hoc.
// Поэтому на Mac приложение только спрашивает у GitHub, какой релиз последний,
// и предлагает скачать установщик.

const releasesApiUrl = "https://api.github.com/repos/hattorlhanzo/messenger-hub/releases/latest";

function versionParts(value) {
  const match = String(value || "").trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : undefined;
}

// Больше нуля — если a новее b. Предварительные версии (1.9.0-beta) не
// сравниваются вовсе: в «последний релиз» GitHub их и так не ставит.
function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);

  if (!left || !right) {
    return 0;
  }

  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return 0;
}

// Ссылки берутся только с github.com: ответ приходит из сети, и открыть
// в браузере что попало было бы неосторожно.
function isGithubUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com";
  } catch {
    return false;
  }
}

// Что предложить скачать: установщик под этот Mac, иначе страницу релиза.
function macDownloadUrl(release, arch = "arm64") {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const dmg =
    assets.find((asset) => String(asset?.name).endsWith(`-${arch}.dmg`)) ||
    assets.find((asset) => String(asset?.name).endsWith(".dmg"));

  if (dmg && isGithubUrl(dmg.browser_download_url)) {
    return dmg.browser_download_url;
  }

  return isGithubUrl(release?.html_url) ? release.html_url : "";
}

// Есть ли что предложить. Черновики и предварительные версии не считаются.
function newerRelease(release, currentVersion, arch) {
  if (!release || release.draft || release.prerelease) {
    return undefined;
  }

  const version = String(release.tag_name || "").replace(/^v/i, "");
  const downloadUrl = macDownloadUrl(release, arch);

  if (!versionParts(version) || compareVersions(version, currentVersion) <= 0 || !downloadUrl) {
    return undefined;
  }

  return { version, downloadUrl };
}

module.exports = {
  compareVersions,
  macDownloadUrl,
  newerRelease,
  releasesApiUrl
};
