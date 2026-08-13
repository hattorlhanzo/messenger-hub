// Проверка записи логов.
// Главное здесь — что файл не растёт бесконечно и что сбой записи не мешает
// работе приложения: логирование не должно быть причиной падения.
//
// Запуск: node scripts/check-logger.cjs

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const logger = require("../src/desktop/logger.cjs");

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

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-log-"));
const logFile = logger.initLogger(workDir, { version: "1.5.0", platform: "test" });
const logDir = path.dirname(logFile);

check("файл создаётся и содержит заголовок запуска", () => {
  assert.ok(fs.existsSync(logFile), "файл лога не создан");
  assert.match(fs.readFileSync(logFile, "utf8"), /запуск 1\.5\.0/);
});

check("console.info попадает в файл", () => {
  console.info("проверочная строка из консоли");
  assert.match(fs.readFileSync(logFile, "utf8"), /INFO.*проверочная строка из консоли/);
});

check("console.error попадает в файл с уровнем ERROR", () => {
  console.error("ошибка для проверки");
  assert.match(fs.readFileSync(logFile, "utf8"), /ERROR.*ошибка для проверки/);
});

check("объект Error записывается вместе со стеком", () => {
  console.error(new Error("тестовое исключение"));
  const text = fs.readFileSync(logFile, "utf8");
  assert.match(text, /тестовое исключение/);
  assert.match(text, /at /, "стек вызовов не записан");
});

check("сообщение со страницы оболочки помечается отдельно", () => {
  logger.logFromRenderer("ERROR", "падение интерфейса");
  assert.match(fs.readFileSync(logFile, "utf8"), /\[окно\] падение интерфейса/);
});

check("файл не растёт бесконечно: срабатывает ротация", () => {
  const line = "x".repeat(4096);
  for (let i = 0; i < 700; i += 1) {
    logger.write("INFO", line);
  }

  const size = fs.statSync(logFile).size;
  assert.ok(size < 3 * 1024 * 1024, `текущий файл разросся до ${size} байт`);
  assert.ok(fs.existsSync(`${logFile}.1`), "предыдущий файл не сохранён");

  const all = fs.readdirSync(logDir).filter((n) => n.startsWith("main.log"));
  assert.ok(all.length <= 3, `файлов накопилось ${all.length}, ожидалось не больше трёх`);
});

check("недоступный для записи путь не роняет приложение", () => {
  const blocked = path.join(workDir, "readonly");
  fs.mkdirSync(blocked);
  fs.chmodSync(blocked, 0o500);

  assert.doesNotThrow(() => {
    logger.initLogger(blocked, { version: "1.5.0" });
    logger.write("INFO", "строка в недоступную папку");
  });

  fs.chmodSync(blocked, 0o700);
});

fs.rmSync(workDir, { recursive: true, force: true });

process.stdout.write(checks.join("\n") + "\n");
process.stdout.write(
  (process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены") + "\n"
);
