// Проверка счётчика на значке в панели задач Windows и мигания кнопки.
//
// Запуск: node scripts/check-taskbar-badge.cjs

const assert = require("node:assert");
const {
  isBadgeDataUrl,
  shouldFlashTaskbar,
  taskbarBadgeText
} = require("../src/desktop/taskbarBadge.cjs");

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

check("без непрочитанных значок пустой", () => {
  assert.strictEqual(taskbarBadgeText(0), "");
  assert.strictEqual(taskbarBadgeText(-3), "");
  assert.strictEqual(taskbarBadgeText(undefined), "");
});

check("число пишется как есть, больше 99 — «99+»", () => {
  assert.strictEqual(taskbarBadgeText(1), "1");
  assert.strictEqual(taskbarBadgeText(99), "99");
  assert.strictEqual(taskbarBadgeText(100), "99+");
  assert.strictEqual(taskbarBadgeText(2500), "99+");
});

const newMessage = {
  platform: "win32",
  hasBaseline: true,
  previous: 2,
  next: 3,
  isWindowFocused: false,
  notificationsAllowed: true
};

check("новое сообщение при неактивном окне на Windows — кнопка мигает", () => {
  assert.strictEqual(shouldFlashTaskbar(newMessage), true);
});

check("не мигает: окно в фокусе, сообщения прочитали, первая загрузка", () => {
  assert.strictEqual(shouldFlashTaskbar({ ...newMessage, isWindowFocused: true }), false);
  assert.strictEqual(shouldFlashTaskbar({ ...newMessage, next: 1 }), false);
  assert.strictEqual(shouldFlashTaskbar({ ...newMessage, hasBaseline: false }), false);
});

check("не мигает на macOS и при выключенных уведомлениях", () => {
  assert.strictEqual(shouldFlashTaskbar({ ...newMessage, platform: "darwin" }), false);
  assert.strictEqual(shouldFlashTaskbar({ ...newMessage, notificationsAllowed: false }), false);
});

check("принимается только небольшая PNG-картинка", () => {
  assert.strictEqual(isBadgeDataUrl("data:image/png;base64,iVBORw0KGgo="), true);
  assert.strictEqual(isBadgeDataUrl("data:image/svg+xml;base64,PHN2Zz4="), false);
  assert.strictEqual(isBadgeDataUrl("file:///C:/evil.png"), false);
  assert.strictEqual(isBadgeDataUrl(`data:image/png;base64,${"A".repeat(300 * 1024)}`), false);
  assert.strictEqual(isBadgeDataUrl(undefined), false);
});

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены");
