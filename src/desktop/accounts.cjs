const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readJsonWithFallback, writeJsonAtomically } = require("./jsonStore.cjs");
const { normalizeZoomFactor } = require("./zoom.cjs");

const projectRoot = path.resolve(__dirname, "../..");
const fallbackDataDir = path.join(projectRoot, "data");

const defaultAccounts = [];

function platformUrl(platform) {
  if (platform === "whatsapp") return "https://web.whatsapp.com/";
  if (platform === "telegram") return "https://web.telegram.org/k/";
  return "https://www.instagram.com/direct/inbox/";
}

function createAccount(input) {
  const platform = input.platform;
  const id = sanitizeId(input.id || `${platform}_${Date.now()}`);

  return {
    id,
    label: input.label || defaultLabel(platform),
    platform,
    phone: input.phone || "",
    notificationsEnabled: input.notificationsEnabled !== false,
    url: input.url || platformUrl(platform),
    partition: input.partition || `persist:${id}`,
    zoomFactor: normalizeZoomFactor(input.zoomFactor)
  };
}

// Строка была зашита под macOS, из-за чего на Windows мессенджеры отдавали
// интерфейс для Mac — вплоть до чужих сочетаний клавиш в подсказках.
const platformTokens = {
  darwin: "Macintosh; Intel Mac OS X 10_15_7",
  win32: "Windows NT 10.0; Win64; x64",
  linux: "X11; Linux x86_64"
};

// Запасная версия на случай запуска вне Electron — в проверках.
const fallbackChromeMajor = "150";

// User-Agent собирается при каждом запуске из версии движка и у аккаунта
// не хранится. Раньше строка с номером Chrome записывалась в файл аккаунтов
// при создании и больше не менялась: движок обновлялся вместе с Electron, а
// сайтам по-прежнему называлась старая версия. Расхождение строки с тем, что
// движок сообщает о себе в заголовках Sec-CH-UA, сайты Meta замечают.
// Формат «Chrome/150.0.0.0» — тот же, что отдаёт настоящий Chrome: младшие
// части номера он давно не раскрывает.
function desktopChromeUserAgent(chromeVersion = process.versions.chrome) {
  const token = platformTokens[process.platform] || platformTokens.darwin;
  const major = String(chromeVersion || "").split(".")[0] || fallbackChromeMajor;
  return `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

function defaultLabel(platform) {
  if (platform === "whatsapp") return "WhatsApp";
  if (platform === "telegram") return "Telegram";
  return "Instagram";
}

function sanitizeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function loadAccounts() {
  const dataDir = getDataDir();
  const accountsPath = getAccountsPath();
  fs.mkdirSync(dataDir, { recursive: true });

  if (!fs.existsSync(accountsPath)) {
    saveAccounts(defaultAccounts);
    return defaultAccounts;
  }

  const accounts = readJsonWithFallback(accountsPath, {
    isValid: Array.isArray,
    fallback: []
  });
  return accounts.map(createAccount);
}

function saveAccounts(accounts) {
  const dataDir = getDataDir();
  const accountsPath = getAccountsPath();
  fs.mkdirSync(dataDir, { recursive: true });
  writeJsonAtomically(accountsPath, accounts);
}

function addAccount(input) {
  const accounts = loadAccounts();
  const account = createAccount({
    ...input,
    id: nextAccountId(accounts, input.platform)
  });
  accounts.push(account);
  saveAccounts(accounts);
  return account;
}

function updateAccount(id, patch) {
  const accounts = loadAccounts();
  const index = accounts.findIndex((account) => account.id === id);

  if (index < 0) {
    throw new Error(`Account ${id} not found`);
  }

  accounts[index] = createAccount({
    ...accounts[index],
    ...patch,
    id: accounts[index].id,
    platform: accounts[index].platform,
    partition: accounts[index].partition
  });
  saveAccounts(accounts);
  return accounts[index];
}

function removeAccount(id) {
  const accounts = loadAccounts();
  const nextAccounts = accounts.filter((account) => account.id !== id);

  if (nextAccounts.length === accounts.length) {
    throw new Error(`Account ${id} not found`);
  }

  saveAccounts(nextAccounts);
  return nextAccounts;
}

function reorderAccounts(ids) {
  const accounts = loadAccounts();
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  const remaining = accounts.filter((account) => !ids.includes(account.id));
  const nextAccounts = [...ordered, ...remaining];

  saveAccounts(nextAccounts);
  return nextAccounts;
}

// Идентификатор задаёт имя папки с сессией, поэтому переиспользовать его нельзя.
// Раньше номера выдавались по порядку и занимали первый свободный: удалив wa_1
// и добавив новый WhatsApp, пользователь получал wa_1 обратно — вместе с чужой
// сессией входа, которая осталась на диске.
function nextAccountId(accounts, platform) {
  const prefix =
    platform === "whatsapp" ? "wa" : platform === "telegram" ? "tg" : "instagram";

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = `${prefix}_${crypto.randomBytes(3).toString("hex")}`;
    if (!isAccountIdTaken(accounts, id)) {
      return id;
    }
  }

  return `${prefix}_${Date.now().toString(36)}`;
}

function isAccountIdTaken(accounts, id) {
  if (accounts.some((account) => account.id === id)) {
    return true;
  }

  // Папка сессии удалённого аккаунта остаётся на диске, если её не очищали явно.
  return fs.existsSync(path.join(getDataDir(), "Partitions", id));
}

function getDataDir() {
  return process.env.MESSENGER_HUB_DATA_DIR || fallbackDataDir;
}

function getAccountsPath() {
  return path.join(getDataDir(), "desktop-accounts.json");
}

module.exports = {
  addAccount,
  desktopChromeUserAgent,
  getAccountsPath,
  loadAccounts,
  removeAccount,
  reorderAccounts,
  saveAccounts,
  updateAccount
};
