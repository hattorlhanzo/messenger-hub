// Положение и размер окна между запусками.
//
// Окно могло остаться на мониторе, которого больше нет, или уехать за край
// экрана. Поэтому сохранённые координаты не применяются вслепую, а
// подтягиваются в границы того экрана, которому они ближе всего.

const minWidth = 980;
const minHeight = 680;
const defaultWidth = 1440;
const defaultHeight = 920;

// Полоска окна, которая обязана остаться видимой, чтобы за него можно было
// ухватиться мышью.
const keepVisibleX = 200;
const keepVisibleY = 120;

function normalizeWindowBounds(bounds = {}, findDisplay) {
  const width = Math.max(minWidth, Number(bounds.width) || defaultWidth);
  const height = Math.max(minHeight, Number(bounds.height) || defaultHeight);

  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
    return { width, height };
  }

  const display = findDisplay({ x: bounds.x, y: bounds.y, width, height });
  const area = display.workArea;
  const x = Math.min(Math.max(bounds.x, area.x), area.x + Math.max(0, area.width - keepVisibleX));
  const y = Math.min(Math.max(bounds.y, area.y), area.y + Math.max(0, area.height - keepVisibleY));

  return { x, y, width, height };
}

module.exports = { normalizeWindowBounds };
