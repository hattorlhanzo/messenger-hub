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

module.exports = {
  createPinSalt,
  hashPin,
  normalizePin,
  verifyPin
};
