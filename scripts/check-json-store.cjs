// Проверка хранилища конфигов: битый файл не должен ронять приложение,
// а прежняя рабочая версия должна подхватываться из резервной копии.
// Запуск: node scripts/check-json-store.cjs

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");

const { readJsonWithFallback, writeJsonAtomically } = require("../src/desktop/jsonStore.cjs");

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-store-"));
const target = path.join(workDir, "accounts.json");
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

check("читает то, что записали", () => {
  writeJsonAtomically(target, [{ id: "wa_1" }]);
  const loaded = readJsonWithFallback(target, { isValid: Array.isArray, fallback: [] });
  assert.deepStrictEqual(loaded, [{ id: "wa_1" }]);
});

check("вторая запись оставляет резервную копию", () => {
  writeJsonAtomically(target, [{ id: "wa_1" }, { id: "tg_1" }]);
  assert.ok(fs.existsSync(`${target}.bak`), "резервная копия не создана");
});

check("обрезанный файл восстанавливается из резервной копии", () => {
  fs.writeFileSync(target, '[{ "id": "wa_1"');
  const loaded = readJsonWithFallback(target, { isValid: Array.isArray, fallback: [] });
  assert.deepStrictEqual(loaded, [{ id: "wa_1" }], "ожидалась прежняя версия из .bak");
});

check("если битые оба файла, отдаётся запасное значение и файл уводится в карантин", () => {
  fs.writeFileSync(target, "{ мусор");
  fs.writeFileSync(`${target}.bak`, "тоже мусор");

  const loaded = readJsonWithFallback(target, { isValid: Array.isArray, fallback: [] });
  assert.deepStrictEqual(loaded, []);
  assert.ok(!fs.existsSync(target), "битый файл должен быть переименован");
  assert.ok(
    fs.readdirSync(workDir).some((name) => name.includes(".corrupted-")),
    "карантинная копия не найдена"
  );
});

check("объект вместо массива не проходит проверку", () => {
  const objectTarget = path.join(workDir, "settings.json");
  fs.writeFileSync(objectTarget, '{"operatorName":"тест"}');

  const asArray = readJsonWithFallback(objectTarget, { isValid: Array.isArray, fallback: [] });
  assert.deepStrictEqual(asArray, [], "массив ожидался, объект принимать нельзя");
});

fs.rmSync(workDir, { recursive: true, force: true });

console.log(checks.join("\n"));
console.log(process.exitCode ? "\nЕсть провалившиеся проверки" : "\nВсе проверки пройдены");
