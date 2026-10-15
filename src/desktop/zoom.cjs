// Масштаб страницы мессенджера.
//
// Шаги те же, что в Chrome, — привычные проценты вместо произвольных значений.
// Масштаб у каждого аккаунта свой и хранится вместе с ним: один мессенджер
// удобно читать крупнее, другой нет, и после перезапуска настройка не теряется.

const zoomSteps = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const defaultZoomFactor = 1;

// Значение из файла могли поправить руками, поэтому приводим его к ближайшему шагу.
function normalizeZoomFactor(value) {
  const factor = Number(value);

  if (!Number.isFinite(factor) || factor <= 0) {
    return defaultZoomFactor;
  }

  return zoomSteps.reduce((best, step) =>
    Math.abs(step - factor) < Math.abs(best - factor) ? step : best
  );
}

// direction: "in" | "out" | "reset". На краях шкалы масштаб просто не меняется.
function nextZoomFactor(current, direction) {
  if (direction === "reset") {
    return defaultZoomFactor;
  }

  const index = zoomSteps.indexOf(normalizeZoomFactor(current));
  const nextIndex = direction === "in" ? index + 1 : index - 1;
  return zoomSteps[Math.min(Math.max(nextIndex, 0), zoomSteps.length - 1)];
}

module.exports = {
  defaultZoomFactor,
  nextZoomFactor,
  normalizeZoomFactor,
  zoomSteps
};
