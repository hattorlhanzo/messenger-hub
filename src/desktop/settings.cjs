const fs = require("node:fs");
const path = require("node:path");
const { readJsonWithFallback, writeJsonAtomically } = require("./jsonStore.cjs");

const projectRoot = path.resolve(__dirname, "../..");
const fallbackDataDir = path.join(projectRoot, "data");

const defaultSettings = {
  operatorName: "",
  onboardingComplete: false,
  startAccountId: "",
  lastAccountId: "",
  notificationsEnabled: true,
  messagePreviewsEnabled: true,
  launchAtLogin: false,
  keepInBackground: true,
  compactMode: false,
  globalShortcutEnabled: true,
  globalShortcut: "Alt+Space",
  pinEnabled: false,
  pinHash: "",
  pinSalt: "",
  lockAfterMinutes: 5,
  // Адрес папки, куда выкладываются собранные файлы обновления.
  // Пока пустой, приложение обновления не ищет.
  updateFeedUrl: "",
  windowBounds: {
    width: 1440,
    height: 920
  },
  windowFullScreen: false
};

function loadSettings() {
  const settingsPath = getSettingsPath();
  fs.mkdirSync(getDataDir(), { recursive: true });

  if (!fs.existsSync(settingsPath)) {
    saveSettings(defaultSettings);
    return { ...defaultSettings };
  }

  const stored = readJsonWithFallback(settingsPath, {
    isValid: (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value),
    fallback: {}
  });

  return {
    ...defaultSettings,
    ...stored
  };
}

function saveSettings(settings) {
  fs.mkdirSync(getDataDir(), { recursive: true });
  writeJsonAtomically(getSettingsPath(), settings);
}

function updateSettings(patch) {
  const settings = {
    ...loadSettings(),
    ...patch
  };
  saveSettings(settings);
  return settings;
}

function getDataDir() {
  return process.env.MESSENGER_HUB_DATA_DIR || fallbackDataDir;
}

function getSettingsPath() {
  return path.join(getDataDir(), "desktop-settings.json");
}

module.exports = {
  getSettingsPath,
  loadSettings,
  updateSettings
};
