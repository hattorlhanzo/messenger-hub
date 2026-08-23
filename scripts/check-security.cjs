// Проверка PIN-блокировки и восстановления положения окна.
// Оба модуля вынесены из main.cjs и потому проверяемы напрямую.
//
// Запуск: node scripts/check-security.cjs

const assert = require("node:assert");
const { createPinSalt, hashPin, normalizePin, verifyPin } = require("../src/desktop/security.cjs");
const { normalizeWindowBounds } = require("../src/desktop/windowBounds.cjs");

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

const salt = createPinSalt();
const settings = { pinEnabled: true, pinSalt: salt, pinHash: hashPin("4321", salt) };

check("верный PIN принимается", () => {
  assert.strictEqual(verifyPin("4321", settings), true);
});

check("неверный PIN отклоняется", () => {
  assert.strictEqual(verifyPin("1234", settings), false);
  assert.strictEqual(verifyPin("", settings), false);
  assert.strictEqual(verifyPin(undefined, settings), false);
  assert.strictEqual(verifyPin("43210", settings), false);
});

check("мусор вместо PIN не роняет проверку", () => {
  for (const value of ["абв", "43 21", null, {}, []]) {
    assert.strictEqual(verifyPin(value, settings), false);
  }
});

check("при выключенной блокировке проход свободный", () => {
  assert.strictEqual(verifyPin("что угодно", { pinEnabled: false }), true);
  assert.strictEqual(verifyPin("что угодно", {}), true);
});

check("испорченный хэш в настройках не даёт войти", () => {
  assert.strictEqual(
    verifyPin("4321", { pinEnabled: true, pinSalt: salt, pinHash: "мусор" }),
    false
  );
});

check("соль каждый раз новая", () => {
  assert.notStrictEqual(createPinSalt(), createPinSalt());
});

check("одинаковый PIN с разной солью даёт разный хэш", () => {
  assert.notStrictEqual(hashPin("4321", createPinSalt()), hashPin("4321", createPinSalt()));
});

check("PIN короче четырёх цифр не принимается", () => {
  assert.throws(() => normalizePin("123"));
  assert.throws(() => normalizePin("1234567890123"));
  assert.strictEqual(normalizePin(" 1234 "), "1234");
});

// Экран 1920x1080 с полосой меню сверху.
const display = { workArea: { x: 0, y: 25, width: 1920, height: 1055 } };
const findDisplay = () => display;

check("сохранённые размеры применяются как есть", () => {
  const b = normalizeWindowBounds({ x: 100, y: 100, width: 1200, height: 800 }, findDisplay);
  assert.deepStrictEqual(b, { x: 100, y: 100, width: 1200, height: 800 });
});

check("окно за краем экрана возвращается в видимую область", () => {
  const b = normalizeWindowBounds({ x: 5000, y: 4000, width: 1200, height: 800 }, findDisplay);
  assert.ok(b.x < 1920, `окно осталось за правым краем: x=${b.x}`);
  assert.ok(b.y < 1080, `окно осталось за нижним краем: y=${b.y}`);
});

check("окно с отрицательными координатами подтягивается на экран", () => {
  const b = normalizeWindowBounds({ x: -900, y: -500, width: 1200, height: 800 }, findDisplay);
  assert.strictEqual(b.x, 0);
  assert.strictEqual(b.y, 25);
});

check("слишком маленькое окно доводится до минимального", () => {
  const b = normalizeWindowBounds({ x: 10, y: 30, width: 100, height: 50 }, findDisplay);
  assert.ok(b.width >= 980 && b.height >= 680, `получилось ${b.width}x${b.height}`);
});

check("без сохранённых координат отдаётся только размер", () => {
  const b = normalizeWindowBounds({}, findDisplay);
  assert.deepStrictEqual(b, { width: 1440, height: 920 });
  assert.strictEqual(normalizeWindowBounds({ width: 1000 }, findDisplay).x, undefined);
});

check("битые координаты не пролезают", () => {
  const b = normalizeWindowBounds({ x: NaN, y: 10, width: 1200, height: 800 }, findDisplay);
  assert.strictEqual(b.x, undefined, "NaN не должен считаться координатой");
});

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены");
