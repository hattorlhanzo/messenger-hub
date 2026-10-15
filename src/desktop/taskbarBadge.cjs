// Непрочитанные на значке в панели задач Windows.
//
// app.setBadgeCount на Windows ничего не делает, поэтому на значке не было видно,
// что пришли сообщения. Там счётчик рисуется как маленькая картинка поверх
// значка (overlay icon), как это делают Telegram Desktop и Slack. Сам рисунок
// делает страница оболочки — у неё есть canvas; здесь только решения, что рисовать
// и когда привлекать внимание.

function taskbarBadgeText(total) {
  const count = Math.floor(Number(total) || 0);

  if (count <= 0) {
    return "";
  }

  return count > 99 ? "99+" : String(count);
}

// Кнопка в панели задач мигает, когда пришло новое сообщение, а окно не перед
// глазами. Перестаёт, как только окно получает фокус. На macOS то же самое
// означало бы прыгающий значок в Доке, поэтому там не мигаем.
function shouldFlashTaskbar({
  platform,
  hasBaseline = false,
  previous = 0,
  next = 0,
  isWindowFocused = false,
  notificationsAllowed = true
} = {}) {
  return (
    platform === "win32" &&
    hasBaseline &&
    next > previous &&
    !isWindowFocused &&
    Boolean(notificationsAllowed)
  );
}

// Картинку присылает страница оболочки — проверяем, что это действительно
// небольшая PNG, а не что-то постороннее.
const maxBadgeDataUrlLength = 200 * 1024;

function isBadgeDataUrl(value) {
  return (
    typeof value === "string" &&
    value.startsWith("data:image/png;base64,") &&
    value.length <= maxBadgeDataUrlLength
  );
}

module.exports = {
  isBadgeDataUrl,
  shouldFlashTaskbar,
  taskbarBadgeText
};
