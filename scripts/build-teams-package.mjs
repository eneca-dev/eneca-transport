// Собирает пакет приложения Teams: манифест с подставленными доменом
// и client id + иконки. Иконки-заглушки создаются, если их ещё нет.
// Запуск: node --env-file=.env.local scripts/build-teams-package.mjs

import { deflateSync, deflateRawSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TEAMS_DIR = 'teams';
const BUILD_DIR = join(TEAMS_DIR, 'build');

const domain = process.env.NEXT_PUBLIC_APP_DOMAIN;
const clientId = process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID;
// Бот может жить на отдельной регистрации: Developer Portal заводит её сам
// и чужой идентификатор туда не принимает. Если бот на той же регистрации,
// что и вкладка, переменная не нужна.
const botId = process.env.NEXT_PUBLIC_TEAMS_BOT_ID || clientId;

if (!domain || !clientId) {
  console.error('Нужны NEXT_PUBLIC_APP_DOMAIN и NEXT_PUBLIC_ENTRA_CLIENT_ID. См. .env.example');
  process.exit(1);
}
if (domain !== domain.toLowerCase()) {
  console.error('Домен должен быть в нижнем регистре — иначе SSO не работает в Android.');
  process.exit(1);
}

// --- PNG без внешних зависимостей -------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** @param {number} size @param {(x: number, y: number) => [number, number, number, number]} pixel */
function png(size, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0; // фильтр строки
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Цветная иконка 192×192: сплошной фон с белой рамкой.
const colorIcon = png(192, (x, y) => {
  const border = x < 16 || y < 16 || x > 175 || y > 175;
  return border ? [255, 255, 255, 255] : [15, 76, 129, 255];
});

// Контурная иконка 32×32: белый контур на прозрачном фоне.
const outlineIcon = png(32, (x, y) => {
  const onEdge =
    (x >= 4 && x <= 27 && (y === 4 || y === 27)) || (y >= 4 && y <= 27 && (x === 4 || x === 27));
  return onEdge ? [255, 255, 255, 255] : [0, 0, 0, 0];
});

// --- Сборка -----------------------------------------------------------------

mkdirSync(BUILD_DIR, { recursive: true });

const manifest = readFileSync(join(TEAMS_DIR, 'manifest.template.json'), 'utf8')
  .replaceAll('{{DOMAIN}}', domain)
  .replaceAll('{{CLIENT_ID}}', clientId)
  .replaceAll('{{BOT_ID}}', botId);

writeFileSync(join(BUILD_DIR, 'manifest.json'), manifest);

for (const [name, data] of [
  ['color.png', colorIcon],
  ['outline.png', outlineIcon],
]) {
  const custom = join(TEAMS_DIR, name);
  const target = join(BUILD_DIR, name);
  writeFileSync(target, existsSync(custom) ? readFileSync(custom) : data);
}

// --- Архив для загрузки в Teams ----------------------------------------------

// Пакет собирается здесь же, а не отдельной командой в PowerShell. Причина не
// в удобстве: `Compress-Archive -Path teams/build/*` зависит от того, из какой
// папки его запустили, и упаковывает прошлый архив внутрь нового, если тот
// остался. Teams такой пакет не принимает, и понять это можно только по его
// отказу. Формат ZIP без сторонних зависимостей — три структуры из четырёх
// полей, и zlib уже под рукой.

const ZIP_VERSION = 20; // 2.0 — дефлейт, без ZIP64
const DEFLATED = 8;

/** Время в формате MS-DOS: секунды с шагом 2, год от 1980. */
function dosTime(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zip(files, when = new Date()) {
  const { time, day } = dosTime(when);
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const body = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(ZIP_VERSION, 4);
    local.writeUInt16LE(0, 6); // флаги: имя в UTF-8 не помечаем, оно ASCII
    local.writeUInt16LE(DEFLATED, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra

    parts.push(local, nameBytes, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(ZIP_VERSION, 4); // кем создан
    entry.writeUInt16LE(ZIP_VERSION, 6); // что требуется для распаковки
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(DEFLATED, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(day, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt16LE(0, 30); // extra
    entry.writeUInt16LE(0, 32); // комментарий
    entry.writeUInt16LE(0, 34); // номер диска
    entry.writeUInt16LE(0, 36); // внутренние атрибуты
    entry.writeUInt32LE(0, 38); // внешние атрибуты
    entry.writeUInt32LE(offset, 42);

    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // номер диска
  end.writeUInt16LE(0, 6); // диск с оглавлением
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // комментарий

  return Buffer.concat([...parts, directory, end]);
}

// Файлы лежат в корне архива — Teams не принимает пакет, где манифест внутри
// папки. Прошлый архив удаляется, а не перезаписывается: иначе он попал бы
// в список файлов нового.
const archive = join(BUILD_DIR, 'eneca-transport.zip');
if (existsSync(archive)) {
  rmSync(archive);
}

const names = ['manifest.json', 'color.png', 'outline.png'];
writeFileSync(
  archive,
  zip(names.map((name) => ({ name, data: readFileSync(join(BUILD_DIR, name)) }))),
);

console.log(`Готово: ${archive}`);
console.log(`  домен    ${domain}`);
console.log(`  client id ${clientId}`);
console.log(`  bot id    ${botId}`);
console.log('');
console.log('Загрузить в Teams: Приложения → Управление приложениями →');
console.log('Загрузить приложение → Загрузить настраиваемое приложение.');
