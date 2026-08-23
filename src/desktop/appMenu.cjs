const { Menu } = require("electron");

// Меню приложения в системной строке.
//
// Меню перестраивается целиком при каждом изменении: галочки состояния и
// список аккаунтов в нём живые. Всё, что меню умеет делать, передаётся
// действиями снаружи — сам модуль ничего про устройство приложения не знает.

// Больше девяти аккаунтов в меню не поместить: цифровых сочетаний всего девять.
const maxAccountShortcuts = 9;

function buildAccountItems({ accounts, activeAccountId, onSelectAccount }) {
  if (accounts.length === 0) {
    return [{ label: "No accounts", enabled: false }];
  }

  return accounts.slice(0, maxAccountShortcuts).map((account, index) => ({
    label: `${index + 1}. ${account.label}`,
    accelerator: `CommandOrControl+${index + 1}`,
    type: "checkbox",
    checked: account.id === activeAccountId,
    click: () => onSelectAccount(account.id)
  }));
}

function buildMenuTemplate({
  accounts = [],
  activeAccountId,
  settings = {},
  isDevToolsEnabled = false,
  actions = {}
}) {
  return [
    {
      label: "Messenger Hub",
      submenu: [
        {
          label: "Show Messenger Hub",
          accelerator: "CommandOrControl+Shift+M",
          click: actions.onShowWindow
        },
        {
          label: "Hide Messenger Hub",
          accelerator: "CommandOrControl+H",
          click: actions.onHideWindow
        },
        { type: "separator" },
        {
          label: "Quick Switch...",
          accelerator: "CommandOrControl+K",
          click: actions.onQuickSwitch
        },
        { type: "separator" },
        {
          label: "Проверить обновления",
          click: actions.onCheckUpdates
        },
        { type: "separator" },
        {
          label: "Launch at Login",
          type: "checkbox",
          checked: Boolean(settings.launchAtLogin),
          click: (menuItem) => actions.onToggleLaunchAtLogin(menuItem.checked)
        },
        {
          label: "Keep Running in Background",
          type: "checkbox",
          checked: settings.keepInBackground !== false,
          click: (menuItem) => actions.onToggleKeepInBackground(menuItem.checked)
        },
        { type: "separator" },
        {
          label: "Quit Messenger Hub",
          accelerator: "CommandOrControl+Q",
          click: actions.onQuit
        }
      ]
    },
    {
      label: "Accounts",
      submenu: buildAccountItems({
        accounts,
        activeAccountId,
        onSelectAccount: actions.onSelectAccount
      })
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "togglefullscreen" },
        ...(isDevToolsEnabled ? [{ role: "toggleDevTools" }] : [])
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" }
      ]
    }
  ];
}

function applyApplicationMenu(options) {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(options)));
}

module.exports = {
  applyApplicationMenu,
  buildAccountItems,
  buildMenuTemplate,
  maxAccountShortcuts
};
