// Проверка раскладок окна: где лежат страницы мессенджеров.
// Числа должны совпадать с renderer.css — иначе страница наедет на оболочку.
//
// Запуск: node scripts/check-layout.cjs

const assert = require("node:assert");
const {
  layouts,
  normalizeLayout,
  sizes,
  toggleHiddenLayout,
  viewRects,
  windowButtonPosition
} = require("../src/desktop/layout.cjs");

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

const win = { width: 1440, height: 900 };

check("без выбранной раскладки — боковая панель", () => {
  assert.strictEqual(normalizeLayout({}), "sidebar");
  assert.strictEqual(normalizeLayout({ layout: "мусор" }), "sidebar");
});

check("прежняя «компактная панель» становится узкой полосой", () => {
  assert.strictEqual(normalizeLayout({ compactMode: true }), "rail");
  assert.strictEqual(normalizeLayout({ compactMode: true, layout: "tabs" }), "tabs");
});

check("боковая панель: мессенджер справа от неё во всю высоту", () => {
  const { primary, secondary } = viewRects("sidebar", win);
  assert.deepStrictEqual(primary, { x: 280, y: 0, width: 1160, height: 900 });
  assert.strictEqual(secondary, null);
});

check("узкая полоса: 64 пикселя слева", () => {
  assert.deepStrictEqual(viewRects("rail", win).primary, { x: 64, y: 0, width: 1376, height: 900 });
});

check("вкладки: вся ширина, сверху полоса вкладок", () => {
  assert.deepStrictEqual(viewRects("tabs", win).primary, { x: 0, y: 44, width: 1440, height: 856 });
});

check("без панели: вся ширина, сверху тонкая полоса", () => {
  assert.deepStrictEqual(viewRects("hidden", win).primary, { x: 0, y: 28, width: 1440, height: 872 });
});

check("два аккаунта: половины не перекрываются и занимают всё место", () => {
  const { primary, secondary } = viewRects("split", win);
  assert.strictEqual(primary.x, sizes.railWidth);
  assert.strictEqual(primary.y, sizes.paneHeaderHeight);
  assert.strictEqual(secondary.x, primary.x + primary.width + 1, "между половинами линия в 1 пиксель");
  assert.strictEqual(secondary.x + secondary.width, win.width);
  assert.ok(Math.abs(primary.width - secondary.width) <= 1);
});

check("в крошечном окне размеры не уходят в ноль", () => {
  for (const layout of layouts) {
    const { primary } = viewRects(layout, { width: 100, height: 50 });
    assert.ok(primary.width >= 200 && primary.height >= 200, layout);
  }
});

check("кнопки окна macOS помещаются в узкую полосу", () => {
  const { x } = windowButtonPosition("rail");
  // Три кнопки с промежутками — около 54 пикселей.
  assert.ok(x + 54 <= sizes.railWidth);
});

check("⌘\\ прячет панель и возвращает прежнюю раскладку", () => {
  const hidden = toggleHiddenLayout({ layout: "tabs" });
  assert.deepStrictEqual(hidden, { layout: "hidden", layoutBeforeHidden: "tabs" });
  assert.deepStrictEqual(toggleHiddenLayout({ ...hidden }), { layout: "tabs" });
});

check("если прежняя раскладка неизвестна, возвращается боковая панель", () => {
  assert.deepStrictEqual(toggleHiddenLayout({ layout: "hidden" }), { layout: "sidebar" });
});

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены");
