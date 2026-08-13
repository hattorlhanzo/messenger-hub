// Генератор иконок для строки меню macOS.
// Там нужна не уменьшенная копия иконки приложения, а template-изображение:
// один силуэт с прозрачностью, который система сама перекрашивает под светлую
// и тёмную тему и под подсветку при нажатии.
//
// Запуск: node scripts/make-tray-icons.cjs

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const assetsDir = path.join(__dirname, "..", "src", "desktop", "assets");
const supersample = 4; // сглаживание краёв усреднением по подпикселям

// Силуэт: скруглённый прямоугольник реплики с хвостиком слева снизу.
// Координаты заданы в сетке 16x16 и масштабируются под нужный размер.
const bubble = { left: 1, top: 2.5, right: 15, bottom: 12, radius: 3.2 };
const tail = [
  { x: 4.6, y: 11 },
  { x: 4.6, y: 15.2 },
  { x: 8.4, y: 11.8 }
];

function isInsideRoundedRect(x, y, rect) {
  const { left, top, right, bottom, radius } = rect;
  if (x < left || x > right || y < top || y > bottom) {
    return false;
  }

  const cornerX = Math.min(Math.max(x, left + radius), right - radius);
  const cornerY = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cornerX;
  const dy = y - cornerY;
  return dx * dx + dy * dy <= radius * radius;
}

function isInsideTriangle(x, y, [a, b, c]) {
  const sign = (p, q, r) => (p.x - r.x) * (q.y - r.y) - (q.x - r.x) * (p.y - r.y);
  const point = { x, y };
  const d1 = sign(point, a, b);
  const d2 = sign(point, b, c);
  const d3 = sign(point, c, a);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function coverageAt(x, y) {
  return isInsideRoundedRect(x, y, bubble) || isInsideTriangle(x, y, tail) ? 1 : 0;
}

function renderIcon(size) {
  const scale = size / 16;
  const pixels = Buffer.alloc(size * size * 4);

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let hits = 0;

      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const x = (column + (sx + 0.5) / supersample) / scale;
          const y = (row + (sy + 0.5) / supersample) / scale;
          hits += coverageAt(x, y);
        }
      }

      const alpha = Math.round((hits / (supersample * supersample)) * 255);
      const offset = (row * size + column) * 4;
      // Template-изображение: цвет всегда чёрный, форму задаёт только альфа.
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = alpha;
    }
  }

  return pixels;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 бит на канал
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  // Каждая строка предваряется байтом фильтра (0 — без фильтрации).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let row = 0; row < size; row += 1) {
    raw[row * (size * 4 + 1)] = 0;
    pixels.copy(raw, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const outputs = [
  { name: "trayTemplate.png", size: 16 },
  { name: "trayTemplate@2x.png", size: 32 }
];

for (const { name, size } of outputs) {
  const target = path.join(assetsDir, name);
  fs.writeFileSync(target, encodePng(size, renderIcon(size)));
  console.log(`${name}: ${size}x${size}, ${fs.statSync(target).size} байт`);
}
