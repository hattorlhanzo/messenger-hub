// Сколько раз поднимать упавшую страницу мессенджера.
//
// Раньше счётчик падений обнулялся после каждой удачной загрузки. Страница,
// которая падает уже после загрузки, так и не упиралась в предел и
// перезагружалась по кругу каждые несколько секунд. Теперь считаются падения
// за последние десять минут, загрузка их не стирает.

const crashWindowMs = 10 * 60 * 1000;
const maxCrashesInWindow = 3;

// Возвращает новую историю падений и признак «хватит поднимать».
function recordCrash(history = [], now = Date.now()) {
  const recent = history.filter((time) => now - time < crashWindowMs);
  recent.push(now);
  return { history: recent, giveUp: recent.length > maxCrashesInWindow };
}

module.exports = {
  crashWindowMs,
  maxCrashesInWindow,
  recordCrash
};
