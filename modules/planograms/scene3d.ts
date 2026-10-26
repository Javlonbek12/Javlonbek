// Pure helpers for the 3D view (no three.js here, so they run in tests and on the server).
// Sizes in centimetres, like the scene.

// A cigarette pack when the library has no size for it: 55 × 85 × 22 mm.
export const DEFAULT_PACK = { w: 5.5, h: 8.5, d: 2.2 } as const;
// Packs stand 1.5 mm apart, side by side and front to back.
export const PACK_GAP = 0.15;
// The front pack and up to two rows behind it.
export const MAX_ROWS = 3;

// FNV-1a: a stable number from a string (the slot key), so every opening looks the same.
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// mulberry32: a small seeded random generator, values in [0, 1).
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// How many packs fit one behind the other on a shelf of this depth.
export function depthRows(shelfDepth: number, packDepth: number, max = MAX_ROWS): number {
  if (packDepth <= 0) return 1;
  const fit = Math.floor((shelfDepth + PACK_GAP) / (packDepth + PACK_GAP));
  return Math.max(1, Math.min(max, fit));
}

export type PackPlacement = { x: number; z: number; yaw: number; row: number };

// The packs of one facing: the front one at `frontZ` (its front face), the rest behind it,
// each turned a little around the vertical (±maxYawDeg), the same way every time for this slot.
export function facingPlacements(options: {
  key: string;
  centerX: number;
  frontZ: number;
  rows: number;
  pack: { d: number };
  maxYawDeg?: number;
}): PackPlacement[] {
  const { key, centerX, frontZ, rows, pack, maxYawDeg = 0.5 } = options;
  const random = seededRandom(hashSeed(key));
  const maxYaw = (maxYawDeg * Math.PI) / 180;
  return Array.from({ length: rows }, (_, row) => ({
    x: centerX,
    z: frontZ - pack.d / 2 - row * (pack.d + PACK_GAP),
    yaw: (random() * 2 - 1) * maxYaw,
    row,
  }));
}

const hex = (value: number) =>
  Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, "0");

// The average colour of a picture's edge band (the outer `band` share of each side), skipping
// transparent pixels: the colour a pack's sides, top and bottom get in 3D. Null when the edge is
// all transparent. `pixels` is raw RGB or RGBA, row by row.
export function edgeColor(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  channels: 3 | 4,
  band = 0.08,
): string | null {
  const bx = Math.max(1, Math.round(width * band));
  const by = Math.max(1, Math.round(height * band));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (x >= bx && x < width - bx && y >= by && y < height - by) continue;
      const i = (y * width + x) * channels;
      if (channels === 4 && pixels[i + 3]! < 128) continue;
      r += pixels[i]!;
      g += pixels[i + 1]!;
      b += pixels[i + 2]!;
      n++;
    }
  if (n === 0) return null;
  return `#${hex(r / n)}${hex(g / n)}${hex(b / n)}`;
}
