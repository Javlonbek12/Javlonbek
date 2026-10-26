import { describe, expect, it } from "vitest";

import { buildOrder, gapsOf, missing, type Catalog, type ElementSize } from "./builder";

const size = (over: Partial<ElementSize>): ElementSize => ({
  type: "POSI_L",
  heightMm: 28,
  widthMm: 640,
  perUnit: 1,
  price: 1500,
  material: "PET",
  note: null,
  verified: true,
  ...over,
});

const catalog: Catalog = {
  types: [
    { type: "POSI_L", heightMm: 2180, widthMm: 690, depthMm: 365, note: null },
    { type: "DG_L", heightMm: 2220, widthMm: 719, depthMm: 425, note: null },
  ],
  elements: [
    {
      id: "st",
      name: "Shelftalker",
      material: null,
      sizes: [
        size({ type: "POSI_L" }),
        size({ type: "DG_L", heightMm: 38, widthMm: 625, verified: false }),
        size({ type: "MW25_L", heightMm: 38, widthMm: 625 }),
      ],
    },
    {
      id: "dv",
      name: "Divider",
      material: "PET",
      sizes: [
        size({ type: "POSI_L", heightMm: 105, widthMm: 120, perUnit: 2, price: null }),
        size({ type: "DG_L", heightMm: 105, widthMm: 120, perUnit: 2, price: null }),
        size({ type: "MW25_L", perUnit: 0 }),
      ],
    },
  ],
};

describe("the order builder", () => {
  it("counts pieces per equipment with the reserve and prices them", () => {
    const lines = buildOrder({
      catalog,
      units: { POSI_L: 10, DG_L: 4, MW25_L: 3 },
      types: ["POSI_L", "DG_L"],
      elements: ["st"],
      reservePct: 0.1,
      merge: true,
    });
    // Different print sizes stay separate lines.
    expect(lines.map((l) => [l.name, l.quantity, l.sum])).toEqual([
      ["Shelftalker (POSI L (10*9))", 11, 16500],
      ["Shelftalker (DG L (10*10))", 5, 7500],
    ]);
    expect(lines[1]!.gaps).toEqual(["check"]);
  });

  it("merges equipment with the same print size and skips equipment the element isn't used on", () => {
    const lines = buildOrder({
      catalog,
      units: { POSI_L: 10, DG_L: 4, MW25_L: 3 },
      types: ["POSI_L", "DG_L", "MW25_L", "POSI_M"],
      elements: ["dv"],
      reservePct: 0,
      merge: true,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      types: ["POSI_L", "DG_L"],
      units: 14,
      quantity: 28,
      sum: null,
    });
    expect(lines[0]!.gaps).toEqual(["price"]);
    // POSI M has no size at all: the line shows what is missing.
    expect(lines[1]).toMatchObject({ types: ["POSI_M"], quantity: null });
    expect(lines[1]!.gaps).toEqual(["size", "perUnit", "price"]);
    expect(
      buildOrder({
        catalog,
        units: { POSI_L: 10, DG_L: 4 },
        types: ["POSI_L", "DG_L"],
        elements: ["dv"],
        reservePct: 0,
        merge: false,
      }),
    ).toHaveLength(2);
  });

  it("takes pieces per unit for this order over the catalog's", () => {
    const lines = buildOrder({
      catalog,
      units: { POSI_L: 10, DG_L: 4, POSI_M: 5 },
      types: ["POSI_L", "DG_L", "POSI_M"],
      elements: ["dv"],
      reservePct: 0,
      merge: true,
      perUnit: { "dv.POSI_L": 3, "dv.DG_L": 3, "dv.POSI_M": 0 },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ types: ["POSI_L", "DG_L"], perUnit: 3, quantity: 42 });
  });

  it("lists what is still to fill in", () => {
    expect(gapsOf(undefined)).toEqual(["size", "perUnit", "price"]);
    expect(gapsOf(size({ perUnit: 0, heightMm: null }))).toEqual([]);
    const gaps = missing(catalog);
    // 2 elements × 15 types, minus the complete pairs (Shelftalker POSI L, MW25 L; Divider MW25 L).
    expect(gaps.pairs).toHaveLength(27);
    expect(gaps.types).not.toContain("POSI_L");
    expect(gaps.types).toContain("POSI_MOD");
  });
});

describe("the builder's link", () => {
  it("reads pieces per unit for merged lines", async () => {
    const { builderOptions } = await import("./catalog");
    const query = new URLSearchParams(
      "t=POSI_L&e=dv&pu.dv.POSI_L%2BDG_L=2&pu.st.POSI_M=&reserve=5",
    );
    const options = builderOptions((key) => query.getAll(key), query.keys());
    expect(options.perUnit).toEqual({ "dv.POSI_L": 2, "dv.DG_L": 2 });
    expect(options.reservePct).toBe(0.05);
  });
});
