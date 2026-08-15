// Проверка счётчика непрочитанных, решения об уведомлении и User-Agent.
//
// Главное здесь — случай «было пусто, пришло первое сообщение». Раньше он молчал:
// уведомление не показывалось, если предыдущее значение счётчика было нулём.
//
// Запуск: node scripts/check-unread.cjs

const assert = require("node:assert");
const { extractUnreadCount, shouldNotifyAboutUnread } = require("../src/desktop/unread.cjs");
const { desktopChromeUserAgent, resolveUserAgent } = require("../src/desktop/accounts.cjs");

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

check("счётчик читается из заголовка вкладки", () => {
  assert.strictEqual(extractUnreadCount("(3) WhatsApp"), 3);
  assert.strictEqual(extractUnreadCount("(12) Telegram"), 12);
  assert.strictEqual(extractUnreadCount("WhatsApp"), 0);
  assert.strictEqual(extractUnreadCount(""), 0);
  assert.strictEqual(extractUnreadCount(undefined), 0);
});

check("число не в начале заголовка счётчиком не считается", () => {
  assert.strictEqual(extractUnreadCount("Чат (5) — Telegram"), 0);
});

check("ПЕРВОЕ сообщение в пустом чате даёт уведомление", () => {
  assert.strictEqual(
    shouldNotifyAboutUnread({ hasBaseline: true, previous: 0, next: 1 }),
    true,
    "переход 0 → 1 обязан уведомлять: раньше он молчал"
  );
});

check("накопленное до запуска не уведомляет", () => {
  assert.strictEqual(
    shouldNotifyAboutUnread({ hasBaseline: false, previous: 0, next: 7 }),
    false,
    "первое замеченное значение — точка отсчёта, а не новые сообщения"
  );
});

check("обычный прирост уведомляет", () => {
  assert.strictEqual(shouldNotifyAboutUnread({ hasBaseline: true, previous: 2, next: 5 }), true);
});

check("прочитанные сообщения не уведомляют", () => {
  assert.strictEqual(shouldNotifyAboutUnread({ hasBaseline: true, previous: 5, next: 2 }), false);
  assert.strictEqual(shouldNotifyAboutUnread({ hasBaseline: true, previous: 3, next: 3 }), false);
});

check("если превью уже показали, второе уведомление не шлём", () => {
  assert.strictEqual(
    shouldNotifyAboutUnread({ hasBaseline: true, previous: 0, next: 1, hadRecentPreview: true }),
    false
  );
});

check("вызов без аргументов не падает", () => {
  assert.strictEqual(shouldNotifyAboutUnread(), false);
});

check("User-Agent соответствует текущей системе", () => {
  const ua = desktopChromeUserAgent();
  const expected = {
    darwin: "Macintosh",
    win32: "Windows NT",
    linux: "X11"
  }[process.platform];

  assert.ok(ua.includes(expected), `в строке нет признака системы: ${ua}`);
  assert.ok(ua.includes("Chrome/"), "строка должна выглядеть как Chrome");
});

check("чужая строка от другой системы заменяется", () => {
  const windowsUa =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
  const macUa =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
  const foreign = process.platform === "win32" ? macUa : windowsUa;

  assert.strictEqual(
    resolveUserAgent(foreign),
    desktopChromeUserAgent(),
    "аккаунт, перенесённый с другой системы, должен получить свою строку"
  );
});

check("своя строка сохраняется как есть", () => {
  const own = desktopChromeUserAgent();
  assert.strictEqual(resolveUserAgent(own), own);
});

check("пустое значение подставляет строку по умолчанию", () => {
  assert.strictEqual(resolveUserAgent(undefined), desktopChromeUserAgent());
  assert.strictEqual(resolveUserAgent(""), desktopChromeUserAgent());
});

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены");
