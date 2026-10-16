const crypto = require("node:crypto");

// PIN-блокировка интерфейса.
//
// Это защита от чужих глаз, пока хозяин отошёл от компьютера, а не шифрование:
// файлы сессий на диске остаются доступны любому, кто вошёл в систему под этой
// учётной записью. Так и написано в настройках, чтобы не создавать ложного
// чувства безопасности.

function normalizePin(pin) {
  const normalizedPin = String(pin || "").trim();
  if (!/^\d{4,12}$/.test(normalizedPin)) {
    throw new Error("PIN must contain 4 to 12 digits");
  }
  return normalizedPin;
}

function hashPin(pin, salt) {
  return crypto.scryptSync(pin, salt, 32).toString("hex");
}

function createPinSalt() {
  return crypto.randomBytes(16).toString("hex");
}

// Сравнение идёт по всей длине независимо от того, где строки разошлись:
// иначе по времени ответа можно подбирать PIN посимвольно.
function verifyPin(pin, settings = {}) {
  if (!settings.pinEnabled || !settings.pinHash || !settings.pinSalt) {
    return true;
  }

  let candidate;
  try {
    candidate = hashPin(normalizePin(pin), settings.pinSalt);
  } catch {
    return false;
  }

  const saved = Buffer.from(settings.pinHash, "hex");
  const current = Buffer.from(candidate, "hex");
  return saved.length === current.length && crypto.timingSafeEqual(saved, current);
}

// Через сколько минут бездействия блокироваться. 0 — не блокироваться по
// бездействию, только при запуске, скрытии окна и блокировке экрана.
const lockAfterMinutesOptions = [0, 1, 5, 15, 30];
const defaultLockAfterMinutes = 5;

function normalizeLockAfterMinutes(value) {
  if (value === null || value === undefined || value === "") {
    return defaultLockAfterMinutes;
  }

  const minutes = Number(value);
  return lockAfterMinutesOptions.includes(minutes) ? minutes : defaultLockAfterMinutes;
}

// Бездействие считается по всей системе, а не по окну оболочки. Раньше таймер
// видел только мышь над полоской интерфейса: набор текста в мессенджере
// бездействием не отличался от отсутствия человека, а каждое новое сообщение,
// наоборот, сбрасывало отсчёт.
function shouldLockForIdle({ pinEnabled, isLocked, idleSeconds, lockAfterMinutes } = {}) {
  const minutes = normalizeLockAfterMinutes(lockAfterMinutes);
  return Boolean(pinEnabled) && !isLocked && minutes > 0 && Number(idleSeconds) >= minutes * 60;
}

// Защита от подбора. Опечататься пару раз можно без последствий, дальше
// каждая неудача удваивает паузу: 30 секунд, минута, две… но не больше 15 минут.
const freePinAttempts = 4;
const firstPinPauseMs = 30 * 1000;
const maxPinPauseMs = 15 * 60 * 1000;

function pinRetryDelayMs(failedAttempts) {
  if (failedAttempts <= freePinAttempts) {
    return 0;
  }

  return Math.min(firstPinPauseMs * 2 ** (failedAttempts - freePinAttempts - 1), maxPinPauseMs);
}

// Счётчик неудач общий для экрана блокировки и для смены или отключения PIN
// в настройках: иначе подбирать можно было бы через второй вход.
//
// Счётчик и пауза переживают перезапуск: state приходит из настроек, а onChange
// записывает их обратно. Раньше они жили только в памяти, и выход из
// приложения через значок в трее давал четыре новые бесплатные попытки.
function createPinGuard({ now = Date.now, state = {}, onChange = () => {} } = {}) {
  let failedAttempts = Math.max(0, Math.floor(Number(state.failedAttempts) || 0));
  // Пауза не может быть длиннее самой длинной: если часы перевели назад,
  // сохранённый срок иначе растянулся бы на сколько угодно.
  let blockedUntil = Math.min(Number(state.blockedUntil) || 0, now() + maxPinPauseMs);

  function save(nextFailed, nextBlocked) {
    if (nextFailed === failedAttempts && nextBlocked === blockedUntil) {
      return;
    }

    failedAttempts = nextFailed;
    blockedUntil = nextBlocked;
    onChange({ failedAttempts, blockedUntil });
  }

  return {
    check(pin, settings) {
      const wait = blockedUntil - now();
      if (wait > 0) {
        return { ok: false, retryAfterMs: wait };
      }

      if (verifyPin(pin, settings)) {
        save(0, 0);
        return { ok: true, retryAfterMs: 0 };
      }

      const delay = pinRetryDelayMs(failedAttempts + 1);
      save(failedAttempts + 1, delay ? now() + delay : 0);
      return { ok: false, retryAfterMs: delay };
    }
  };
}

module.exports = {
  createPinGuard,
  createPinSalt,
  defaultLockAfterMinutes,
  hashPin,
  lockAfterMinutesOptions,
  normalizeLockAfterMinutes,
  normalizePin,
  pinRetryDelayMs,
  shouldLockForIdle,
  verifyPin
};
