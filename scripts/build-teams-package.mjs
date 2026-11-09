// Собирает пакет приложения Teams: манифест с подставленными доменом
// и client id + иконки. Иконки-заглушки создаются, если их ещё нет.
// Запуск: node --env-file=.env.local scripts/build-teams-package.mjs

import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TEAMS_DIR = 'teams';
const BUILD_DIR = join(TEAMS_DIR, 'build');

const domain = process.env.NEXT_PUBLIC_APP_DOMAIN;
const clientId = process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID;

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
  .replaceAll('{{CLIENT_ID}}', clientId);

writeFileSync(join(BUILD_DIR, 'manifest.json'), manifest);

for (const [name, data] of [
  ['color.png', colorIcon],
  ['outline.png', outlineIcon],
]) {
  const custom = join(TEAMS_DIR, name);
  const target = join(BUILD_DIR, name);
  writeFileSync(target, existsSync(custom) ? readFileSync(custom) : data);
}

console.log(`Готово: ${BUILD_DIR}`);
console.log(`  домен    ${domain}`);
console.log(`  client id ${clientId}`);
console.log('');
console.log('Собрать архив для загрузки в Teams:');
console.log(
  '  Compress-Archive -Path teams/build/* -DestinationPath teams/build/eneca-transport.zip -Force',
);
