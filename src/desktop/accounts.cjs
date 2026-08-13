const fs = require("node:fs");
const path = require("node:path");

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
    userAgent: input.userAgent || desktopChromeUserAgent(),
    partition: input.partition || `persist:${id}`
  };
}

function desktopChromeUserAgent() {
  return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
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

  const raw = fs.readFileSync(accountsPath, "utf8");
  const accounts = JSON.parse(raw);
  return accounts.map(createAccount);
}

function saveAccounts(accounts) {
  const dataDir = getDataDir();
  const accountsPath = getAccountsPath();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(accountsPath, JSON.stringify(accounts, null, 2));
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

function nextAccountId(accounts, platform) {
  const prefix =
    platform === "whatsapp" ? "wa" : platform === "telegram" ? "tg" : "instagram";
  let index = 1;

  while (accounts.some((account) => account.id === `${prefix}_${index}`)) {
    index += 1;
  }

  return `${prefix}_${index}`;
}

function getDataDir() {
  return process.env.MESSENGER_HUB_DATA_DIR || fallbackDataDir;
}

function getAccountsPath() {
  return path.join(getDataDir(), "desktop-accounts.json");
}

module.exports = {
  addAccount,
  getAccountsPath,
  loadAccounts,
  removeAccount,
  reorderAccounts,
  saveAccounts,
  updateAccount
};
