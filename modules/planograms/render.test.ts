import { describe, expect, it } from "vitest";

import { EQUIPMENT_FIXTURES } from "./fixtures";
import {
  escapeXml,
  planogramScene,
  planogramSize,
  renderPlanogramSvg,
  slotX,
  type RenderInput,
} from "./render";

const lego = EQUIPMENT_FIXTURES.find((e) => e.code === "LEGO_21")!.geometry;
const displayL = EQUIPMENT_FIXTURES.find((e) => e.code === "DISPLAY_L")!.geometry;

describe("renderPlanogramSvg", () => {
  it("draws packs with price tags, badges and a header", () => {
    const input: RenderInput = {
      geometry: displayL,
      header: { name: "B1RINCHILAR DAVRI", color: "#111827", image: null },
      cells: {
        "0:0": {
          kind: "SKU",
          brand: "ESSE",
          name: "ESSE Change 1 (тест)",
          color: "#1d4ed8",
          image: null,
          price: "28 000",
          badges: ["YANGI", "1mg"],
        },
        "1:0": { kind: "POSM", name: "QIROL QAYTDI", color: "#15803d", image: null, span: 10 },
        "2:0": { kind: "EMPTY" },
      },
    };
    const svg = renderPlanogramSvg(input);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("B1RINCHILAR DAVRI");
    expect(svg).toContain(">28 000 1mg<");
    expect(svg).toContain(">YANGI<");
    expect(svg).toContain("QIROL QAYTDI");
  });

  it("draws a POSM over two shelves without the slots it hangs over", () => {
    const svg = renderPlanogramSvg({
      geometry: displayL,
      cells: {
        "1:0": { kind: "POSM", name: "COMBO", color: "#15803d", image: null, span: 5, rows: 2 },
      },
    });
    const { shelfH, tagH } = planogramSize({ geometry: displayL, cells: {} });
    // One block two shelves high, down to the lower shelf's board (104 is the pack height).
    expect(svg).toContain(`height="${104 + tagH + 2 + shelfH}" rx="6" fill="#15803d"`);
    // The 10 slots under the block (5 on each shelf) are not drawn as empty ones.
    const dashed = svg.match(/stroke-dasharray="4 3"/g)!.length;
    const shelves = displayL.shelves.reduce((n, s) => n + s.slots, 0);
    expect(dashed).toBe(shelves - 10);
  });

  it("runs a shelftalker only beside a combo box, which reaches down to the lower talker", () => {
    const geometry = {
      header: null,
      shelves: Array.from({ length: 4 }, () => ({ slots: 10, offset: 0, group: 0, talker: true })),
    };
    const talker = { name: "Шелфтокер", color: "#0f766e", image: null };
    const input: RenderInput = {
      geometry,
      cells: {
        "1:0": { kind: "POSM", name: "COMBO", color: "#b45309", image: null, span: 5, rows: 2 },
      },
      shelftalkers: { 0: talker, 1: talker, 2: talker, 3: talker },
    };
    const scene = planogramScene(input);
    const talkers = scene.items.filter((i) => i.part === "talker" && i.type === "rect");
    const widths = talkers.map((i) => (i.type === "rect" ? [i.shelf, i.x, i.w] : null));
    const full =
      slotX(geometry, geometry.shelves[0]!, 9) + 64 - slotX(geometry, geometry.shelves[0]!, 0);
    const half =
      slotX(geometry, geometry.shelves[0]!, 9) + 64 - slotX(geometry, geometry.shelves[0]!, 5);
    expect(widths).toEqual([
      [0, 16, full],
      [1, slotX(geometry, geometry.shelves[1]!, 5), half],
      [2, slotX(geometry, geometry.shelves[2]!, 5), half],
      [3, 16, full],
    ]);
    // The box ends where the lower shelf's talker ends (both on the shelf edge).
    const box = scene.items.find((i) => i.part === "posm")!;
    const lower = talkers.find((i) => i.shelf === 2)!;
    if (box.type !== "rect" || lower.type !== "rect") throw new Error("rects");
    expect(box.y + box.h).toBe(lower.y + lower.h);
  });

  it("draws a header picture at its own proportions, within limits", () => {
    const header = { name: "H", color: "#111827", image: "data:image/png;base64,AA==" };
    const geometry = { ...displayL, header: "horizontal" as const };
    // 10 slots × 64 = 640 wide; a 600 × 230 mm header picture → 245 high.
    expect(
      planogramSize({ geometry, cells: {}, header: { ...header, aspect: 600 / 230 } }).headerBand,
    ).toBe(245);
    // Without a picture (or its proportions): the thin strip.
    expect(planogramSize({ geometry, cells: {}, header }).headerBand).toBe(56);
    // A square picture is capped at 45% of the width.
    expect(
      planogramSize({ geometry, cells: {}, header: { ...header, aspect: 1 } }).headerBand,
    ).toBe(288);
  });

  it("draws a shelftalker on the shelves that hold one", () => {
    const geometry = {
      ...displayL,
      shelves: displayL.shelves.map((shelf, i) => ({ ...shelf, talker: i < 2 })),
    };
    const pack = {
      kind: "SKU" as const,
      brand: "ESSE",
      name: "ESSE Change (тест)",
      color: "#1d4ed8",
      image: null,
      price: "28 000",
      badges: ["YANGI"],
    };
    const input: RenderInput = {
      geometry,
      cells: { "0:0": pack, "2:0": pack },
      shelftalkers: { 0: { name: "Change 1mg (тест)", color: "#1d4ed8", image: null } },
    };
    const scene = planogramScene(input);
    const strips = scene.items.filter((i) => i.part === "talker" && i.type === "rect");
    // Shelf 1: its shelftalker; shelf 2: an empty strip; the others: none.
    expect(strips.map((i) => (i.type === "rect" ? i.fill : null))).toEqual(["#1d4ed8", "#e2e8f0"]);
    // The price tag stands in the shelftalker, dark with a white price, as in the shop; on a
    // shelf without one it stays a white tag under the pack.
    const tags = scene.items.filter((i) => i.part === "tag");
    const [onTalker, plain] = tags.map((i) => (i.type === "rect" ? i : null));
    const strip = strips[0]!;
    expect(onTalker).toMatchObject({
      fill: "#0f172a",
      texts: [{ text: "28 000", color: "#ffffff" }],
    });
    expect(onTalker!.y).toBeGreaterThan(strip.type === "rect" ? strip.y : 0);
    expect(onTalker!.y + onTalker!.h).toBeLessThan(strip.type === "rect" ? strip.y + strip.h : 0);
    expect(plain).toMatchObject({ fill: "#fff", texts: [{ color: "#111827" }] });
    // «YANGI» at the top of the pack (over the health warning), not over its design.
    const badge = scene.items.find((i) => i.part === "badge" && i.shelf === 0);
    const packTop = scene.items.find((i) => i.part === "pack" && i.shelf === 0);
    const y = (i: typeof badge) => (i && i.type === "rect" ? i.y : NaN);
    expect(y(badge) - y(packTop)).toBeLessThan(20);
    // Every shelf gets the strip's room, so the pitch stays the same.
    expect(planogramSize(input).shelfH).toBe(
      planogramSize({ geometry: displayL, cells: {} }).shelfH + 4,
    );
  });

  it("sizes a stepped LEGO by its widest shelf, with room between its sections", () => {
    expect(planogramSize({ geometry: lego, cells: {} }).width).toBe(16 * 2 + 9 * 64 + 2 * 10);
    // The short top row lines up with the middle section of the rows below.
    expect(slotX(lego, lego.shelves[0]!, 0)).toBe(slotX(lego, lego.shelves[1]!, 3));
  });

  it("sets the sections of a module apart with a line", () => {
    const module9x2 = EQUIPMENT_FIXTURES.find((e) => e.code === "MODULE_9x2")!.geometry;
    const svg = renderPlanogramSvg({ geometry: module9x2, cells: {} });
    expect(svg.match(/<line /g)).toHaveLength(4);
    expect(
      slotX(module9x2, module9x2.shelves[0]!, 3) - slotX(module9x2, module9x2.shelves[0]!, 2),
    ).toBe(64 + 10);
  });

  it("escapes text so names can't break the picture", () => {
    expect(escapeXml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&apos;");
    const svg = renderPlanogramSvg({
      geometry: lego,
      cells: {
        "0:0": {
          kind: "SKU",
          brand: "X",
          name: "<script>",
          color: "#000",
          image: null,
          price: null,
          badges: [],
        },
      },
    });
    expect(svg).not.toContain("<script>");
  });

  it("outlines changed cells in comparisons", () => {
    const svg = renderPlanogramSvg({
      geometry: lego,
      cells: {},
      highlight: new Map([["0:1", "removed"]]),
    });
    expect(svg).toContain('stroke="#dc2626"');
  });
});
