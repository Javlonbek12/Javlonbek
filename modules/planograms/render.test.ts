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
