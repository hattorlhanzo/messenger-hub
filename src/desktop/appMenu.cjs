const { Menu } = require("electron");

// Меню приложения в системной строке.
//
// Меню перестраивается целиком при каждом изменении: галочки состояния и
// список аккаунтов в нём живые. Всё, что меню умеет делать, передаётся
// действиями снаружи — сам модуль ничего про устройство приложения не знает.

// Больше девяти аккаунтов в меню не поместить: цифровых сочетаний всего девять.
const maxAccountShortcuts = 9;

// Раздел «Правка» нужен не ради самого меню. На macOS сочетания Cmd+C, Cmd+V,
// Cmd+A и Cmd+Z доходят до страницы только через пункты меню с этими ролями —
// без раздела копировать и вставлять в мессенджерах было нельзя.
const editMenu = {
  label: "Правка",
  submenu: [
    { role: "undo", label: "Отменить" },
    { role: "redo", label: "Повторить" },
    { type: "separator" },
    { role: "cut", label: "Вырезать" },
    { role: "copy", label: "Копировать" },
    { role: "paste", label: "Вставить" },
    { role: "pasteAndMatchStyle", label: "Вставить без форматирования" },
    { role: "delete", label: "Удалить" },
    { role: "selectAll", label: "Выделить всё" }
  ]
};

// Масштаб: видимые пункты плюс скрытые дубли сочетаний. Cmd+= работает
// без Shift, как в браузере, а цифровая клавиатура — для Windows.
function buildZoomItems(onZoom = () => {}) {
  const hidden = (accelerator, direction) => ({
    label: direction === "in" ? "Увеличить" : "Уменьшить",
    accelerator,
    visible: false,
    acceleratorWorksWhenHidden: true,
    click: () => onZoom(direction)
  });

  return [
    { label: "Увеличить", accelerator: "CommandOrControl+Plus", click: () => onZoom("in") },
    hidden("CommandOrControl+=", "in"),
    hidden("CommandOrControl+numadd", "in"),
    { label: "Уменьшить", accelerator: "CommandOrControl+-", click: () => onZoom("out") },
    hidden("CommandOrControl+numsub", "out"),
    { label: "Реальный размер", accelerator: "CommandOrControl+0", click: () => onZoom("reset") }
  ];
}

function buildAccountItems({ accounts, activeAccountId, onSelectAccount }) {
  if (accounts.length === 0) {
    return [{ label: "Аккаунтов пока нет", enabled: false }];
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
          label: "Показать Messenger Hub",
          accelerator: "CommandOrControl+Shift+M",
          click: actions.onShowWindow
        },
        {
          label: "Скрыть Messenger Hub",
          accelerator: "CommandOrControl+H",
          click: actions.onHideWindow
        },
        { type: "separator" },
        {
          label: "Быстрый переход…",
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
          label: "Запускать при входе в систему",
          type: "checkbox",
          checked: Boolean(settings.launchAtLogin),
          click: (menuItem) => actions.onToggleLaunchAtLogin(menuItem.checked)
        },
        {
          label: "Оставлять в фоне при закрытии окна",
          type: "checkbox",
          checked: settings.keepInBackground !== false,
          click: (menuItem) => actions.onToggleKeepInBackground(menuItem.checked)
        },
        { type: "separator" },
        {
          label: "Выйти из Messenger Hub",
          accelerator: "CommandOrControl+Q",
          click: actions.onQuit
        }
      ]
    },
    editMenu,
    {
      label: "Аккаунты",
      submenu: buildAccountItems({
        accounts,
        activeAccountId,
        onSelectAccount: actions.onSelectAccount
      })
    },
    {
      label: "Вид",
      submenu: [
        // Не role: "reload" — та перезагружала оболочку приложения,
        // а не мессенджер, который пользователь видит перед собой.
        {
          label: "Обновить страницу",
          accelerator: "CommandOrControl+R",
          click: actions.onReloadView
        },
        { label: "Назад", accelerator: "CommandOrControl+[", click: actions.onGoBack },
        { label: "Вперёд", accelerator: "CommandOrControl+]", click: actions.onGoForward },
        { type: "separator" },
        ...buildZoomItems(actions.onZoom),
        { type: "separator" },
        { role: "togglefullscreen", label: "Полноэкранный режим" },
        ...(isDevToolsEnabled
          ? [{ role: "toggleDevTools", label: "Инструменты разработчика" }]
          : [])
      ]
    },
    {
      label: "Окно",
      submenu: [
        { role: "minimize", label: "Свернуть" },
        { role: "zoom", label: "Развернуть" }
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
