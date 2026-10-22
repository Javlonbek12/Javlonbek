import { describe, expect, it } from "vitest";

import {
  DEFAULT_PACK,
  depthRows,
  edgeColor,
  facingPlacements,
  hashSeed,
  PACK_GAP,
  seededRandom,
} from "./scene3d";

// A width × height RGBA picture: `edge` around the border band, `middle` inside.
function picture(
  width: number,
  height: number,
  edge: [number, number, number, number],
  middle: [number, number, number, number],
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const border = x < 2 || x >= width - 2 || y < 2 || y >= height - 2;
      data.set(border ? edge : middle, (y * width + x) * 4);
    }
  return data;
}

describe("edgeColor", () => {
  it("averages the edge band and ignores the middle", () => {
    const data = picture(20, 20, [200, 40, 10, 255], [0, 0, 255, 255]);
    expect(edgeColor(data, 20, 20, 4, 0.1)).toBe("#c8280a");
  });

  it("skips transparent pixels", () => {
    const data = picture(20, 20, [0, 0, 0, 0], [10, 20, 30, 255]);
    // Band of 0.25 reaches into the opaque middle, which is all that counts.
    expect(edgeColor(data, 20, 20, 4, 0.25)).toBe("#0a141e");
    expect(edgeColor(data, 20, 20, 4, 0.1)).toBeNull();
  });

  it("reads RGB without alpha", () => {
    const data = new Uint8Array(4 * 4 * 3).fill(128);
    expect(edgeColor(data, 4, 4, 3)).toBe("#808080");
  });
});

describe("seeded randomness", () => {
  it("gives the same sequence for the same slot and a different one for another", () => {
    const a = seededRandom(hashSeed("2:5"));
    const b = seededRandom(hashSeed("2:5"));
    const c = seededRandom(hashSeed("2:6"));
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("hashes strings to unsigned 32-bit numbers", () => {
    expect(hashSeed("")).toBe(0x811c9dc5);
    expect(hashSeed("0:0")).toBe(hashSeed("0:0"));
    expect(hashSeed("abc")).toBeLessThan(2 ** 32);
  });
});

describe("depthRows", () => {
  it("puts up to three packs one behind the other", () => {
    expect(depthRows(26, DEFAULT_PACK.d)).toBe(3);
  });

  it("fits fewer on a shallow shelf, but always the front one", () => {
    expect(depthRows(DEFAULT_PACK.d * 2 + PACK_GAP, DEFAULT_PACK.d)).toBe(2);
    expect(depthRows(3, DEFAULT_PACK.d)).toBe(1);
    expect(depthRows(1, DEFAULT_PACK.d)).toBe(1);
  });
});

describe("facingPlacements", () => {
  const options = { key: "1:3", centerX: 10, frontZ: 14, rows: 3, pack: DEFAULT_PACK };

  it("lines the rows up behind the front pack with a gap", () => {
    const rows = facingPlacements(options);
    expect(rows.map((p) => p.row)).toEqual([0, 1, 2]);
    expect(rows.every((p) => p.x === 10)).toBe(true);
    expect(rows[0]!.z).toBeCloseTo(14 - DEFAULT_PACK.d / 2);
    expect(rows[0]!.z - rows[1]!.z).toBeCloseTo(DEFAULT_PACK.d + PACK_GAP);
    expect(rows[1]!.z - rows[2]!.z).toBeCloseTo(DEFAULT_PACK.d + PACK_GAP);
  });

  it("turns each pack less than half a degree, the same way every time", () => {
    const first = facingPlacements(options);
    expect(facingPlacements(options)).toEqual(first);
    const limit = (0.5 * Math.PI) / 180;
    for (const p of first) expect(Math.abs(p.yaw)).toBeLessThanOrEqual(limit);
    expect(new Set(first.map((p) => p.yaw)).size).toBe(3);
  });
});
