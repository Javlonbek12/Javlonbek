import { describe, expect, it } from "vitest";

import {
  CYCLE,
  makeMaterial,
  makeModel,
  makeSku,
  MONTHS,
  type SkuInput,
} from "@/tests/helpers/sop";

import { buildContext } from "./calc";
import { findIssues, loadOf, RULE_IDS, type Finding, type RuleId } from "./findings";
import { DEFAULT_SOP_SETTINGS, type SopSettings } from "./settings";
import type { SopKind, SopModel, SopSku } from "./types";

// The cycle is 2026-11 (index 5): 5–7 are frozen, 8 (2027-02) is ordered now, the plan ends at
// index 10 (2027-04). Factory AAA ships by truck, BBB by container.
const SETTINGS: SopSettings = {
  ...DEFAULT_SOP_SETTINGS,
  truckFactory: "AAA",
  containerFactory: "BBB",
  market: "TST",
};
const all = (value: number) => MONTHS.map(() => value);

// A row with nothing to say about it: sells 100 a month, is ordered 200 every other month, the
// entity holds two to three months and the distributor a month and a half.
const CLEAN: SkuInput = {
  po: [0, 200, 0, 200, 0, 200, 0, 200, 0, 200, 0],
  sellIn: all(100),
  sellThru: all(100),
  entityStock: [200, 300, 200, 300, 200],
  distStock: [150, 150, 150, 150, 150],
};
const clean = (name = "SKU A", change: SkuInput = {}) => makeSku(name, { ...CLEAN, ...change });

const run = (
  skus: SopSku[],
  options: {
    kind?: SopKind;
    settings?: Partial<SopSettings>;
    baseline?: SopModel;
    model?: Parameters<typeof makeModel>[1];
  } = {},
) =>
  findIssues(
    buildContext(
      makeModel(skus, options.model),
      { ...SETTINGS, ...options.settings },
      CYCLE,
      options.kind ?? "HQ_DRAFT",
    ),
    options.baseline ? { model: options.baseline, cycle: "2026-10" } : null,
  );
const of = (findings: Finding[], rule: RuleId) => findings.filter((f) => f.rule === rule);
const rules = (findings: Finding[]) => [...new Set(findings.map((f) => f.rule))].sort();

describe("findIssues", () => {
  it("finds nothing in a sheet that follows the rules", () => {
    expect(run([clean(), clean("SKU B")])).toEqual([]);
  });

  it("gives every finding a stable key: the rule, the SKU and its months", () => {
    const [finding] = run([clean("SKU A", { po: [0, 200, 0, 200, 0, 150, 0, 200, 0, 120, 0] })]);
    expect(finding).toMatchObject({
      key: "moq|AAA|SKU A|2026-11,2027-03",
      rule: "moq",
      severity: "error",
      sku: { key: "AAA|SKU A", name: "SKU A", factory: "AAA" },
      months: ["2026-11", "2027-03"],
      params: { moq: 200 },
      rows: [
        { month: "2026-11", po: 150 },
        { month: "2027-03", po: 120 },
      ],
    });
  });

  it("puts errors before risks and notes", () => {
    const findings = run([
      clean("SKU A", { code: "", po: [0, 200, 0, 200, 0, 150] }),
      clean("SKU B", { sellThru: [100, 100, 100, 100, 100, 250, 250, 250, 100, 100, 100] }),
    ]);
    const order = findings.map((f) => f.severity);
    expect(order).toEqual([...order].sort((a, b) => "ern".indexOf(a[0]!) - "ern".indexOf(b[0]!)));
    expect(order[0]).toBe("error");
    expect(order.at(-1)).toBe("note");
  });

  it("knows every rule it can raise", () => {
    expect(RULE_IDS).toHaveLength(32);
  });

  // --- Orders that cost money ---------------------------------------------------------------

  it("poDelist: an order on a product being delisted", () => {
    const delisted = run([clean("SKU A", { status: "Delist" })]);
    expect(of(delisted, "poDelist")).toHaveLength(1);
    expect(of(delisted, "poDelist")[0]!.rows).toEqual([
      { month: "2026-11", po: 200 },
      { month: "2027-01", po: 200 },
      { month: "2027-03", po: 200 },
    ]);
    // Orders of closed months do not count, and «Considering Delist» is not delisted yet.
    expect(
      of(run([clean("SKU A", { status: "Delist", po: [0, 200, 0, 200] })]), "poDelist"),
    ).toEqual([]);
    expect(of(run([clean("SKU A", { status: "Considering Delist" })]), "poDelist")).toEqual([]);
  });

  it("poOldRow: an order in the old row of a product that has an [RE] row", () => {
    const findings = run([clean("SKU A"), clean("[RE] SKU A")]);
    expect(of(findings, "poOldRow").map((f) => [f.sku?.name, f.params.twin])).toEqual([
      ["SKU A", "[RE] SKU A"],
    ]);
    expect(of(run([clean("SKU A"), clean("[RE] SKU B")]), "poOldRow")).toEqual([]);
    // The old row without an order is as it should be.
    expect(
      of(run([clean("SKU A", { po: [0, 200, 0, 200] }), clean("[re]  sku a")]), "poOldRow"),
    ).toEqual([]);
  });

  it("newBeyond: a new product ordered later than M+3", () => {
    const fresh = (po: number[]) => clean("SKU N", { status: "New", po });
    const late = run([fresh([0, 0, 0, 0, 0, 200, 0, 200, 200, 300, 0])]);
    expect(of(late, "newBeyond")[0]).toMatchObject({
      months: ["2027-03"],
      params: { limit: "2027-02" },
      rows: [{ month: "2027-03", po: 300 }],
    });
    expect(of(run([fresh([0, 0, 0, 0, 0, 200, 0, 200, 200, 0, 0])]), "newBeyond")).toEqual([]);
    // The horizon of new products is a setting.
    expect(
      of(
        run([fresh([0, 0, 0, 0, 0, 200, 0, 200, 200, 300, 0])], { settings: { newPoHorizon: 4 } }),
        "newBeyond",
      ),
    ).toEqual([]);
    // A regular product may be ordered to the end of the plan.
    expect(of(run([clean("SKU A", { po: all(200) })]), "newBeyond")).toEqual([]);
  });

  it("moq: an order under the minimum batch", () => {
    expect(of(run([clean("SKU A", { po: [0, 0, 0, 0, 0, 199] })]), "moq")).toHaveLength(1);
    expect(of(run([clean("SKU A", { po: [0, 0, 0, 0, 0, 200] })]), "moq")).toEqual([]);
    expect(
      of(run([clean("SKU A", { po: [0, 0, 0, 0, 0, 199] })], { settings: { moq: 150 } }), "moq"),
    ).toEqual([]);
  });

  it("noCode: an order in a row without a product code", () => {
    expect(of(run([clean("SKU A", { code: "" })]), "noCode")).toHaveLength(1);
    expect(of(run([clean("SKU A", { code: "", po: [] })]), "noCode")).toEqual([]);
  });

  // --- Stocks ---------------------------------------------------------------------------------

  it("negativeEntity / negativeDist: a stock below zero in the plan, counted by the engine", () => {
    const entity = run([
      clean("SKU A", { sellIn: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 700] }),
    ]);
    expect(of(entity, "negativeEntity")[0]!.rows).toEqual([{ month: "2027-04", stock: -400 }]);
    const dist = run([
      clean("SKU A", { sellThru: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 500] }),
    ]);
    expect(of(dist, "negativeDist")[0]!.rows).toEqual([{ month: "2027-04", stock: -250 }]);
    expect(rules(run([clean()]))).not.toContain("negativeEntity");
  });

  it("stockBalance: a typed stock of a forecast month that does not match the balance", () => {
    // December: 300 + 0 − 100 = 200, but 260 is typed.
    const typed = clean("SKU A", {
      entityStock: [200, 300, 200, 300, 200, 300, 260, 360, 260, 360, 260],
      formulas: { entityStock: "nnnnnonoooo" },
    });
    const findings = run([typed]);
    expect(of(findings, "stockBalance")[0]!.rows).toEqual([
      { month: "2026-12", metric: "entityStock", value: 260, expected: 200 },
    ]);
    expect(of(findings, "typedFormula")).toEqual([]);
    // Within a case of the balance it is only «a number instead of a formula».
    const close = run([
      clean("SKU A", {
        entityStock: [200, 300, 200, 300, 200, 300, 200.6],
        formulas: { entityStock: "nnnnnonoooo" },
      }),
    ]);
    expect(of(close, "stockBalance")).toEqual([]);
    expect(of(close, "typedFormula")[0]!.rows).toEqual([
      { month: "2026-12", metric: "entityStock" },
    ]);
  });

  it("typedFormula: a number where the plan or the factory stock must be a lookup", () => {
    const findings = run([
      clean("SKU A", { formulas: { plan: "llllllnllll", factoryStock: "lllllllllln" } }),
      clean("SKU B"),
    ]);
    expect(of(findings, "typedFormula")).toHaveLength(1);
    expect(of(findings, "typedFormula")[0]!.rows).toEqual([
      { month: "2026-12", metric: "plan", value: 0 },
      { month: "2027-04", metric: "factoryStock", value: 0 },
    ]);
    // Typed plans of closed months are history, not a mistake.
    expect(
      of(run([clean("SKU A", { formulas: { plan: "nnnnnllllll" } })]), "typedFormula"),
    ).toEqual([]);
  });

  it("noFormula: an empty stock cell in a month the row has movements in", () => {
    const empty = clean("SKU A", {
      formulas: { entityStock: "nnnnnoo----", distStock: "nnnnnoooooo" },
    });
    const findings = run([empty]);
    expect(of(findings, "noFormula")[0]!.rows.map((r) => [r.month, r.metric, r.value])).toEqual([
      ["2027-01", "entityStock", 300],
      ["2027-02", "entityStock", 200],
      ["2027-03", "entityStock", 300],
      ["2027-04", "entityStock", 200],
    ]);
    // An empty cell of a row with nothing in it is just an empty row.
    expect(
      of(run([makeSku("SKU Z", { formulas: { entityStock: "nnnnn------" } })]), "noFormula"),
    ).toEqual([]);
  });

  it("balanceFormula: a formula whose result is not the balance (a note)", () => {
    const findings = run([
      clean("SKU A", { distStock: [150, 150, 150, 150, 150, 150, 150, 190, 150, 150, 150] }),
    ]);
    expect(of(findings, "balanceFormula")[0]).toMatchObject({
      severity: "note",
      rows: [
        { month: "2027-01", metric: "distStock", value: 190, expected: 150 },
        { month: "2027-02", metric: "distStock", value: 150, expected: 190 },
      ],
    });
    expect(of(findings, "stockBalance")).toEqual([]);
  });

  it("flattened: a column pasted as values is said once, not on every SKU", () => {
    const flat = (name: string) =>
      clean(name, { formulas: { entityStock: "nnnnnnnnnnn", plan: "nnnnnnnnnnn" } });
    const findings = run([flat("SKU A"), flat("SKU B")]);
    expect(of(findings, "flattened").map((f) => [f.key, f.params.count])).toEqual([
      ["flattened|entityStock|", 12],
      ["flattened|plan|", 12],
    ]);
    expect(of(findings, "typedFormula")).toEqual([]);
    // A typed stock that is wrong is still an error in a flattened file.
    const wrong = run([
      flat("SKU A"),
      clean("SKU B", {
        entityStock: [200, 300, 200, 300, 200, 999],
        formulas: { entityStock: "nnnnnnnnnnn" },
      }),
    ]);
    expect(of(wrong, "stockBalance")).toHaveLength(1);
  });

  // --- The order against the factory's plan --------------------------------------------------

  it("poVsPlanFrozen / poVsPlanLater: the plan differs from the order", () => {
    const findings = run([
      clean("SKU A", {
        plan: [0, 200, 0, 200, 0, 200, 50, 200, 0, 250, 0],
        out: CLEAN.po,
      }),
    ]);
    expect(of(findings, "poVsPlanFrozen")[0]).toMatchObject({
      severity: "error",
      rows: [{ month: "2026-12", po: 0, plan: 50 }],
    });
    expect(of(findings, "poVsPlanLater")[0]).toMatchObject({
      severity: "note",
      rows: [{ month: "2027-03", po: 200, plan: 250 }],
    });
    expect(rules(run([clean()]))).toEqual([]);
  });

  it("newNoPlan: an order on a product not launched yet whose plan HQ left empty", () => {
    const pending = makeSku("SKU N", {
      status: "New (not launched)",
      po: [0, 0, 0, 0, 0, 0, 300],
      plan: all(0),
      out: all(0),
    });
    const findings = run([pending]);
    expect(of(findings, "newNoPlan")[0]!.rows).toEqual([{ month: "2026-12", po: 300 }]);
    // Said once: not also as «PO is not the plan».
    expect(of(findings, "poVsPlanFrozen")).toEqual([]);
    const planned = makeSku("SKU N", { status: "New (not launched)", po: [0, 0, 0, 0, 0, 0, 300] });
    expect(of(run([planned]), "newNoPlan")).toEqual([]);
  });

  it("frozenChanged: the order of a frozen month differs from the upload before", () => {
    const before = makeModel([clean("SKU A"), clean("SKU B")]);
    const now = [
      clean("SKU A", { po: [0, 200, 0, 200, 0, 200, 0, 400, 0, 600, 0] }),
      clean("SKU B"),
      clean("SKU NEW", { po: [0, 0, 0, 0, 0, 300] }),
    ];
    const findings = run(now, { baseline: before });
    // January (frozen) changed; March is not frozen; a row that was not there is not «changed».
    expect(of(findings, "frozenChanged").map((f) => [f.sku?.name, f.rows])).toEqual([
      ["SKU A", [{ month: "2027-01", was: 200, now: 400 }]],
    ]);
    expect(of(run(now), "frozenChanged")).toEqual([]);
  });

  // --- Stock norms ---------------------------------------------------------------------------

  it("entityLow / distLow: months of sales in stock under the minimum", () => {
    const thin = clean("SKU A", {
      entityStock: [200, 300, 200, 300, 100],
      distStock: [150, 150, 150, 150, 60],
    });
    const findings = run([thin]);
    // The entity: 200, 100, 200, 100, 200, 100 against 100 a month.
    expect(of(findings, "entityLow")[0]).toMatchObject({
      severity: "risk",
      params: { min: 2, first: "2026-12", count: 3 },
      rows: [
        { month: "2026-12", cover: 1, stock: 100 },
        { month: "2027-02", cover: 1, stock: 100 },
        { month: "2027-04", cover: 1, stock: 100 },
      ],
    });
    expect(of(findings, "distLow")[0]!.params).toMatchObject({
      min: 1,
      first: "2026-11",
      count: 6,
    });
    // The norms are settings.
    expect(rules(run([thin], { settings: { entityMin: 1, distMin: 0.5 } }))).toEqual([]);
  });

  it("does not hold a delisted product, a tiny seller or the months before a launch to the norms", () => {
    const thin = { entityStock: [200, 300, 200, 300, 100], distStock: [0, 0, 0, 0, 0] };
    expect(rules(run([clean("SKU A", { ...thin, status: "Delist", po: [] })]))).not.toContain(
      "entityLow",
    );
    const tiny = makeSku("SKU T", {
      sellIn: all(4),
      sellThru: all(4),
      entityStock: [30, 30, 30, 30, 30],
    });
    expect(run([tiny]).map((f) => f.rule)).toEqual([]);
    // Launch in January: before it a zero stock is not a shortage.
    const launch = makeSku("SKU N", {
      status: "New (not launched)",
      po: [0, 0, 0, 0, 0, 0, 600],
      sellIn: [0, 0, 0, 0, 0, 0, 0, 200, 100, 100, 100],
      sellThru: [0, 0, 0, 0, 0, 0, 0, 80, 80, 80, 80],
    });
    const low = of(run([launch]), "entityLow");
    expect(low.flatMap((f) => f.months).every((month) => month >= "2026-12")).toBe(true);
  });

  it("totalHigh: more than the maximum at the factory, the entity and the distributor together", () => {
    const heavy = clean("SKU A", { entityStock: [200, 300, 200, 300, 500] });
    const findings = run([heavy]);
    // 600 + 150 = 750 against 100 a month in November.
    expect(of(findings, "totalHigh")[0]).toMatchObject({
      params: { max: 5, peak: 7.5 },
      rows: expect.arrayContaining([{ month: "2026-11", cover: 7.5, stock: 750 }]),
    });
    expect(of(run([heavy], { settings: { maxTotal: 8 } }), "totalHigh")).toEqual([]);
    expect(of(run([clean("SKU A", { ...heavy, status: "Delist" })]), "totalHigh")).toEqual([]);
  });

  it("compares a cover the way it is shown: 1.96 months is not «under two»", () => {
    const edge = clean("SKU A", { entityStock: [200, 300, 200, 300, 196], po: [], out: [] });
    // November: 196 − 100 = 96 → 0.96 → «1,0»… against a minimum of 1 it is not low.
    const findings = run([edge], { settings: { entityMin: 1 } });
    expect(of(findings, "entityLow")[0]!.months).not.toContain("2026-11");
  });

  // --- Sales ---------------------------------------------------------------------------------

  it("slowStock: stock that lasts longer than the limit at the actual sales", () => {
    const slow = clean("SKU A", { distStock: [150, 150, 150, 150, 700] });
    const [finding] = of(run([slow]), "slowStock");
    expect(finding).toMatchObject({ params: { stock: 900, rate: 100, cover: 9, limit: 8 } });
    expect(of(run([slow], { settings: { slowMonths: 9 } }), "slowStock")).toEqual([]);
    // Stock with no sales at all is slow — unless the product is new.
    const dead = makeSku("SKU D", { entityStock: [80, 80, 80, 80, 80] });
    expect(of(run([dead]), "slowStock")[0]!.params.cover).toBe(999);
    expect(
      of(run([makeSku("SKU D", { entityStock: all(80), status: "New" })]), "slowStock"),
    ).toEqual([]);
    // Under fifty cases it is not worth a word.
    expect(of(run([makeSku("SKU D", { entityStock: [40, 40, 40, 40, 40] })]), "slowStock")).toEqual(
      [],
    );
  });

  it("runRate: the planned sales are far from the last three closed months", () => {
    const optimistic = clean("SKU A", {
      sellThru: [100, 100, 100, 100, 100, 150, 150, 150, 100, 100, 100],
    });
    expect(of(run([optimistic]), "runRate")[0]!.params).toMatchObject({
      actual: 100,
      plan: 150,
      percent: 50,
      limit: 30,
    });
    expect(of(run([optimistic], { settings: { runRateDeviation: 60 } }), "runRate")).toEqual([]);
    // A product that sells under thirty cases a month is not judged.
    const small = makeSku("SKU S", { sellThru: [20, 20, 20, 20, 20, 60, 60, 60, 20, 20, 20] });
    expect(of(run([small]), "runRate")).toEqual([]);
  });

  // --- New products --------------------------------------------------------------------------

  it("launchTiming: a first sale in the month of the first production", () => {
    const sameMonth = makeSku("SKU N", {
      status: "New (not launched)",
      po: [0, 0, 0, 0, 0, 0, 300],
      sellIn: [0, 0, 0, 0, 0, 0, 200, 50, 50, 50, 50],
    });
    expect(of(run([sameMonth]), "launchTiming")[0]).toMatchObject({
      params: { poMonth: "2026-12", saleMonth: "2026-12" },
      rows: [{ month: "2026-12", po: 300, sellIn: 200 }],
    });
    const monthLater = makeSku("SKU N", {
      status: "New (not launched)",
      po: [0, 0, 0, 0, 0, 0, 300],
      sellIn: [0, 0, 0, 0, 0, 0, 0, 200],
    });
    expect(of(run([monthLater]), "launchTiming")).toEqual([]);
    // Already produced and waiting in the warehouse: the first sale does not depend on the order.
    const inStock = makeSku("SKU N", {
      status: "New (not launched)",
      po: [0, 0, 0, 0, 0, 0, 300],
      sellIn: [0, 0, 0, 0, 0, 0, 200],
      entityStock: [0, 0, 0, 0, 250],
    });
    expect(of(run([inStock]), "launchTiming")).toEqual([]);
  });

  // --- Closing M-1 ---------------------------------------------------------------------------

  it("m1 typed: in our own version the closed month must be entered as sums", () => {
    const typed = run([clean("SKU A"), clean("SKU B")], { kind: "OURS" });
    expect(
      ["m1EntityTyped", "m1SellInTyped", "m1SellThruTyped"].map((rule) => {
        const [finding] = of(typed, rule as RuleId);
        return [finding?.key, finding?.skus.map((s) => s.name), finding?.params.count];
      }),
    ).toEqual([
      ["m1EntityTyped|all|2026-10", ["SKU A", "SKU B"], 2],
      ["m1SellInTyped|all|2026-10", ["SKU A", "SKU B"], 2],
      ["m1SellThruTyped|all|2026-10", ["SKU A", "SKU B"], 2],
    ]);
    const sums = { entityStock: "nnnnsoooooo", sellIn: "nnnnsnnnnnn", sellThru: "nnnnsnnnnnn" };
    const entered = run([clean("SKU A", { formulas: sums }), clean("SKU B")], { kind: "OURS" });
    expect(of(entered, "m1SellInTyped")[0]!.skus.map((s) => s.name)).toEqual(["SKU B"]);
    expect(rules(run([clean("SKU A", { formulas: sums })], { kind: "OURS" }))).toEqual([]);
    // HQ's copies come flattened: not checked there.
    expect(rules(run([clean()], { kind: "HQ_FINAL" }))).toEqual([]);
  });

  it("m1Outbound: the closed month's shipment against the factory's stock", () => {
    // October: 0 left before + 200 produced − 30 left = 170 shipped, but 200 is entered.
    const off = clean("SKU A", {
      po: [0, 200, 0, 200, 200],
      factoryStock: [0, 0, 0, 0, 30],
    });
    expect(of(run([off]), "m1Outbound")[0]).toMatchObject({
      severity: "error",
      params: { out: 200, expected: 170, produced: 200, left: 30 },
    });
    const right = clean("SKU A", {
      po: [0, 200, 0, 200, 200],
      out: [0, 200, 0, 200, 170],
      factoryStock: [0, 0, 0, 0, 30],
      // (November ships what the factory kept.)
      entityStock: [200, 300, 200, 300, 200],
    });
    expect(of(run([right]), "m1Outbound")).toEqual([]);
  });

  // --- The sheet's own totals ----------------------------------------------------------------

  it("subtotal: a row of totals that is not the sum of its factory's SKUs", () => {
    const skus = [clean("SKU A"), clean("SKU B", { factory: "BBB" })];
    const true200 = MONTHS.map((_, i) => (CLEAN.po![i] ?? 0) as number);
    const findings = run(skus, {
      model: {
        subtotals: [
          { row: 2, label: "AAA", values: { po: true200 } },
          { row: 3, label: "BBB", values: { po: MONTHS.map(() => 0) } },
          { row: 4, label: "CCC", values: { po: MONTHS.map((_, i) => (i === 5 ? 600 : 0)) } },
          { row: 5, label: "Total", values: { po: true200.map((v) => v * 2) } },
        ],
      },
    });
    expect(
      of(findings, "subtotal").map((f) => [f.key.split("|")[1], f.params.known, f.params.count]),
    ).toEqual([
      ["BBB", 1, 3],
      ["CCC", 0, 1],
    ]);
    expect(of(findings, "subtotal")[0]!.rows[0]).toEqual({
      month: "2026-11",
      metric: "po",
      shown: 0,
      real: 200,
      diff: -200,
    });
  });

  // --- Lines and transport -------------------------------------------------------------------

  it("regularRun: the line that runs every other month ordered two months in a row", () => {
    const regular = (name: string, po: number[]) => clean(name, { type: "84 R", po });
    const findings = run([
      regular("SKU R1", [0, 0, 0, 0, 0, 0, 400, 0, 600, 0, 0]),
      regular("SKU R2", [0, 0, 0, 0, 0, 0, 0, 0, 0, 300, 0]),
      clean("SKU A"),
    ]);
    expect(of(findings, "regularRun")).toHaveLength(1);
    expect(of(findings, "regularRun")[0]).toMatchObject({
      key: "regularRun|84 R|2027-02,2027-03",
      params: { type: "84 R" },
      rows: [
        { month: "2027-02", po: 600 },
        { month: "2027-03", po: 300 },
      ],
    });
    expect(of(findings, "regularRun")[0]!.skus.map((s) => s.name)).toEqual(["SKU R1", "SKU R2"]);
    expect(of(run([regular("SKU R1", [0, 0, 0, 0, 0, 0, 400, 0, 600])]), "regularRun")).toEqual([]);
  });

  it("containerFill / containerRun: part-empty containers and shipments two months in a row", () => {
    const slim = (out: number[]) =>
      clean("SKU S", { factory: "BBB", po: out, sellIn: all(100), entityStock: all(3000) });
    const findings = run([slim([0, 0, 0, 0, 0, 1200, 0, 1300, 1278, 0, 800])]);
    expect(of(findings, "containerFill")).toHaveLength(1);
    expect(of(findings, "containerFill")[0]).toMatchObject({
      key: "containerFill|2027-04|2027-04",
      factory: "BBB",
      params: { out: 800, size: 1300, count: 1, missing: 500 },
    });
    expect(of(findings, "containerFill")[0]!.params.fill).toBeCloseTo(61.5, 1);
    expect(of(findings, "containerRun")[0]!.months).toEqual(["2027-01", "2027-02"]);
    // The truck factory is not held to the container rule.
    expect(
      rules(run([clean("SKU A", { po: [0, 0, 0, 0, 0, 800, 800], sellIn: all(100) })])).filter(
        (rule) => rule.startsWith("container"),
      ),
    ).toEqual([]);
  });

  it("loadOf: how many loads a shipment makes and how full the last one is", () => {
    expect(loadOf(1300, 1300)).toEqual({ count: 1, lastFill: 1, missing: 0 });
    expect(loadOf(1500, 1300)).toMatchObject({ count: 2, missing: 1100 });
    expect(loadOf(1500, 1300).lastFill).toBeCloseTo(200 / 1300);
    expect(loadOf(0, 1300)).toEqual({ count: 0, lastFill: 0, missing: 0 });
  });

  // --- Materials -----------------------------------------------------------------------------

  it("materials: packaging held for a delisted product, and more than the plan uses", () => {
    const findings = run([clean("SKU A"), clean("SKU B", { status: "Delist", po: [] })], {
      model: {
        materials: {
          sheet: "M",
          planMonths: MONTHS.slice(5),
          rows: [
            makeMaterial("SKU A", { totalBox: 900, planTotal: 600 }),
            makeMaterial("SKU B", { totalBox: 120, planTotal: 0, status: "Delist" }),
            makeMaterial("SKU C", { totalBox: 640, planTotal: 600 }),
            makeMaterial("SKU D", { totalBox: 0, planTotal: 0, status: "Delist" }),
          ],
        },
      },
    });
    expect(of(findings, "materialsLeftover").map((f) => [f.sku?.name, f.params.leftover])).toEqual([
      ["SKU A", 300],
    ]);
    expect(of(findings, "materialsDelist").map((f) => [f.sku?.name, f.params.boxes])).toEqual([
      ["SKU B", 120],
    ]);
  });
});
