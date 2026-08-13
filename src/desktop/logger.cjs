const fs = require("node:fs");
const path = require("node:path");

// Запись событий в файл рядом с профилем.
//
// В собранном приложении консоли нет, поэтому всё, что приложение о себе
// сообщает — попытки переподключения, возврат аккаунта в сеть, отказ горячей
// клавиши — до сих пор пропадало впустую. На чужой машине это означало, что
// разобраться в жалобе «опять выкинуло» нечем.
//
// Логирование не должно ронять приложение: любая ошибка записи проглатывается.

const maxFileBytes = 2 * 1024 * 1024;
const keptOldFiles = 2;

let logFilePath;
let currentSize = 0;
let isConsoleBridged = false;

function initLogger(baseDir, meta = {}) {
  try {
    const dir = path.join(baseDir, "logs");
    fs.mkdirSync(dir, { recursive: true });
    logFilePath = path.join(dir, "main.log");
    currentSize = fs.existsSync(logFilePath) ? fs.statSync(logFilePath).size : 0;
  } catch (error) {
    console.error("Failed to open log file:", error.message);
    return undefined;
  }

  bridgeConsole();

  write(
    "INFO",
    `=== запуск ${meta.version || "?"} · ${meta.platform || process.platform} ${
      meta.arch || process.arch
    } · Electron ${meta.electron || process.versions.electron} ===`
  );

  return logFilePath;
}

function getLogFilePath() {
  return logFilePath;
}

function write(level, text) {
  if (!logFilePath) {
    return;
  }

  const line = `${new Date().toISOString()}  ${level.padEnd(5)}  ${text}\n`;

  try {
    if (currentSize + Buffer.byteLength(line) > maxFileBytes) {
      rotate();
    }

    fs.appendFileSync(logFilePath, line);
    currentSize += Buffer.byteLength(line);
  } catch {
    // Молча: сломанная запись лога не повод мешать работе.
  }
}

// Старые файлы сдвигаются по номерам, самый древний вытесняется.
// Так лог не растёт бесконечно, но история последних запусков сохраняется.
function rotate() {
  try {
    for (let index = keptOldFiles - 1; index >= 1; index -= 1) {
      const from = `${logFilePath}.${index}`;
      if (fs.existsSync(from)) {
        fs.renameSync(from, `${logFilePath}.${index + 1}`);
      }
    }

    if (fs.existsSync(logFilePath)) {
      fs.renameSync(logFilePath, `${logFilePath}.1`);
    }

    currentSize = 0;
  } catch {
    // Если переименовать не вышло, продолжаем писать в тот же файл.
  }
}

// Перехват консоли, а не замена вызовов по всему коду: сообщения продолжают
// печататься как раньше, и при запуске из терминала ничего не меняется.
function bridgeConsole() {
  if (isConsoleBridged) {
    return;
  }

  isConsoleBridged = true;

  for (const [method, level] of [
    ["log", "INFO"],
    ["info", "INFO"],
    ["warn", "WARN"],
    ["error", "ERROR"]
  ]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args);
      write(level, args.map(describe).join(" "));
    };
  }
}

function describe(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return `${value.message}\n${value.stack}`;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Ошибки со страницы оболочки: свой процесс, своя консоль, в файл сами не попадут.
function logFromRenderer(level, text) {
  write(String(level || "ERROR").toUpperCase().slice(0, 5), `[окно] ${text}`);
}

module.exports = {
  getLogFilePath,
  initLogger,
  logFromRenderer,
  write
};
