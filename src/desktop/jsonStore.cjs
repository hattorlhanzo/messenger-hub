const fs = require("node:fs");

// Хранилище настроек и аккаунтов на диске. Обычный readFileSync + JSON.parse ронял
// приложение на старте, если файл оказывался обрезанным, а обычный writeFileSync
// мог этот обрезанный файл создать. Здесь чтение всегда с откатом, запись — атомарная.

function readJsonWithFallback(targetPath, { isValid = () => true, fallback } = {}) {
  const backupPath = `${targetPath}.bak`;

  for (const candidate of [targetPath, backupPath]) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (isValid(parsed)) {
        return parsed;
      }
      console.error(`${candidate} parsed but failed validation, skipping it`);
    } catch (error) {
      console.error(`Failed to read ${candidate}:`, error.message);
    }
  }

  // Ни основной файл, ни резервная копия не читаются. Уводим оригинал в сторону,
  // чтобы его можно было разобрать позже, и отдаём значение по умолчанию —
  // приложение должно открыться в любом случае.
  quarantine(targetPath);
  return fallback;
}

function writeJsonAtomically(targetPath, value) {
  const tempPath = `${targetPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));

  if (fs.existsSync(targetPath)) {
    try {
      fs.copyFileSync(targetPath, `${targetPath}.bak`);
    } catch (error) {
      console.error(`Failed to back up ${targetPath}:`, error.message);
    }
  }

  fs.renameSync(tempPath, targetPath);
}

function quarantine(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  try {
    fs.renameSync(targetPath, `${targetPath}.corrupted-${Date.now()}`);
  } catch (error) {
    console.error(`Failed to quarantine ${targetPath}:`, error.message);
  }
}

module.exports = {
  readJsonWithFallback,
  writeJsonAtomically
};
