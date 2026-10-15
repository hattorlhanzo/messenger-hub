// Раскладка окна: где оболочка, а где страницы мессенджеров.
//
// Страница мессенджера — отдельный слой поверх оболочки, поэтому её место
// считается здесь, в пикселях, и должно совпадать с renderer.css. Раскладок
// пять, выбираются в настройках:
//
//   sidebar — боковая панель с названиями аккаунтов;
//   rail    — узкая полоса из значков;
//   tabs    — вкладки в заголовке окна;
//   hidden  — панели нет, сверху тонкая полоса с открытым аккаунтом;
//   split   — узкая полоса и два аккаунта рядом.

const layouts = ["sidebar", "rail", "tabs", "hidden", "split"];

const sizes = {
  sidebarWidth: 280,
  railWidth: 64,
  tabBarHeight: 44,
  stripHeight: 28,
  paneHeaderHeight: 36
};

// Раскладки до выбора раскладок не было, был только переключатель
// «компактная панель». Его значение переносится как есть.
function normalizeLayout(settings = {}) {
  if (layouts.includes(settings.layout)) {
    return settings.layout;
  }

  return settings.compactMode ? "rail" : "sidebar";
}

function rect(x, y, width, height) {
  return {
    x,
    y,
    width: Math.max(200, width),
    height: Math.max(200, height)
  };
}

// Место под страницы мессенджеров. secondary есть только у двух аккаунтов рядом.
function viewRects(layout, { width, height }) {
  if (layout === "rail") {
    return { primary: rect(sizes.railWidth, 0, width - sizes.railWidth, height), secondary: null };
  }

  if (layout === "tabs") {
    return {
      primary: rect(0, sizes.tabBarHeight, width, height - sizes.tabBarHeight),
      secondary: null
    };
  }

  if (layout === "hidden") {
    return {
      primary: rect(0, sizes.stripHeight, width, height - sizes.stripHeight),
      secondary: null
    };
  }

  if (layout === "split") {
    // Между половинами — линия в 1 пиксель, её рисует оболочка.
    const available = width - sizes.railWidth - 1;
    const left = Math.floor(available / 2);
    const top = sizes.paneHeaderHeight;
    return {
      primary: rect(sizes.railWidth, top, left, height - top),
      secondary: rect(sizes.railWidth + left + 1, top, available - left, height - top)
    };
  }

  return {
    primary: rect(sizes.sidebarWidth, 0, width - sizes.sidebarWidth, height),
    secondary: null
  };
}

// Кнопки окна macOS стоят внутри оболочки, и их место зависит от раскладки:
// в узкую полосу они помещаются только впритык, в тонкой полосе — по центру.
function windowButtonPosition(layout) {
  if (layout === "rail" || layout === "split") return { x: 6, y: 18 };
  if (layout === "tabs") return { x: 16, y: 15 };
  if (layout === "hidden") return { x: 12, y: 7 };
  return { x: 20, y: 20 };
}

// ⌘\ прячет панель и возвращает ту раскладку, что была до этого.
function toggleHiddenLayout(settings = {}) {
  const current = normalizeLayout(settings);

  if (current !== "hidden") {
    return { layout: "hidden", layoutBeforeHidden: current };
  }

  const previous = layouts.includes(settings.layoutBeforeHidden) ? settings.layoutBeforeHidden : "sidebar";
  return { layout: previous === "hidden" ? "sidebar" : previous };
}

module.exports = {
  layouts,
  normalizeLayout,
  sizes,
  toggleHiddenLayout,
  viewRects,
  windowButtonPosition
};
