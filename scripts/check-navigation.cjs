// Проверка правил навигации.
// Главное здесь — не перепутать «поддомен разрешённого домена» с «строка содержит
// разрешённый домен»: instagram.com.attacker.net не должен считаться своим.
//
// Запуск: node scripts/check-navigation.cjs

const assert = require("node:assert");
const {
  canOpenExternally,
  isAllowedInsideView
} = require("../src/desktop/navigation.cjs");

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

const whatsapp = "https://web.whatsapp.com/";

check("сайты мессенджеров открываются во вкладке", () => {
  for (const url of [
    "https://web.whatsapp.com/",
    "https://web.telegram.org/k/",
    "https://www.instagram.com/direct/inbox/",
    "https://faq.whatsapp.com/help",
    "https://www.facebook.com/login"
  ]) {
    assert.ok(isAllowedInsideView(url, whatsapp), `должен быть разрешён: ${url}`);
  }
});

check("посторонний сайт во вкладку не пускается", () => {
  for (const url of ["https://example.com/", "http://phishing.test/login"]) {
    assert.ok(!isAllowedInsideView(url, whatsapp), `не должен быть разрешён: ${url}`);
  }
});

check("похожие домены не проходят за свои", () => {
  for (const url of [
    "https://instagram.com.attacker.net/login",
    "https://evil-instagram.com/",
    "https://notwhatsapp.com/",
    "https://whatsapp.com.evil.io/"
  ]) {
    assert.ok(!isAllowedInsideView(url, whatsapp), `подделка прошла: ${url}`);
  }
});

check("собственный адрес аккаунта всегда разрешён", () => {
  const custom = "https://messenger.example.org/inbox";
  assert.ok(!isAllowedInsideView(custom, whatsapp), "чужой адрес не должен проходить");
  assert.ok(
    isAllowedInsideView(custom, custom),
    "свой же адрес аккаунта обязан открываться"
  );
});

check("file: и произвольные схемы во вкладку не пускаются", () => {
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "chrome://settings"]) {
    assert.ok(!isAllowedInsideView(url, whatsapp), `схема прошла: ${url}`);
  }
});

check("наружу отдаются только понятные схемы", () => {
  for (const url of ["https://example.com/", "http://example.com/", "mailto:a@b.c", "tel:+70000000000"]) {
    assert.ok(canOpenExternally(url), `должно открываться снаружи: ${url}`);
  }

  for (const url of ["file:///etc/passwd", "smb://server/share", "javascript:alert(1)", "не ссылка"]) {
    assert.ok(!canOpenExternally(url), `не должно уходить в систему: ${url}`);
  }
});

check("мусор вместо адреса не ломает проверку", () => {
  for (const value of ["", null, undefined, "://", "http://"]) {
    assert.strictEqual(typeof isAllowedInsideView(value, whatsapp), "boolean");
    assert.strictEqual(typeof canOpenExternally(value), "boolean");
  }
});

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены");
