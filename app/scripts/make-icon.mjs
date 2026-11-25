/* Генерация исходной иконки 1024×1024 без внешних зависимостей.
   Рисуем в стиле приложения: тёплый фон --accent, «лист бумаги» и строки
   текста — метафора редактора. Запуск: node scripts/make-icon.mjs */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SIZE = 1024;

const BG = [0xb4, 0x53, 0x1f]; // --accent
const PAPER = [0xf7, 0xf5, 0xf1]; // --paper
const INK = [0x1f, 0x2a, 0x38]; // --ink

const px = new Uint8Array(SIZE * SIZE * 4);

/** Залить пиксель с альфа-смешиванием. */
function set(x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  if (a === 255) {
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    return;
  }
  const t = a / 255;
  px[i] = Math.round(px[i] * (1 - t) + r * t);
  px[i + 1] = Math.round(px[i + 1] * (1 - t) + g * t);
  px[i + 2] = Math.round(px[i + 2] * (1 - t) + b * t);
  px[i + 3] = 255;
}

/** Прямоугольник со скруглёнными углами. */
function roundRect(x0, y0, w, h, radius, color, alpha = 255) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const dx = Math.max(x0 + radius - x, 0, x - (x0 + w - 1 - radius));
      const dy = Math.max(y0 + radius - y, 0, y - (y0 + h - 1 - radius));
      const inside = dx === 0 || dy === 0 || dx * dx + dy * dy <= radius * radius;
      if (inside) set(x, y, color, alpha);
    }
  }
}

// Фон — скруглённый квадрат (иконки Windows любят «плитку»).
roundRect(0, 0, SIZE, SIZE, 180, BG);

// Лист бумаги.
const sheetX = 208;
const sheetY = 160;
const sheetW = 608;
const sheetH = 704;
roundRect(sheetX, sheetY, sheetW, sheetH, 56, PAPER);

// Строки текста: ширина убывает — «переписанный» абзац.
const lines = [
  { y: 288, w: 448 },
  { y: 392, w: 400 },
  { y: 496, w: 464 },
  { y: 600, w: 336 },
];
for (const { y, w } of lines) {
  roundRect(sheetX + 80, y, w, 44, 22, INK, 210);
}

// Акцентная «правка» — короткая линия другим цветом.
roundRect(sheetX + 80, 704, 200, 44, 22, BG, 235);

// --- PNG-энкодер ---------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// Каждая строка предваряется байтом фильтра 0.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 4 + 1);
  raw[rowStart] = 0;
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, rowStart + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync('app-icon.png', png);
console.log(`app-icon.png: ${SIZE}×${SIZE}, ${(png.length / 1024).toFixed(1)} КБ`);
