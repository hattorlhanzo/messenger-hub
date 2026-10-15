const { clipboard, Menu, shell } = require("electron");
const { canOpenExternally } = require("./navigation.cjs");

// Меню по правой кнопке мыши.
//
// Electron своего контекстного меню не показывает вовсе, поэтому правый клик
// в мессенджере ничего не делал: нельзя было скопировать ссылку или картинку,
// вставить текст мышью, увидеть варианты исправления опечатки. Состав меню
// собирается из того, на чём кликнули, и проверяется тестом без Electron.

const maxSpellingSuggestions = 5;

function buildContextMenuTemplate(params = {}, actions = {}) {
  const sections = [];
  const flags = params.editFlags || {};

  if (params.isEditable && params.misspelledWord) {
    const suggestions = (params.dictionarySuggestions || []).slice(0, maxSpellingSuggestions);

    sections.push([
      ...(suggestions.length
        ? suggestions.map((word) => ({
            label: word,
            click: () => actions.replaceMisspelling?.(word)
          }))
        : [{ label: "Нет вариантов", enabled: false }]),
      {
        label: "Добавить в словарь",
        click: () => actions.addToDictionary?.(params.misspelledWord)
      }
    ]);
  }

  if (params.linkURL && canOpenExternally(params.linkURL)) {
    sections.push([
      {
        label: "Открыть ссылку в браузере",
        click: () => actions.openExternal?.(params.linkURL)
      },
      {
        label: "Скопировать ссылку",
        click: () => actions.copyText?.(params.linkURL)
      }
    ]);
  }

  if (params.mediaType === "image" && params.hasImageContents) {
    sections.push([
      {
        label: "Скопировать изображение",
        click: () => actions.copyImageAt?.(params.x, params.y)
      }
    ]);
  }

  if (params.isEditable) {
    sections.push([
      { role: "cut", label: "Вырезать", enabled: Boolean(flags.canCut) },
      { role: "copy", label: "Копировать", enabled: Boolean(flags.canCopy) },
      { role: "paste", label: "Вставить", enabled: Boolean(flags.canPaste) },
      { type: "separator" },
      { role: "selectAll", label: "Выделить всё", enabled: flags.canSelectAll !== false }
    ]);
  } else if (String(params.selectionText || "").trim()) {
    sections.push([{ role: "copy", label: "Копировать" }]);
  }

  return sections.flatMap((section, index) =>
    index === 0 ? section : [{ type: "separator" }, ...section]
  );
}

function attachContextMenu(contents, getWindow) {
  contents.on("context-menu", (_event, params) => {
    const template = buildContextMenuTemplate(params, {
      replaceMisspelling: (word) => contents.replaceMisspelling(word),
      addToDictionary: (word) => contents.session.addWordToSpellCheckerDictionary(word),
      openExternal: (url) => void shell.openExternal(url),
      copyText: (text) => clipboard.writeText(text),
      copyImageAt: (x, y) => contents.copyImageAt(x, y)
    });

    const win = getWindow();
    if (template.length === 0 || !win || win.isDestroyed()) {
      return;
    }

    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

module.exports = {
  attachContextMenu,
  buildContextMenuTemplate,
  maxSpellingSuggestions
};
