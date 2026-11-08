import { describe, expect, it } from "vitest";

import { shelfList, skuLabel } from "./shelf-list";

describe("the merchandisers' shelf list", () => {
  it("names an SKU without its brand twice", () => {
    expect(skuLabel({ brand: "ESSE", name: "ESSE Change (тест)" })).toBe("ESSE Change (тест)");
    expect(skuLabel({ brand: "BOHEM", name: "Cigar C (тест)" })).toBe("BOHEM Cigar C (тест)");
  });

  it("reads each shelf left to right, facings of one SKU together, with price and marks", () => {
    const skus = new Map([
      ["a", { brand: "ESSE", name: "Пачка А (тест)", priceStyle: "NUMBER" as const }],
      ["b", { brand: "PINE", name: "Пачка Б (тест)", priceStyle: "MING" as const }],
    ]);
    const list = shelfList(
      {
        "0:0": { kind: "POSM", posmId: "p", span: 2, rows: 1 },
        "0:2": { kind: "SKU", skuId: "a", badges: [] },
        "0:3": { kind: "SKU", skuId: "a", badges: [] },
        "0:4": { kind: "SKU", skuId: "a", badges: ["1mg"] },
        "1:0": { kind: "SKU", skuId: "b", badges: [] },
        "1:1": { kind: "EMPTY" },
      },
      {
        header: null,
        shelves: [
          { slots: 5, offset: 0, group: 0 },
          { slots: 4, offset: 0, group: 0 },
        ],
      },
      skus,
      new Map([["p", "Стикер (тест)"]]),
      new Map([
        ["a", 31000],
        ["b", 18000],
      ]),
    );
    expect(list).toEqual([
      {
        shelf: 1,
        entries: [
          { kind: "POSM", name: "Стикер (тест)" },
          { kind: "SKU", name: "ESSE Пачка А (тест)", facings: 2, price: "31 000", badges: [] },
          {
            kind: "SKU",
            name: "ESSE Пачка А (тест)",
            facings: 1,
            price: "31 000",
            badges: ["1mg"],
          },
        ],
      },
      {
        shelf: 2,
        entries: [
          { kind: "SKU", name: "PINE Пачка Б (тест)", facings: 1, price: "18 ming", badges: [] },
          { kind: "EMPTY", places: 1 },
          { kind: "UNDECIDED", places: 2 },
        ],
      },
    ]);
  });
});
