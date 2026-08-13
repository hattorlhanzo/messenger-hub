// Выбор глобального сочетания клавиш.
//
// Вынесено отдельно от main.cjs, потому что проверить перебор запасных вариантов
// на macOS невозможно: система разрешает занять одно сочетание сразу нескольким
// программам, и register() всегда отвечает успехом. Отказ в регистрации — это
// поведение Windows, где Alt+Space занят системным меню окна. Здесь логика
// отделена от Electron и проверяется тестом на подставной функции регистрации.

// В Windows Alt+Space почти никогда не достаётся приложению.
const defaultGlobalShortcut = process.platform === "win32" ? "Alt+Shift+M" : "Alt+Space";

// Молча остаться без горячей клавиши хуже, чем занять соседнюю и сказать об этом.
const fallbackGlobalShortcuts = ["Alt+Shift+M", "Control+Alt+M", "Alt+Shift+Space"];

function chooseGlobalShortcut(requested, tryRegister) {
  const preferred = requested || defaultGlobalShortcut;
  const candidates = [
    preferred,
    ...fallbackGlobalShortcuts.filter((accelerator) => accelerator !== preferred)
  ];

  for (const accelerator of candidates) {
    if (tryRegister(accelerator)) {
      return { accelerator, requested: preferred, registered: true };
    }
  }

  return { accelerator: preferred, requested: preferred, registered: false };
}

module.exports = {
  chooseGlobalShortcut,
  defaultGlobalShortcut,
  fallbackGlobalShortcuts
};
