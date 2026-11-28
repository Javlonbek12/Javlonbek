import { describe, expect, it } from "vitest";

import { CYCLE, makeModel, makeSku, MONTHS } from "@/tests/helpers/sop";

import { buildContext } from "./calc";
import { shipmentCaps } from "./caps";
import { exciseStamps, factoryMonths, orderHint, orderHints, roundOrder } from "./order";
import { DEFAULT_SOP_SETTINGS, type SopSettings } from "./settings";
import type { SopSku } from "./types";

const SETTINGS: SopSettings = {
  ...DEFAULT_SOP_SETTINGS,
  truckFactory: "AAA",
  containerFactory: "BBB",
};
const all = (value: number) => MONTHS.map(() => value);
const context = (skus: SopSku[], settings: Partial<SopSettings> = {}) =>
  buildContext(makeModel(skus), { ...SETTINGS, ...settings }, CYCLE);

describe("roundOrder", () => {
  it("rounds up to the minimum batch, then to fifty", () => {
    expect(roundOrder(0, 200)).toBe(0);
    expect(roundOrder(-30, 200)).toBe(0);
    expect(roundOrder(1, 200)).toBe(200);
    expect(roundOrder(200, 200)).toBe(200);
    expect(roundOrder(201, 200)).toBe(250);
    expect(roundOrder(350, 200)).toBe(350);
    expect(roundOrder(356.4, 200)).toBe(400);
  });
});

describe("orderHint", () => {
  // Sells 100 a month; at the end of January (the last frozen month) 100 at the entity and 100
  // at the distributor. The first month that can be changed is February (index 8).
  const base = {
    sellIn: all(100),
    sellThru: all(100),
    entityStock: [0, 0, 0, 0, 400],
    distStock: [0, 0, 0, 0, 100],
  };

  it("suggests the order that brings the total stock to the target, and carries it on", () => {
    const sku = makeSku("SKU A", base);
    const hint = orderHint(context([sku]), sku)!;
    expect(hint.steps.map((s) => s.month)).toEqual(["2027-02", "2027-03", "2027-04"]);
    // February: 200 at the start, nothing ordered, 100 sold → 100 left against 4 × 100.
    expect(hint.steps[0]).toMatchObject({
      opening: 200,
      filePo: 0,
      sales: 100,
      closing: 100,
      demand: 100,
      cover: 1,
      target: 400,
      gap: 300,
      suggested: 300,
      change: 300,
      action: "add",
      coverAfter: 4,
    });
    // March starts from February's hint: 400 − 100 = 300 → 100 short → a minimum batch.
    expect(hint.steps[1]).toMatchObject({
      opening: 400,
      closing: 300,
      suggested: 200,
      change: 200,
    });
    // April: 500 − 100 = 400 is the target: nothing to add.
    expect(hint.steps[2]).toMatchObject({ opening: 500, closing: 400, action: "keep", change: 0 });
    expect(hint.weight).toBe(300);
  });

  it("leaves an order alone when the stock is within a week of the target", () => {
    const sku = makeSku("SKU A", {
      ...base,
      // February ends with 380 of the 400 wanted.
      po: [0, 0, 0, 0, 0, 0, 0, 0, 280, 100, 100],
    });
    const hint = orderHint(context([sku]), sku)!;
    expect(hint.steps.map((s) => s.action)).toEqual(["keep", "keep", "keep"]);
    expect(hint.weight).toBe(0);
  });

  it("suggests reducing an order that leaves more than the maximum", () => {
    const sku = makeSku("SKU A", {
      ...base,
      po: [0, 0, 0, 0, 0, 0, 0, 0, 800, 0, 0],
    });
    const [first, second] = orderHint(context([sku]), sku)!.steps;
    // 200 + 800 − 100 = 900 is nine months: 500 too many → order 300.
    expect(first).toMatchObject({
      cover: 9,
      gap: -500,
      suggested: 300,
      change: -500,
      action: "reduce",
    });
    expect(second).toMatchObject({ opening: 400, action: "add", suggested: 200 });
    // Up to the maximum the file's order stays.
    const fine = makeSku("SKU A", { ...base, po: [0, 0, 0, 0, 0, 0, 0, 0, 350] });
    expect(orderHint(context([fine]), fine)!.steps[0]).toMatchObject({
      cover: 4.5,
      action: "keep",
    });
  });

  it("gives no hint for delisted and not-launched products or without sales", () => {
    const delisted = makeSku("SKU D", { ...base, status: "Delist" });
    const pending = makeSku("SKU N", { ...base, status: "New (not launched)" });
    const unsold = makeSku("SKU Z", { entityStock: all(50) });
    const ctx = context([delisted, pending, unsold]);
    expect([delisted, pending, unsold].map((sku) => orderHint(ctx, sku))).toEqual([
      null,
      null,
      null,
    ]);
    expect(orderHints(ctx)).toEqual([]);
  });

  it("keeps a new product's hint to the months it may be ordered in", () => {
    const fresh = makeSku("SKU N", { ...base, status: "New" });
    expect(orderHint(context([fresh]), fresh)!.steps.map((s) => s.month)).toEqual(["2027-02"]);
    expect(orderHint(context([fresh], { newPoHorizon: 2 }), fresh)).toBeNull();
  });

  it("waits with a slow seller until its stock is at the minimum (the saw-tooth)", () => {
    // Sells 30 a month: a minimum batch of 200 is more than six months of sales.
    const slow = makeSku("SKU S", {
      sellIn: all(30),
      sellThru: all(30),
      entityStock: [0, 0, 0, 0, 225],
    });
    const [february, march, april] = orderHint(context([slow]), slow)!.steps;
    // February ends with 3.5 months: short of four, but a batch would make it ten — wait.
    expect(february).toMatchObject({
      closing: 105,
      cover: 3.5,
      gap: 15,
      action: "keep",
      waits: true,
    });
    // March ends with 2.5 months, under the minimum of 2 + 1: now the batch is ordered.
    expect(march).toMatchObject({
      closing: 75,
      cover: 2.5,
      suggested: 200,
      action: "add",
      waits: false,
    });
    expect(april).toMatchObject({ opening: 275, action: "keep", waits: false });
  });

  it("sorts the hints by the size of the change", () => {
    const small = makeSku("SKU A", { ...base, po: [0, 0, 0, 0, 0, 0, 0, 0, 280, 100, 100] });
    const big = makeSku("SKU B", base);
    expect(orderHints(context([small, big])).map((h) => h.name)).toEqual(["SKU B", "SKU A"]);
  });
});

describe("factoryMonths", () => {
  const skus = [
    makeSku("SKU A", {
      po: [0, 0, 0, 0, 0, 1600, 0, 150, 2000],
      plan: [0, 0, 0, 0, 0, 1600, 0, 150, 1900],
    }),
    makeSku("SKU R", { type: "84 R", po: [0, 0, 0, 0, 0, 0, 0, 400] }),
    makeSku("SKU S", { factory: "BBB", type: "83 S", po: [0, 0, 0, 0, 0, 0, 800] }),
    makeSku("SKU X", { factory: "CCC", po: [0, 0, 0, 0, 0, 300] }),
  ];

  it("sums each factory by month and marks the frozen and the ordered month", () => {
    const [truck, container, other] = factoryMonths(context(skus));
    expect([truck!.factory, truck!.transport]).toEqual(["AAA", "truck"]);
    expect([container!.factory, container!.transport]).toEqual(["BBB", "container"]);
    expect([other!.factory, other!.transport]).toEqual(["CCC", null]);
    expect(truck!.months.map((m) => [m.month, m.frozen, m.ordering])).toEqual([
      ["2026-11", true, false],
      ["2026-12", true, false],
      ["2027-01", true, false],
      ["2027-02", false, true],
      ["2027-03", false, false],
      ["2027-04", false, false],
    ]);
    expect(truck!.months[0]).toMatchObject({ po: 1600, plan: 1600, out: 1600, moqBreaches: 0 });
    expect(truck!.months[0]!.load).toEqual({ count: 1, lastFill: 1, missing: 0, size: 1600 });
    // January: 150 + 400 of the line that runs every other month; 150 is under the minimum.
    expect(truck!.months[2]).toMatchObject({ po: 550, regularPo: 400, moqBreaches: 1 });
    // February: the plan (and the shipment) is not the order.
    expect(truck!.months[3]).toMatchObject({ po: 2000, plan: 1900, out: 1900 });
    expect(truck!.months[3]!.load).toMatchObject({ count: 2, missing: 1300 });
    expect(container!.months[1]!.load).toMatchObject({ count: 1, missing: 500, size: 1300 });
    expect(container!.months[0]!.load).toBeNull();
    // A factory without a transport size has no loads.
    expect(other!.months[0]!.load).toBeNull();
  });
});

describe("exciseStamps", () => {
  const skus = [
    makeSku("SKU A", { po: [0, 0, 0, 0, 0, 100, 200, 0, 300, 0, 500] }),
    makeSku("SKU S", { factory: "BBB", po: [0, 0, 0, 0, 0, 0, 40] }),
  ];

  it("counts the stamps of M+1…M+4 and when they must be at the factory", () => {
    const stamps = exciseStamps(context(skus), "2026-11-28");
    expect(
      stamps.map((s) => [s.month, s.deadline, s.status, s.daysLeft, s.cases, s.packs]),
    ).toEqual([
      ["2026-12", "2026-11-21", "overdue", -7, 240, 120000],
      ["2027-01", "2026-12-21", "ok", 23, 0, 0],
      ["2027-02", "2027-01-21", "ok", 54, 300, 150000],
      ["2027-03", "2027-02-21", "ok", 85, 0, 0],
    ]);
    expect(stamps[0]!.byFactory).toEqual([
      { factory: "AAA", cases: 200, packs: 100000 },
      { factory: "BBB", cases: 40, packs: 20000 },
    ]);
  });

  it("warns ten days before the deadline and follows the packs-per-case setting", () => {
    expect(exciseStamps(context(skus), "2026-11-11")[0]).toMatchObject({
      status: "soon",
      daysLeft: 10,
    });
    expect(exciseStamps(context(skus), "2026-11-10")[0]!.status).toBe("ok");
    expect(exciseStamps(context(skus), "2026-11-21")[0]).toMatchObject({
      status: "soon",
      daysLeft: 0,
    });
    expect(exciseStamps(context(skus, { packsPerCase: 250 }), "2026-11-01")[0]!.packs).toBe(60000);
  });
});

describe("shipmentCaps", () => {
  const sums = "nnssnnnnnnn";
  // Sell-in of August and September typed as «=distributor+KA»; October as one number.
  const split = makeSku("SKU A", {
    sellIn: [0, 0, 500, 400, 450, 600, 300],
    formulas: { sellIn: sums },
    parts: { "sellIn:2": [440, 60], "sellIn:3": [300, 100] },
    entityStock: [0, 0, 0, 0, 200],
    po: [0, 0, 0, 0, 0, 500],
  });
  const plain = makeSku("SKU B", {
    sellIn: [0, 0, 0, 0, 0, 200, 0],
    entityStock: [0, 0, 0, 0, 900],
  });
  const idle = makeSku("SKU C");

  it("takes the key accounts' part from the closed months typed as a sum", () => {
    const rows = shipmentCaps(context([split, plain, idle]));
    // Only the rows with Sell-in planned in M or M+1.
    expect(rows.map((r) => [r.name, r.source, r.kaAverage])).toEqual([
      ["SKU A", "file", 80],
      ["SKU B", "none", null],
    ]);
    expect(rows[0]!.months).toEqual([
      // November: 200 + 500 − 600 = 100 left, 1.25 months of the key accounts' 80.
      {
        month: "2026-11",
        sellIn: 600,
        ka: 80,
        cap: 520,
        entityStock: 100,
        kaMonths: 1.25,
        warn: true,
      },
      {
        month: "2026-12",
        sellIn: 300,
        ka: 80,
        cap: 220,
        entityStock: -200,
        kaMonths: -2.5,
        warn: true,
      },
    ]);
    expect(rows[1]!.months[0]).toMatchObject({ ka: null, cap: null, kaMonths: null, warn: false });
  });

  it("falls back to the share of the settings, and never caps below zero", () => {
    const rows = shipmentCaps(context([plain, split], { kaShare: 10 }));
    expect(rows[0]).toMatchObject({ name: "SKU B", source: "share" });
    expect(rows[0]!.months[0]).toMatchObject({
      sellIn: 200,
      ka: 20,
      cap: 180,
      kaMonths: 35,
      warn: false,
    });
    // The file's own split wins over the share.
    expect(rows[1]!.source).toBe("file");
    // A month planned under the key accounts' usual sales: everything is theirs.
    const little = makeSku("SKU L", {
      sellIn: [0, 0, 500, 400, 0, 50],
      formulas: { sellIn: sums },
      parts: { "sellIn:2": [440, 60], "sellIn:3": [300, 100] },
    });
    expect(shipmentCaps(context([little]))[0]!.months[0]).toMatchObject({ ka: 50, cap: 0 });
  });
});
