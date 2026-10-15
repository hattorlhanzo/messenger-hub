// Проверка шагов масштаба страницы мессенджера.
//
// Запуск: node scripts/check-zoom.cjs

const assert = require("node:assert");
const { nextZoomFactor, normalizeZoomFactor, zoomSteps } = require("../src/desktop/zoom.cjs");

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

check("без сохранённого значения масштаб стопроцентный", () => {
  assert.strictEqual(normalizeZoomFactor(undefined), 1);
  assert.strictEqual(normalizeZoomFactor("мусор"), 1);
  assert.strictEqual(normalizeZoomFactor(0), 1);
  assert.strictEqual(normalizeZoomFactor(-2), 1);
});

check("поправленное руками значение встаёт на ближайший шаг", () => {
  assert.strictEqual(normalizeZoomFactor(1.13), 1.1);
  assert.strictEqual(normalizeZoomFactor(7), 2);
  assert.strictEqual(normalizeZoomFactor(0.1), 0.5);
});

check("увеличение и уменьшение идут по шагам", () => {
  assert.strictEqual(nextZoomFactor(1, "in"), 1.1);
  assert.strictEqual(nextZoomFactor(1.1, "in"), 1.25);
  assert.strictEqual(nextZoomFactor(1, "out"), 0.9);
});

check("на краях шкалы масштаб не выходит за пределы", () => {
  const max = zoomSteps[zoomSteps.length - 1];
  assert.strictEqual(nextZoomFactor(max, "in"), max);
  assert.strictEqual(nextZoomFactor(zoomSteps[0], "out"), zoomSteps[0]);
});

check("сброс возвращает стопроцентный масштаб", () => {
  assert.strictEqual(nextZoomFactor(1.75, "reset"), 1);
});

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены");
