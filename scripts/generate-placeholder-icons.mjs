// Generates placeholder PWA icons (dark square with a white "A" shape).
// Replace the files in public/icons with real icons later.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const DARK = [23, 23, 23];
const LIGHT = [255, 255, 255];

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// Is pixel (x, y) inside a simple "A" letter? Coordinates are 0..1.
function isLetter(x, y, scale) {
  const cx = 0.5;
  const top = 0.5 - 0.3 * scale;
  const bottom = 0.5 + 0.3 * scale;
  const halfWidth = 0.25 * scale;
  const stroke = 0.07 * scale;
  if (y < top || y > bottom) return false;
  const progress = (y - top) / (bottom - top);
  const edge = halfWidth * progress;
  const onLeg = Math.abs(Math.abs(x - cx) - edge) < stroke / 2 + 0.01;
  const barY = top + (bottom - top) * 0.62;
  const onBar = Math.abs(y - barY) < stroke / 2 && Math.abs(x - cx) < edge;
  return onLeg || onBar;
}

function png(size, scale) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const color = isLetter((x + 0.5) / size, (y + 0.5) / size, scale) ? LIGHT : DARK;
      row.set(color, 1 + x * 3);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const dir = new URL("../public/icons/", import.meta.url);
writeFileSync(new URL("icon-192.png", dir), png(192, 1));
writeFileSync(new URL("icon-512.png", dir), png(512, 1));
// Maskable icons need extra padding: the OS may crop up to 20% around the edges.
writeFileSync(new URL("icon-maskable-512.png", dir), png(512, 0.7));
writeFileSync(new URL("apple-touch-icon.png", dir), png(180, 1));
console.log("Icons written to public/icons");
