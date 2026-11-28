import { describe, expect, it } from "vitest";

import { CYCLE, makeModel, makeSku, MONTHS } from "@/tests/helpers/sop";

import {
  buildContext,
  coverFlags,
  coverOf,
  demandAt,
  launchIndex,
  ownStocks,
  planRateOf,
  runRateOf,
  skuStats,
  SopCycleError,
  totalsByMonth,
} from "./calc";
import { DEFAULT_SOP_SETTINGS } from "./settings";
import type { SopSku } from "./types";

const all = (value: number) => MONTHS.map(() => value);
const context = (skus: SopSku[], settings = DEFAULT_SOP_SETTINGS) =>
  buildContext(makeModel(skus), settings, CYCLE);

describe("buildContext", () => {
  it("places the cycle among the sheet's months", () => {
    const ctx = context([makeSku("SKU A")]);
    expect(ctx).toMatchObject({
      cycle: "2026-11",
      m: 5,
      m1: 4,
      horizon: [5, 6, 7, 8, 9, 10],
      frozen: [5, 6, 7],
      ordering: 8,
      closed: [2, 3, 4],
    });
  });

  it("follows the settings and the edges of the file", () => {
    const model = makeModel([makeSku("SKU A")]);
    const late = buildContext(model, { ...DEFAULT_SOP_SETTINGS, leadTime: 4 }, "2027-03");
    expect(late.horizon).toEqual([9, 10]);
    expect(late.frozen).toEqual([9, 10]);
    // M + 4 is beyond the file: nothing is «ordered now».
    expect(late.ordering).toBeNull();
    const first = buildContext(model, DEFAULT_SOP_SETTINGS, "2026-07");
    expect(first.closed).toEqual([0]);
    expect(() => buildContext(model, DEFAULT_SOP_SETTINGS, "2030-01")).toThrow(SopCycleError);
  });
});

describe("own stocks and cover", () => {
  // The file's forecast stocks are wrong on purpose: the engine counts its own.
  const sku = makeSku("SKU A", {
    po: [0, 0, 0, 0, 0, 300, 0, 0, 300],
    sellIn: [0, 0, 0, 0, 0, 100, 120, 80, 100, 100, 100],
    sellThru: [0, 0, 90, 100, 110, 100, 100, 100, 50, 60, 0],
    entityStock: [0, 0, 0, 0, 200, 1, 2, 3, 4, 5, 6],
    distStock: [0, 0, 0, 0, 150, 9, 9, 9, 9, 9, 9],
  });

  it("counts the plan's stocks by the balance, from the closed month's stock", () => {
    const own = ownStocks(context([sku]), sku);
    expect(own.entity.slice(4)).toEqual([200, 400, 280, 200, 400, 300, 200]);
    expect(own.dist.slice(4)).toEqual([150, 150, 170, 150, 200, 240, 340]);
    // The closed months stay as the file has them.
    expect(own.entity.slice(0, 4)).toEqual([0, 0, 0, 0]);
  });

  it("measures a stock against the average sales of the month and the next two", () => {
    expect(demandAt(sku, 5)).toBe(100);
    expect(demandAt(sku, 7)).toBe(70);
    // At the end of the file: the months that exist.
    expect(demandAt(sku, 9)).toBe(30);
    expect(demandAt(sku, 10)).toBe(0);
    expect(coverOf(280, 70)).toBe(4);
    expect(coverOf(280, 0)).toBeNull();
  });

  it("compares covers as they are shown, to one decimal", () => {
    const norms = { entityMin: 2, distMin: 1, maxTotal: 5 };
    expect(coverFlags({ entity: 1.96, dist: 0.96, total: 5.04 }, norms)).toEqual({
      entityLow: false,
      distLow: false,
      high: false,
    });
    expect(coverFlags({ entity: 1.94, dist: 0.94, total: 5.06 }, norms)).toEqual({
      entityLow: true,
      distLow: true,
      high: true,
    });
    expect(coverFlags({ entity: null, dist: null, total: null }, norms).entityLow).toBe(true);
  });

  it("takes the actual run-rate from the last closed months, from the first sale on", () => {
    const ctx = context([sku]);
    expect(runRateOf(ctx, sku)).toBe(100);
    expect(planRateOf(ctx, sku)).toBe(100);
    // Launched in October: one month of sales is not averaged with two empty ones.
    const fresh = makeSku("SKU N", { sellThru: [0, 0, 0, 0, 60, 60, 60, 60] });
    expect(runRateOf(context([fresh]), fresh)).toBe(60);
    const unsold = makeSku("SKU Z");
    expect(runRateOf(context([unsold]), unsold)).toBe(0);
    expect(launchIndex(fresh, ownStocks(context([fresh]), fresh))).toBe(4);
    expect(launchIndex(unsold, ownStocks(context([unsold]), unsold))).toBe(MONTHS.length);
  });

  it("sums the sheet by month, with its own stocks in the plan", () => {
    const totals = totalsByMonth(
      context([sku, makeSku("SKU B", { entityStock: [0, 0, 0, 0, 10] })]),
    );
    expect(totals[4]).toMatchObject({ month: "2026-10", forecast: false, entityStock: 210 });
    expect(totals[5]).toMatchObject({
      month: "2026-11",
      forecast: true,
      po: 300,
      out: 300,
      sellIn: 100,
      entityStock: 410,
      distStock: 150,
    });
  });
});

describe("skuStats", () => {
  const steady = makeSku("SKU A", {
    po: [0, 200, 0, 200, 0, 200, 0, 200, 0, 200, 0],
    sellIn: all(100),
    sellThru: all(100),
    entityStock: [200, 300, 200, 300, 200],
    distStock: [150, 150, 150, 150, 150],
  });

  it("gives the stock now, the covers of the plan and no risk for a healthy row", () => {
    const stats = skuStats(context([steady]), steady);
    expect(stats).toMatchObject({
      key: "AAA|SKU A",
      stock: { factory: 0, entity: 200, dist: 150 },
      riskMonth: null,
      riskWhat: null,
      runRate: 100,
      planRate: 100,
      deviation: 0,
      slow: false,
      short: false,
      excess: false,
      delist: false,
      isNew: false,
    });
    expect(stats.covers.map((c) => [c.month, c.entity, c.dist, c.total])).toEqual([
      ["2026-11", 3, 1.5, 4.5],
      ["2026-12", 2, 1.5, 3.5],
      ["2027-01", 3, 1.5, 4.5],
      ["2027-02", 2, 1.5, 3.5],
      ["2027-03", 3, 1.5, 4.5],
      ["2027-04", 2, 1.5, 3.5],
    ]);
    // Nothing produced after April: 200 − 100 − 100 lasts two more months, the third runs out.
    expect(stats.runOut).toEqual({ month: "2027-07", beyond: true });
  });

  it("names the first month a stock is under its minimum, and which one", () => {
    const thinEntity = makeSku("SKU A", { ...steadyInput(), entityStock: [0, 0, 0, 0, 100] });
    expect(skuStats(context([thinEntity]), thinEntity)).toMatchObject({
      riskMonth: "2026-12",
      riskWhat: "entity",
      short: true,
    });
    const thinBoth = makeSku("SKU A", {
      ...steadyInput(),
      entityStock: [0, 0, 0, 0, 0],
      distStock: [0, 0, 0, 0, 50],
      po: [],
    });
    const stats = skuStats(context([thinBoth]), thinBoth);
    expect(stats.riskWhat).toBe("both");
    // The entity goes below zero in the first month of the plan: that is when it runs out.
    expect(stats.runOut).toEqual({ month: "2026-11", beyond: false });
  });

  it("flags excess, slow stock, new and delisted rows", () => {
    const heavy = makeSku("SKU A", { ...steadyInput(), distStock: [0, 0, 0, 0, 900] });
    expect(skuStats(context([heavy]), heavy)).toMatchObject({
      excess: true,
      slow: true,
      slowCover: 11,
    });
    const leaving = makeSku("SKU D", {
      status: "Considering Delist",
      sellThru: all(10),
      entityStock: all(5),
    });
    expect(skuStats(context([leaving]), leaving)).toMatchObject({ leaving: true, delist: false });
    const gone = makeSku("SKU D", { status: "Delist", sellThru: all(100) });
    // A delisted product is not held to the norms and its stock is not projected.
    expect(skuStats(context([gone]), gone)).toMatchObject({
      delist: true,
      leaving: true,
      riskMonth: null,
      runOut: null,
    });
    const pending = makeSku("SKU N", { status: "New (not launched)" });
    expect(skuStats(context([pending]), pending)).toMatchObject({
      isNew: true,
      notLaunched: true,
      runOut: null,
      slow: false,
    });
  });

  function steadyInput() {
    return {
      po: [0, 200, 0, 200, 0, 200, 0, 200, 0, 200, 0],
      sellIn: all(100),
      sellThru: all(100),
      entityStock: [200, 300, 200, 300, 200],
      distStock: [150, 150, 150, 150, 150],
    };
  }
});
