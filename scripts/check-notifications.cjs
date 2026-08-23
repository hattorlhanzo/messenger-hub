// Проверка текстов уведомлений и защиты от повторов.
//
// Источников уведомлений два — счётчик в заголовке вкладки и мост со страницы
// мессенджера, — и они пересекаются. Без защиты об одном сообщении приходило бы
// два уведомления подряд.
//
// Показ уведомления здесь не проверяется: он требует запущенного Electron.
//
// Запуск: node scripts/check-notifications.cjs

const assert = require("node:assert");
const {
  accountNotificationTitle,
  cleanNotificationText,
  forgetAccount,
  hadRecentPreview,
  platformName,
  shouldShowPreview
} = require("../src/desktop/notifications.cjs");

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

check("названия мессенджеров", () => {
  assert.strictEqual(platformName("whatsapp"), "WhatsApp");
  assert.strictEqual(platformName("telegram"), "Telegram");
  assert.strictEqual(platformName("instagram"), "Instagram");
  assert.strictEqual(platformName("что-то ещё"), "Instagram");
});

check("текст из мессенджера приводится в порядок", () => {
  assert.strictEqual(cleanNotificationText("  привет\n\n  мир  "), "привет мир");
  assert.strictEqual(cleanNotificationText(null), "");
  assert.strictEqual(cleanNotificationText(undefined), "");
});

check("слишком длинный текст обрезается", () => {
  assert.strictEqual(cleanNotificationText("я".repeat(500)).length, 220);
});

check("в заголовке виден номер, если он задан", () => {
  assert.strictEqual(
    accountNotificationTitle({ label: "Заур", phone: "+7 960 000-00-00" }),
    "Заур · +7 960 000-00-00"
  );
  assert.strictEqual(accountNotificationTitle({ label: "Заур", phone: "" }), "Заур");
  assert.strictEqual(accountNotificationTitle({ label: "Заур" }), "Заур");
});

check("одно и то же превью подряд показывается один раз", () => {
  assert.strictEqual(shouldShowPreview("wa_1", "Клиент", "Здравствуйте"), true);
  assert.strictEqual(
    shouldShowPreview("wa_1", "Клиент", "Здравствуйте"),
    false,
    "повтор того же сообщения не должен проходить"
  );
});

check("другое сообщение от того же человека проходит", () => {
  assert.strictEqual(shouldShowPreview("wa_1", "Клиент", "Ещё вопрос"), true);
});

check("одинаковый текст от разных аккаунтов не считается повтором", () => {
  assert.strictEqual(shouldShowPreview("wa_2", "Клиент", "Здравствуйте"), true);
  assert.strictEqual(shouldShowPreview("tg_1", "Клиент", "Здравствуйте"), true);
});

check("после удаления аккаунта его превью забываются", () => {
  shouldShowPreview("wa_9", "Кто-то", "Текст");
  forgetAccount("wa_9");
  assert.strictEqual(
    shouldShowPreview("wa_9", "Кто-то", "Текст"),
    true,
    "память о прежнем аккаунте не должна влиять на новый с тем же именем"
  );
});

check("без превью недавним оно не считается", () => {
  assert.strictEqual(hadRecentPreview("никогда_не_было"), false);
});

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены");
