import { describe, expect, it } from "vitest";

import { makeModel, makeSku, MONTHS } from "@/tests/helpers/sop";

import { compareUploads, forecastAccuracy } from "./compare";

const all = (value: number) => MONTHS.map(() => value);
const sku = (name: string, change = {}) =>
  makeSku(name, {
    po: [0, 200, 0, 200, 0, 200, 0, 200, 0, 200, 0],
    sellIn: all(100),
    sellThru: all(100),
    ...change,
  });

describe("compareUploads", () => {
  const ours = {
    model: makeModel([sku("SKU A"), sku("SKU B"), sku("SKU OLD")]),
    cycle: "2026-11",
    kind: "OURS" as const,
  };
  const final = {
    model: makeModel([
      sku("SKU A", { po: [0, 200, 0, 200, 0, 200, 0, 300, 0, 0, 0], sellIn: [100, 100, 100, 999] }),
      sku("SKU B"),
      sku("SKU NEW"),
    ]),
    cycle: "2026-11",
    kind: "HQ_FINAL" as const,
  };

  it("lists every changed cell from the closed month on, with the sheet's totals", () => {
    const result = compareUploads(ours, final);
    // From October (the closed month of the cycle): September's change is history.
    expect(result.months).toEqual(MONTHS.slice(4));
    expect(result.changes.map((c) => [c.name, c.month, c.metric, c.was, c.now, c.delta])).toEqual([
      ["SKU A", "2026-10", "sellIn", 100, 0, -100],
      ["SKU A", "2026-11", "sellIn", 100, 0, -100],
      ["SKU A", "2026-12", "sellIn", 100, 0, -100],
      ["SKU A", "2027-01", "po", 200, 300, 100],
      ["SKU A", "2027-01", "plan", 200, 300, 100],
      ["SKU A", "2027-01", "out", 200, 300, 100],
      ["SKU A", "2027-01", "sellIn", 100, 0, -100],
      ["SKU A", "2027-02", "sellIn", 100, 0, -100],
      ["SKU A", "2027-03", "po", 200, 0, -200],
      ["SKU A", "2027-03", "plan", 200, 0, -200],
      ["SKU A", "2027-03", "out", 200, 0, -200],
      ["SKU A", "2027-03", "sellIn", 100, 0, -100],
      ["SKU A", "2027-04", "sellIn", 100, 0, -100],
    ]);
    expect(result.totals.find((x) => x.metric === "po" && x.month === "2027-01")).toEqual({
      metric: "po",
      month: "2027-01",
      was: 600,
      now: 700,
      delta: 100,
    });
    expect(result.added.map((s) => s.name)).toEqual(["SKU NEW"]);
    expect(result.removed.map((s) => s.name)).toEqual(["SKU OLD"]);
  });

  it("knows when it is the 1:1 check of the final against what we sent", () => {
    expect(compareUploads(ours, final).reconcile).toBe(true);
    expect(compareUploads(ours, { ...final, kind: "HQ_DRAFT" }).reconcile).toBe(false);
    expect(compareUploads(ours, { ...final, cycle: "2026-12" }).reconcile).toBe(false);
    const same = compareUploads(ours, { ...ours, kind: "HQ_FINAL" });
    expect(same.changes).toEqual([]);
    expect(same.reconcile).toBe(true);
  });
});

describe("forecastAccuracy", () => {
  // October's upload forecast October and November; November's upload has October as closed.
  const october = {
    model: makeModel([
      sku("SKU A", { sellIn: [100, 100, 100, 100, 100], sellThru: [100, 100, 100, 100, 200] }),
      sku("SKU B", { sellIn: [0, 0, 0, 0, 50], sellThru: [0, 0, 0, 0, 0] }),
    ]),
    cycle: "2026-10",
    kind: "HQ_FINAL" as const,
  };
  const november = {
    model: makeModel([
      sku("SKU A", { sellIn: [100, 100, 100, 100, 110], sellThru: [100, 100, 100, 100, 150] }),
      sku("SKU B", { sellIn: [0, 0, 0, 0, 20], sellThru: [0, 0, 0, 0, 30] }),
      sku("SKU NEW", { sellIn: [0, 0, 0, 0, 0], sellThru: [0, 0, 0, 0, 0] }),
    ]),
    cycle: "2026-11",
    kind: "OURS" as const,
  };

  it("sets the older upload's forecast against the newer one's actuals", () => {
    const result = forecastAccuracy(october, november);
    expect(result.months).toEqual(["2026-10"]);
    expect(
      result.rows.map((r) => [r.name, r.metric, r.forecast, r.actual, r.percent, r.off]),
    ).toEqual([
      ["SKU A", "sellIn", 100, 110, 110, false],
      ["SKU B", "sellIn", 50, 20, 40, true],
      ["SKU A", "sellThru", 200, 150, 75, true],
      // Nothing was forecast and thirty were sold: no percent, but worth a look.
      ["SKU B", "sellThru", 0, 30, null, true],
    ]);
    expect(result.totals).toEqual([
      { month: "2026-10", metric: "sellIn", forecast: 150, actual: 130, percent: 86.7, off: false },
      { month: "2026-10", metric: "sellThru", forecast: 200, actual: 180, percent: 90, off: false },
    ]);
  });

  it("has nothing to say about two uploads of one cycle", () => {
    expect(forecastAccuracy(november, november).months).toEqual([]);
    expect(forecastAccuracy(november, october).months).toEqual([]);
  });
});
