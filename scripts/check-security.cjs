// Проверка PIN-блокировки и восстановления положения окна.
// Оба модуля вынесены из main.cjs и потому проверяемы напрямую.
//
// Запуск: node scripts/check-security.cjs

const assert = require("node:assert");
const {
  createPinGuard,
  createPinSalt,
  hashPin,
  normalizeLockAfterMinutes,
  normalizePin,
  pinRetryDelayMs,
  shouldLockForIdle,
  verifyPin
} = require("../src/desktop/security.cjs");
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

check("время бездействия: неизвестное значение превращается в пять минут", () => {
  assert.strictEqual(normalizeLockAfterMinutes(undefined), 5);
  assert.strictEqual(normalizeLockAfterMinutes(null), 5);
  assert.strictEqual(normalizeLockAfterMinutes(7), 5);
  assert.strictEqual(normalizeLockAfterMinutes("15"), 15);
  assert.strictEqual(normalizeLockAfterMinutes(0), 0);
});

check("блокировка по бездействию срабатывает только после заданного времени", () => {
  const base = { pinEnabled: true, isLocked: false, lockAfterMinutes: 5 };
  assert.strictEqual(shouldLockForIdle({ ...base, idleSeconds: 299 }), false);
  assert.strictEqual(shouldLockForIdle({ ...base, idleSeconds: 300 }), true);
});

check("без PIN, при уже закрытом окне и при «не блокировать» блокировки нет", () => {
  const idle = { idleSeconds: 3600, lockAfterMinutes: 5 };
  assert.strictEqual(shouldLockForIdle({ ...idle, pinEnabled: false, isLocked: false }), false);
  assert.strictEqual(shouldLockForIdle({ ...idle, pinEnabled: true, isLocked: true }), false);
  assert.strictEqual(
    shouldLockForIdle({ ...idle, pinEnabled: true, isLocked: false, lockAfterMinutes: 0 }),
    false
  );
});

check("первые четыре ошибки без паузы, дальше пауза растёт до 15 минут", () => {
  assert.deepStrictEqual([1, 2, 3, 4].map(pinRetryDelayMs), [0, 0, 0, 0]);
  assert.strictEqual(pinRetryDelayMs(5), 30 * 1000);
  assert.strictEqual(pinRetryDelayMs(6), 60 * 1000);
  assert.strictEqual(pinRetryDelayMs(50), 15 * 60 * 1000);
});

check("во время паузы не принимается даже верный PIN", () => {
  let time = 0;
  const guard = createPinGuard({ now: () => time });
  for (let i = 0; i < 5; i += 1) guard.check("0000", settings);
  const blocked = guard.check("4321", settings);
  assert.strictEqual(blocked.ok, false);
  assert.ok(blocked.retryAfterMs > 0);
  time += 30 * 1000;
  assert.strictEqual(guard.check("4321", settings).ok, true);
});

check("верный PIN обнуляет счётчик ошибок", () => {
  const guard = createPinGuard({ now: () => 0 });
  for (let i = 0; i < 4; i += 1) guard.check("0000", settings);
  guard.check("4321", settings);
  assert.strictEqual(guard.check("0000", settings).retryAfterMs, 0, "снова четыре бесплатные попытки");
});

check("пауза после ошибок переживает перезапуск", () => {
  let time = 1000;
  let saved = {};
  const first = createPinGuard({ now: () => time, onChange: (state) => (saved = state) });
  for (let i = 0; i < 5; i += 1) first.check("0000", settings);
  assert.strictEqual(saved.failedAttempts, 5);

  // Новый запуск с тем, что записалось в настройки.
  const second = createPinGuard({ now: () => time, state: saved });
  assert.strictEqual(second.check("4321", settings).ok, false, "перезапуск не снимает паузу");
  time += 30 * 1000;
  assert.strictEqual(second.check("0000", settings).retryAfterMs, 60 * 1000, "счёт ошибок продолжается");
});

check("сохранённая пауза не длиннее 15 минут, даже если часы перевели", () => {
  const guard = createPinGuard({ now: () => 0, state: { failedAttempts: 9, blockedUntil: 10 ** 12 } });
  assert.ok(guard.check("4321", settings).retryAfterMs <= 15 * 60 * 1000);
});

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
