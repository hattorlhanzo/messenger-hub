// Проверка аккаунтов: что принимается со страницы оболочки и как
// выглядят новые VK и MAX.
//
// Запуск: node scripts/check-accounts.cjs

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Аккаунты пишутся в отдельную временную папку, рабочий профиль не трогается.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "messenger-hub-accounts-"));
process.env.MESSENGER_HUB_DATA_DIR = dataDir;

const { addAccount, editableFields, loadAccounts, updateAccount } = require("../src/desktop/accounts.cjs");
const { platformName } = require("../src/desktop/notifications.cjs");

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

check("VK и MAX добавляются со своим адресом и названием", () => {
  const vk = addAccount({ platform: "vk" });
  const max = addAccount({ platform: "max", label: "Работа" });
  assert.strictEqual(vk.url, "https://web.vk.me/");
  assert.strictEqual(vk.label, "VK");
  assert.ok(vk.id.startsWith("vk_"));
  assert.strictEqual(max.url, "https://web.max.ru/");
  assert.strictEqual(max.label, "Работа");
  assert.ok(max.id.startsWith("max_"));
  assert.strictEqual(platformName("max"), "MAX");
});

check("незнакомый мессенджер не добавляется", () => {
  assert.throws(() => addAccount({ platform: "evil" }));
  assert.throws(() => addAccount({}));
});

check("адрес и папку сессии со страницы задать нельзя", () => {
  const first = addAccount({ platform: "whatsapp" });
  const second = addAccount({
    platform: "telegram",
    url: "file:///etc/passwd",
    partition: first.partition
  });
  assert.strictEqual(second.url, "https://web.telegram.org/k/");
  assert.notStrictEqual(second.partition, first.partition, "чужой вход не достаётся");

  const updated = updateAccount(first.id, { url: "https://evil.example/", partition: "persist:x", label: "Новое" });
  assert.strictEqual(updated.url, "https://web.whatsapp.com/");
  assert.strictEqual(updated.partition, first.partition);
  assert.strictEqual(updated.label, "Новое");
});

check("из правки берутся только название, телефон, уведомления и масштаб", () => {
  assert.deepStrictEqual(
    Object.keys(editableFields({ label: " A ", phone: "1", notificationsEnabled: false, id: "x", platform: "vk" })).sort(),
    ["label", "notificationsEnabled", "phone"]
  );
  assert.strictEqual(editableFields({ label: " A " }).label, "A");
  assert.strictEqual(editableFields({ label: 5 }).label, undefined);
});

check("адрес, вписанный в файл аккаунтов вручную, сохраняется", () => {
  const file = path.join(dataDir, "desktop-accounts.json");
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  stored[0].url = "https://web.vk.me/some/page";
  fs.writeFileSync(file, JSON.stringify(stored));
  assert.strictEqual(loadAccounts()[0].url, "https://web.vk.me/some/page");
});

fs.rmSync(dataDir, { recursive: true, force: true });

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены");
