// Проверка сообщения о новой версии на Mac: сравнение версий и выбор ссылки.
//
// Запуск: node scripts/check-release-notice.cjs

const assert = require("node:assert");
const { compareVersions, macDownloadUrl, newerRelease } = require("../src/desktop/releaseNotice.cjs");

const checks = [];

function check(name, run) {
  try {
    run();
    checks.push(`  ok   ${name}`);
  } catch (error) {
    checks.push(`  FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

const release = {
  tag_name: "v1.9.0",
  html_url: "https://github.com/hattorlhanzo/messenger-hub/releases/tag/v1.9.0",
  assets: [
    { name: "Messenger-Hub-Setup-1.9.0.exe", browser_download_url: "https://github.com/x/setup.exe" },
    { name: "Messenger-Hub-1.9.0-arm64.zip", browser_download_url: "https://github.com/x/arm64.zip" },
    { name: "Messenger-Hub-1.9.0-arm64.dmg", browser_download_url: "https://github.com/x/arm64.dmg" }
  ]
};

check("версии сравниваются как числа, а не как строки", () => {
  assert.ok(compareVersions("1.10.0", "1.9.0") > 0);
  assert.ok(compareVersions("v1.8.1", "1.8.0") > 0);
  assert.strictEqual(compareVersions("1.8.0", "1.8.0"), 0);
  assert.ok(compareVersions("1.7.9", "1.8.0") < 0);
});

check("непонятная версия не считается новее", () => {
  assert.strictEqual(compareVersions("мусор", "1.8.0"), 0);
  assert.strictEqual(compareVersions("2.0.0-beta", "1.8.0"), 0);
});

check("предлагается установщик для Mac, а не для Windows", () => {
  assert.strictEqual(macDownloadUrl(release, "arm64"), "https://github.com/x/arm64.dmg");
});

check("без установщика — страница релиза", () => {
  assert.strictEqual(macDownloadUrl({ ...release, assets: [] }), release.html_url);
});

check("ссылки не с github.com не открываются", () => {
  const evil = {
    ...release,
    html_url: "https://evil.example/",
    assets: [{ name: "x-arm64.dmg", browser_download_url: "https://evil.example/x.dmg" }]
  };
  assert.strictEqual(macDownloadUrl(evil), "");
  assert.strictEqual(newerRelease(evil, "1.8.0"), undefined);
});

check("новая версия находится, текущая и старые — нет", () => {
  assert.deepStrictEqual(newerRelease(release, "1.8.0", "arm64"), {
    version: "1.9.0",
    downloadUrl: "https://github.com/x/arm64.dmg"
  });
  assert.strictEqual(newerRelease(release, "1.9.0"), undefined);
  assert.strictEqual(newerRelease(release, "2.0.0"), undefined);
});

check("черновики и предварительные версии не предлагаются", () => {
  assert.strictEqual(newerRelease({ ...release, draft: true }, "1.8.0"), undefined);
  assert.strictEqual(newerRelease({ ...release, prerelease: true }, "1.8.0"), undefined);
  assert.strictEqual(newerRelease(null, "1.8.0"), undefined);
});

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены");
