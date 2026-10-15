// Проверка меню по правой кнопке мыши.
// Показ меню требует Electron, а его состав — обычная структура данных.
//
// Запуск: node scripts/check-context-menu.cjs

const assert = require("node:assert");
const {
  buildContextMenuTemplate,
  maxSpellingSuggestions
} = require("../src/desktop/contextMenu.cjs");

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

const labels = (template) => template.filter((i) => i.type !== "separator").map((i) => i.label);
const editFlags = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };

check("клик по пустому месту меню не открывает", () => {
  assert.deepStrictEqual(buildContextMenuTemplate({}), []);
  assert.deepStrictEqual(buildContextMenuTemplate({ selectionText: "   " }), []);
});

check("в поле ввода есть вырезать, копировать, вставить", () => {
  const template = buildContextMenuTemplate({ isEditable: true, editFlags });
  const roles = template.map((i) => i.role).filter(Boolean);
  assert.deepStrictEqual(roles, ["cut", "copy", "paste", "selectAll"]);
});

check("недоступные действия в поле ввода выключены", () => {
  const template = buildContextMenuTemplate({
    isEditable: true,
    editFlags: { canCut: false, canCopy: false, canPaste: true }
  });
  assert.strictEqual(template.find((i) => i.role === "cut").enabled, false);
  assert.strictEqual(template.find((i) => i.role === "paste").enabled, true);
});

check("выделенный текст в переписке можно скопировать", () => {
  const template = buildContextMenuTemplate({ selectionText: "привет" });
  assert.deepStrictEqual(template.map((i) => i.role), ["copy"]);
});

check("ссылку можно открыть в браузере и скопировать", () => {
  const opened = [];
  const copied = [];
  const template = buildContextMenuTemplate(
    { linkURL: "https://example.com/" },
    { openExternal: (url) => opened.push(url), copyText: (text) => copied.push(text) }
  );
  template.find((i) => i.label === "Открыть ссылку в браузере").click();
  template.find((i) => i.label === "Скопировать ссылку").click();
  assert.deepStrictEqual(opened, ["https://example.com/"]);
  assert.deepStrictEqual(copied, ["https://example.com/"]);
});

check("ссылки с непонятной схемой в меню не попадают", () => {
  assert.deepStrictEqual(buildContextMenuTemplate({ linkURL: "file:///etc/passwd" }), []);
  assert.deepStrictEqual(buildContextMenuTemplate({ linkURL: "javascript:alert(1)" }), []);
});

check("картинку можно скопировать, и копируется та, по которой кликнули", () => {
  let point;
  const template = buildContextMenuTemplate(
    { mediaType: "image", hasImageContents: true, x: 10, y: 20 },
    { copyImageAt: (x, y) => { point = [x, y]; } }
  );
  template.find((i) => i.label === "Скопировать изображение").click();
  assert.deepStrictEqual(point, [10, 20]);
});

check("при опечатке показываются варианты, не больше пяти", () => {
  const replaced = [];
  const template = buildContextMenuTemplate(
    {
      isEditable: true,
      editFlags,
      misspelledWord: "превед",
      dictionarySuggestions: ["привет", "превод", "прервал", "предел", "провод", "перевод", "привод"]
    },
    { replaceMisspelling: (word) => replaced.push(word) }
  );
  const all = labels(template);
  assert.strictEqual(all.indexOf("Добавить в словарь"), maxSpellingSuggestions);
  template[0].click();
  assert.deepStrictEqual(replaced, ["привет"]);
});

check("если вариантов нет, об этом сказано, а слово можно добавить в словарь", () => {
  let added;
  const template = buildContextMenuTemplate(
    { isEditable: true, editFlags, misspelledWord: "мессенджерхаб", dictionarySuggestions: [] },
    { addToDictionary: (word) => { added = word; } }
  );
  assert.strictEqual(template[0].label, "Нет вариантов");
  assert.strictEqual(template[0].enabled, false);
  template.find((i) => i.label === "Добавить в словарь").click();
  assert.strictEqual(added, "мессенджерхаб");
});

check("разделы отделены друг от друга, но не стоят по краям", () => {
  const template = buildContextMenuTemplate({
    isEditable: true,
    editFlags,
    linkURL: "https://example.com/"
  });
  assert.notStrictEqual(template[0].type, "separator");
  assert.notStrictEqual(template[template.length - 1].type, "separator");
  assert.ok(template.some((i) => i.type === "separator"));
});

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены");
