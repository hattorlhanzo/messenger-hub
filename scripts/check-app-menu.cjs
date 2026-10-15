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
  assert.strictEqual(items.find((i) => i.label === "Запускать при входе в систему").checked, true);
  assert.strictEqual(
    items.find((i) => i.label === "Оставлять в фоне при закрытии окна").checked,
    false
  );
});

check("«оставлять в фоне» включено, пока не выключили явно", () => {
  const items = buildMenuTemplate({ settings: {}, actions: {} })[0].submenu;
  assert.strictEqual(items.find((i) => i.label === "Оставлять в фоне при закрытии окна").checked, true);
});

function section(template, label) {
  return template.find((s) => s.label === label).submenu;
}

check("инструменты разработчика скрыты, пока их не включили", () => {
  const hidden = section(buildMenuTemplate({ actions: {} }), "Вид");
  const shown = section(buildMenuTemplate({ isDevToolsEnabled: true, actions: {} }), "Вид");
  assert.strictEqual(hidden.some((i) => i.role === "toggleDevTools"), false);
  assert.strictEqual(shown.some((i) => i.role === "toggleDevTools"), true);
});

check("разделы меню на месте", () => {
  const template = buildMenuTemplate({ actions: {} });
  assert.deepStrictEqual(
    template.map((s) => s.label),
    ["Messenger Hub", "Правка", "Аккаунты", "Вид", "Окно"]
  );
});

check("в «Правке» есть роли, без которых на Mac не работают Cmd+C и Cmd+V", () => {
  const roles = section(buildMenuTemplate({ actions: {} }), "Правка").map((i) => i.role);
  for (const role of ["undo", "redo", "cut", "copy", "paste", "selectAll"]) {
    assert.ok(roles.includes(role), `нет роли ${role}`);
  }
});

check("все пункты меню подписаны по-русски", () => {
  const latin = [];
  const walk = (items) =>
    items.forEach((item) => {
      if (item.type === "separator") return;
      // Название приложения — имя собственное, его не переводим.
      const label = String(item.label || "").replace("Messenger Hub", "");
      if (!item.label || /[a-z]{2,}/i.test(label)) latin.push(item.label || item.role);
      if (Array.isArray(item.submenu)) walk(item.submenu);
    });
  walk(buildMenuTemplate({ isDevToolsEnabled: true, actions: {} }));
  assert.deepStrictEqual(latin, []);
});

check("Cmd+R обновляет мессенджер, а не оболочку приложения", () => {
  let reloaded = false;
  const items = section(buildMenuTemplate({ actions: { onReloadView: () => { reloaded = true; } } }), "Вид");
  const reload = items.find((i) => i.accelerator === "CommandOrControl+R");
  assert.strictEqual(reload.role, undefined, "role: reload перезагружает окно оболочки");
  reload.click();
  assert.strictEqual(reloaded, true);
});

check("Cmd+[ и Cmd+] листают историю открытого мессенджера", () => {
  const calls = [];
  const items = section(
    buildMenuTemplate({
      actions: { onGoBack: () => calls.push("back"), onGoForward: () => calls.push("forward") }
    }),
    "Вид"
  );
  items.find((i) => i.accelerator === "CommandOrControl+[").click();
  items.find((i) => i.accelerator === "CommandOrControl+]").click();
  assert.deepStrictEqual(calls, ["back", "forward"]);
});

check("масштаб: Cmd+Plus, Cmd+= и Cmd+- меняют его, Cmd+0 сбрасывает", () => {
  const calls = [];
  const items = section(buildMenuTemplate({ actions: { onZoom: (d) => calls.push(d) } }), "Вид");
  for (const accelerator of [
    "CommandOrControl+Plus",
    "CommandOrControl+=",
    "CommandOrControl+-",
    "CommandOrControl+0"
  ]) {
    items.find((i) => i.accelerator === accelerator).click();
  }
  assert.deepStrictEqual(calls, ["in", "in", "out", "reset"]);
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

  items.find((i) => i.label === "Запускать при входе в систему").click({ checked: true });
  items.find((i) => i.label === "Оставлять в фоне при закрытии окна").click({ checked: false });
  assert.strictEqual(launch, true);
  assert.strictEqual(background, false);
});

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены");
