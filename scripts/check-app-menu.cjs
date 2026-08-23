// Проверка сборки меню приложения.
// Сам показ меню требует Electron, а вот его состав — обычная структура данных,
// и её можно проверить напрямую.
//
// Запуск: node scripts/check-app-menu.cjs

const assert = require("node:assert");
const {
  buildAccountItems,
  buildMenuTemplate,
  maxAccountShortcuts
} = require("../src/desktop/appMenu.cjs");

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

const many = Array.from({ length: 12 }, (_, i) => ({ id: `acc_${i}`, label: `Аккаунт ${i}` }));

check("пустой список аккаунтов не ломает меню", () => {
  const items = buildAccountItems({ accounts: [], onSelectAccount: () => {} });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].enabled, false);
});

check("аккаунтов больше девяти — лишние в меню не попадают", () => {
  const items = buildAccountItems({ accounts: many, onSelectAccount: () => {} });
  assert.strictEqual(items.length, maxAccountShortcuts, "цифровых сочетаний всего девять");
});

check("сочетания клавиш идут по порядку с единицы", () => {
  const items = buildAccountItems({ accounts: many, onSelectAccount: () => {} });
  assert.strictEqual(items[0].accelerator, "CommandOrControl+1");
  assert.strictEqual(items[8].accelerator, "CommandOrControl+9");
});

check("активный аккаунт отмечен галочкой, остальные нет", () => {
  const items = buildAccountItems({
    accounts: many,
    activeAccountId: "acc_2",
    onSelectAccount: () => {}
  });
  assert.strictEqual(items[2].checked, true);
  assert.strictEqual(items.filter((i) => i.checked).length, 1);
});

check("клик по пункту открывает нужный аккаунт", () => {
  let opened;
  const items = buildAccountItems({
    accounts: many,
    onSelectAccount: (id) => {
      opened = id;
    }
  });
  items[3].click();
  assert.strictEqual(opened, "acc_3");
});

check("галочки настроек отражают текущее состояние", () => {
  const template = buildMenuTemplate({
    settings: { launchAtLogin: true, keepInBackground: false },
    actions: {}
  });
  const items = template[0].submenu;
  assert.strictEqual(items.find((i) => i.label === "Launch at Login").checked, true);
  assert.strictEqual(
    items.find((i) => i.label === "Keep Running in Background").checked,
    false
  );
});

check("«оставлять в фоне» включено, пока не выключили явно", () => {
  const items = buildMenuTemplate({ settings: {}, actions: {} })[0].submenu;
  assert.strictEqual(items.find((i) => i.label === "Keep Running in Background").checked, true);
});

check("инструменты разработчика скрыты, пока их не включили", () => {
  const hidden = buildMenuTemplate({ actions: {} })[2].submenu;
  const shown = buildMenuTemplate({ isDevToolsEnabled: true, actions: {} })[2].submenu;
  assert.strictEqual(hidden.some((i) => i.role === "toggleDevTools"), false);
  assert.strictEqual(shown.some((i) => i.role === "toggleDevTools"), true);
});

check("разделы меню на месте", () => {
  const template = buildMenuTemplate({ actions: {} });
  assert.deepStrictEqual(
    template.map((s) => s.label),
    ["Messenger Hub", "Accounts", "View", "Window"]
  );
});

check("переключатели передают новое состояние наружу", () => {
  let launch, background;
  const items = buildMenuTemplate({
    settings: {},
    actions: {
      onToggleLaunchAtLogin: (v) => { launch = v; },
      onToggleKeepInBackground: (v) => { background = v; }
    }
  })[0].submenu;

  items.find((i) => i.label === "Launch at Login").click({ checked: true });
  items.find((i) => i.label === "Keep Running in Background").click({ checked: false });
  assert.strictEqual(launch, true);
  assert.strictEqual(background, false);
});

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены");
