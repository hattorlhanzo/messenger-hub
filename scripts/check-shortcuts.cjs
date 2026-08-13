// Проверка выбора глобального сочетания клавиш.
// На macOS система разрешает занять одно сочетание нескольким программам сразу,
// поэтому отказ в регистрации — случай Windows, и вживую здесь он не воспроизводится.
// Подставляем вместо Electron собственную функцию регистрации.
//
// Запуск: node scripts/check-shortcuts.cjs

const assert = require("node:assert");
const { chooseGlobalShortcut } = require("../src/desktop/shortcuts.cjs");

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

// Регистрация, которая принимает только перечисленные сочетания.
const allowOnly = (...accepted) => {
  const attempts = [];
  const register = (accelerator) => {
    attempts.push(accelerator);
    return accepted.includes(accelerator);
  };
  register.attempts = attempts;
  return register;
};

check("свободное сочетание берётся сразу, запасные не трогаются", () => {
  const register = allowOnly("Alt+Space");
  const result = chooseGlobalShortcut("Alt+Space", register);

  assert.strictEqual(result.accelerator, "Alt+Space");
  assert.strictEqual(result.registered, true);
  assert.deepStrictEqual(register.attempts, ["Alt+Space"], "лишние попытки регистрации");
});

check("занятое сочетание уступает место запасному (случай Windows)", () => {
  const register = allowOnly("Alt+Shift+M");
  const result = chooseGlobalShortcut("Alt+Space", register);

  assert.strictEqual(result.registered, true);
  assert.strictEqual(result.accelerator, "Alt+Shift+M");
  assert.strictEqual(result.requested, "Alt+Space", "нужно помнить, что просили изначально");
});

check("перебор идёт по порядку до первого свободного", () => {
  const register = allowOnly("Control+Alt+M");
  const result = chooseGlobalShortcut("Alt+Space", register);

  assert.strictEqual(result.accelerator, "Control+Alt+M");
  assert.deepStrictEqual(register.attempts, ["Alt+Space", "Alt+Shift+M", "Control+Alt+M"]);
});

check("если занято всё, честно сообщаем о неудаче", () => {
  const register = allowOnly();
  const result = chooseGlobalShortcut("Alt+Space", register);

  assert.strictEqual(result.registered, false);
  assert.strictEqual(result.accelerator, "Alt+Space");
});

check("запрошенное сочетание не проверяется дважды", () => {
  const register = allowOnly("Control+Alt+M");
  chooseGlobalShortcut("Alt+Shift+M", register);

  const duplicates = register.attempts.filter((item) => item === "Alt+Shift+M");
  assert.strictEqual(duplicates.length, 1, "Alt+Shift+M проверено больше одного раза");
});

check("пустая настройка подставляет сочетание по умолчанию", () => {
  const register = allowOnly("Alt+Space", "Alt+Shift+M");
  const result = chooseGlobalShortcut("", register);

  assert.strictEqual(result.registered, true);
  assert.ok(result.accelerator, "сочетание должно быть выбрано");
});

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены");
