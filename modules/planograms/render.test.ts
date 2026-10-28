import { describe, expect, it } from "vitest";

import { EQUIPMENT_FIXTURES } from "./fixtures";
import { escapeXml, planogramSize, renderPlanogramSvg, type RenderInput } from "./render";

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
    // One block two shelves high (104 is the pack height).
    expect(svg).toContain(`height="${104 + tagH + shelfH}" rx="6" fill="#15803d"`);
    // The 10 slots under the block (5 on each shelf) are not drawn as empty ones.
    const dashed = svg.match(/stroke-dasharray="4 3"/g)!.length;
    const shelves = displayL.shelves.reduce((n, s) => n + s.slots, 0);
    expect(dashed).toBe(shelves - 10);
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
    const input: RenderInput = {
      geometry,
      cells: {},
      shelftalkers: { 0: { name: "Change 1mg (тест)", color: "#1d4ed8", image: null } },
    };
    const svg = renderPlanogramSvg(input);
    // Shelf 1: its shelftalker; shelf 2: an empty strip; the others: none.
    expect(svg).toContain(">Change 1mg (тест)<");
    expect(svg.match(/fill="#e2e8f0"/g)).toHaveLength(1);
    // Every shelf gets the strip's room, so the pitch stays the same.
    expect(planogramSize(input).shelfH).toBe(
      planogramSize({ geometry: displayL, cells: {} }).shelfH + 26,
    );
  });

  it("sizes a stepped LEGO by its widest shelf", () => {
    expect(planogramSize({ geometry: lego, cells: {} }).width).toBe(16 * 2 + 9 * 64);
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
