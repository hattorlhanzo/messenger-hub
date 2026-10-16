// Проверка ограничения на подъём упавших страниц.
//
// Запуск: node scripts/check-crashes.cjs

const assert = require("node:assert");
const { crashWindowMs, maxCrashesInWindow, recordCrash } = require("../src/desktop/crashes.cjs");

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

function crashTimes(times) {
  let history = [];
  let giveUp = false;
  for (const time of times) {
    ({ history, giveUp } = recordCrash(history, time));
  }
  return { history, giveUp };
}

check("первые падения поднимаются", () => {
  const times = Array.from({ length: maxCrashesInWindow }, (_, i) => i * 5000);
  assert.strictEqual(crashTimes(times).giveUp, false);
});

check("страница, падающая раз за разом, больше не поднимается", () => {
  const times = Array.from({ length: maxCrashesInWindow + 1 }, (_, i) => i * 5000);
  assert.strictEqual(crashTimes(times).giveUp, true);
});

check("редкие падения не копятся", () => {
  const times = Array.from({ length: 10 }, (_, i) => i * crashWindowMs);
  const result = crashTimes(times);
  assert.strictEqual(result.giveUp, false);
  assert.strictEqual(result.history.length, 1, "старые падения забываются");
});

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены");
