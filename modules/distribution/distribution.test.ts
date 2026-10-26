import { describe, expect, it } from "vitest";

import { distributionWorkbook } from "@/tests/helpers/distribution";

import {
  controlItem,
  coverage,
  findings,
  gaps,
  planItem,
  plannedFor,
  priceTagNeed,
  regionBase,
  split,
  stock,
  totalUnits,
  tsmBase,
  type Count,
  type Item,
  type TypeFacts,
} from "./compute";
import { DistributionParseError, parseDistributionWorkbook } from "./parse";
import { tagPrice, typeFromPivotHeader } from "./types";

const counts: Count[] = [
  { kind: "INSTALLED", region: "Tashkent", tsm: "", type: "POSI_L", count: 10 },
  { kind: "INSTALLED", region: "Tashkent", tsm: "", type: "DG_C", count: 4 },
  { kind: "INSTALLED", region: "Test Town", tsm: "", type: "POSI_L", count: 6 },
  { kind: "INSTALLED", region: "Test Town", tsm: "", type: "MW24_S", count: 2 },
  { kind: "STOCK", region: "Tashkent", tsm: "", type: "POSI_L", count: 2 },
  { kind: "INSTALLED", region: "Tashkent", tsm: "TSM_TEST_1", type: "POSI_L", count: 7 },
  { kind: "INSTALLED", region: "Tashkent", tsm: "TSM_TEST_1", type: "DG_C", count: 1 },
  { kind: "INSTALLED", region: "Tashkent", tsm: "TSM_TEST_2", type: "POSI_L", count: 3 },
  { kind: "INSTALLED", region: "Tashkent", tsm: "TSM_TEST_2", type: "DG_C", count: 3 },
];

const item = (over: Partial<Item>): Item => ({
  id: "x",
  position: 1,
  name: "Тест",
  category: "Shelftalker",
  orderedFor: 0,
  inStock: 0,
  ordered: 0,
  reservePct: 0,
  base: "UNITS",
  norm: null,
  normReserve: 0,
  types: [],
  ...over,
});

const facts: TypeFacts = {
  slots: { POSI_L: 70, DG_C: 50, MW24_S: 20 },
  facings: { POSI_L: { 21000: 6, 22000: 4 }, DG_C: { 21000: 2 } },
};

describe("the distribution model", () => {
  const regions = regionBase(counts, true);
  const tsms = tsmBase(counts);

  it("adds warehouse equipment to the base only when asked", () => {
    expect(regions.get("Tashkent")).toEqual({ POSI_L: 12, DG_C: 4 });
    expect(regionBase(counts, false).get("Tashkent")).toEqual({ POSI_L: 10, DG_C: 4 });
    expect(totalUnits(regions)).toEqual({ POSI_L: 18, DG_C: 4, MW24_S: 2 });
    expect([...regions.keys()]).toEqual(["Tashkent", "Test Town"]);
  });

  it("splits by weight rounding down; the rest stays", () => {
    const { shares, rest } = split(
      10,
      new Map([
        ["a", 1],
        ["b", 1],
        ["c", 1],
      ]),
    );
    expect([...shares.values()]).toEqual([3, 3, 3]);
    expect(rest).toBe(1);
    expect(split(5, new Map([["a", 0]])).rest).toBe(5);
  });

  it("plans an item by the units of its types, then splits Tashkent between TSMs", () => {
    const shelf = item({ ordered: 19, types: ["POSI_L"] });
    const plan = planItem(shelf, regions, tsms, facts);
    // 19 × 12/18 = 12.67 → 12; 19 × 6/18 = 6.33 → 6; 1 left.
    expect(plan.byRegion.get("Tashkent")).toBe(12);
    expect(plan.byRegion.get("Test Town")).toBe(6);
    expect(plan.distributed).toBe(18);
    expect(plan.central).toBe(1);
    // 12 by TSM POSI L units 7 : 3 → 8.4 → 8 and 3.6 → 3; 1 stays in the Tashkent warehouse.
    expect(plan.byTsm.get("TSM_TEST_1")).toBe(8);
    expect(plan.byTsm.get("TSM_TEST_2")).toBe(3);
    expect(plan.tsmRest).toBe(1);
    expect(plannedFor(plan, "Tashkent · TSM_TEST_1")).toBe(8);
    expect(plannedFor(plan, "Test Town")).toBe(6);
  });

  it("keeps the reserve at the central warehouse and weighs slots and planogram facings", () => {
    const divider = item({
      inStock: 5,
      ordered: 20,
      reservePct: 0.1,
      types: ["POSI_L", "DG_C", "MW24_S"],
    });
    const plan = planItem(divider, regions, tsms, facts);
    expect(plan.toShip).toBe(22); // 25 × 0.9 = 22.5 → 22
    expect(plan.central).toBe(25 - plan.distributed);

    const bySlots = planItem(
      item({ ordered: 100, base: "SLOTS", types: ["POSI_L", "DG_C"] }),
      regions,
      tsms,
      facts,
    );
    // Tashkent 12×70 + 4×50 = 1040, Test Town 6×70 = 420.
    expect(bySlots.weight).toBe(1460);
    expect(bySlots.byRegion.get("Tashkent")).toBe(71);

    const tag = item({
      name: "Ценник 21000",
      ordered: 100,
      base: "PLANOGRAM",
      types: ["POSI_L", "DG_C", "MW24_S"],
    });
    const byFacings = planItem(tag, regions, tsms, facts);
    // Tashkent 12×6 + 4×2 = 80, Test Town 6×6 = 36; S has no 21 000 facings.
    expect(byFacings.weight).toBe(116);
    expect(byFacings.byRegion.get("Test Town")).toBe(31);
  });

  it("checks the norm and finds gaps in coverage", () => {
    const shelf = item({
      name: "Shelftalker",
      ordered: 19,
      norm: 1,
      normReserve: 0.1,
      types: ["POSI_L"],
    });
    const control = controlItem(shelf, totalUnits(regions));
    expect(control).toMatchObject({ covered: 18, need: 20, balance: -1 });
    const items = [
      shelf,
      item({ id: "d", category: "Divider", types: ["POSI_L", "DG_C", "MW24_S"] }),
    ];
    expect(coverage(items).find((c) => c.category === "Shelftalker")!.byType.DG_C).toBe(0);
    const gap = gaps(items, regions).find((g) => g.category === "Shelftalker")!;
    expect(gap.byRegion.get("Tashkent")!.missing).toBe(4);
    expect(gap.byRegion.get("Test Town")!.missing).toBe(2);
  });

  it("counts price tags by planogram facings", () => {
    const tags = priceTagNeed(
      [item({ name: "Ценник 21000", ordered: 50 }), item({ name: "Ценник 25000", ordered: 10 })],
      totalUnits(regions),
      facts,
    );
    expect(tags.find((t) => t.price === 21000)).toMatchObject({
      need: 18 * 6 + 4 * 2,
      available: 50,
    });
    expect(tags.find((t) => t.price === 22000)).toMatchObject({ need: 72, available: 0 });
    expect(tags.find((t) => t.price === 25000)).toMatchObject({ need: 0, available: 10 });
  });

  it("tracks shipments against the plan", () => {
    const shelf = item({ id: "s", ordered: 19, types: ["POSI_L"] });
    const plan = planItem(shelf, regions, tsms, facts);
    const [line] = stock(
      [plan],
      [
        { posmId: "s", destination: "Test Town", quantity: 6 },
        { posmId: "s", destination: "Tashkent · TSM_TEST_1", quantity: 5 },
        { posmId: "other", destination: "Test Town", quantity: 99 },
      ],
    );
    expect(line).toMatchObject({ available: 19, planned: 18, shipped: 11, onHand: 8, toSend: 7 });
    expect(line!.byDestination.get("Tashkent · TSM_TEST_1")).toBe(5);
  });

  it("lists the findings, problems first", () => {
    const items = [
      item({
        id: "a",
        name: "Shelftalker",
        ordered: 10,
        norm: 1,
        normReserve: 0,
        types: ["POSI_L"],
      }),
      item({ id: "b", name: "Ценник 21000", category: "Ценник", ordered: 10, types: ["POSI_L"] }),
    ];
    const total = totalUnits(regions);
    const out = findings({
      items,
      regions,
      tsms,
      counts,
      includeStock: true,
      plans: items.map((i) => planItem(i, regions, tsms, facts)),
      controls: items.map((i) => controlItem(i, total)),
      tags: priceTagNeed(items, total, facts),
      facts,
    });
    const keys = out.map((f) => f.key);
    expect(keys[0]).toBe("deficit");
    expect(keys).toContain("gap");
    expect(keys).toContain("tagShort");
    expect(keys).toContain("tagUniform");
    expect(keys).toContain("tsmStock");
    expect(out.findIndex((f) => f.tone === "info")).toBeGreaterThan(
      out.findIndex((f) => f.tone === "warn"),
    );
  });
});

describe("names", () => {
  it("reads the TSM pivot headers", () => {
    expect(typeFromPivotHeader("XL (12*10) POSI")).toBe("POSI_XL");
    expect(typeFromPivotHeader("C (10*6) DG")).toBe("DG_C");
    expect(typeFromPivotHeader("L (10*10) MW")).toBe("MW25_L");
    expect(typeFromPivotHeader("L (10*9) MW")).toBe("MW24_L");
    expect(typeFromPivotHeader("M (6*10) MW")).toBe("MW25_M");
    expect(typeFromPivotHeader("S (10*2) MW")).toBe("MW24_S");
    expect(typeFromPivotHeader("Grand Total")).toBeNull();
  });

  it("reads the price on a price tag", () => {
    expect(tagPrice("Ценник 28000")).toBe(28000);
    expect(tagPrice("Ценник 19,000 blue")).toBe(19000);
    expect(tagPrice("Ценник Universal")).toBeNull();
    expect(tagPrice("Divider (2 slot)")).toBeNull();
  });
});

describe("parseDistributionWorkbook", () => {
  it("reads equipment, TSMs and POSM from the workbook", async () => {
    const parsed = await parseDistributionWorkbook(await distributionWorkbook());
    const installed = parsed.counts.filter((c) => c.kind === "INSTALLED" && !c.tsm);
    expect(installed).toEqual(
      expect.arrayContaining([
        { kind: "INSTALLED", region: "Tashkent", tsm: "", type: "POSI_L", count: 10 },
        { kind: "INSTALLED", region: "Test Town", tsm: "", type: "MW24_S", count: 2 },
      ]),
    );
    expect(parsed.counts.filter((c) => c.kind === "STOCK")).toEqual([
      { kind: "STOCK", region: "Tashkent", tsm: "", type: "POSI_L", count: 2 },
    ]);
    // The calculated base block is not read.
    expect(installed.reduce((s, c) => s + c.count, 0)).toBe(22);
    expect(parsed.counts.filter((c) => c.tsm === "TSM_TEST_2")).toEqual([
      { kind: "INSTALLED", region: "Tashkent", tsm: "TSM_TEST_2", type: "POSI_L", count: 3 },
      { kind: "INSTALLED", region: "Tashkent", tsm: "TSM_TEST_2", type: "DG_C", count: 3 },
    ]);
    expect(parsed.includeStock).toBe(true);
    expect(parsed.posm).toHaveLength(3);
    expect(parsed.posm[0]).toMatchObject({
      name: "Shelftalker (тест)",
      ordered: 19,
      norm: 1,
      normReserve: 0.1,
      base: "UNITS",
      types: ["POSI_L"],
    });
    expect(parsed.posm[1]).toMatchObject({ inStock: 5, reservePct: 0.1, norm: null });
    expect(parsed.posm[1]!.types).toHaveLength(12);
    expect(parsed.posm[2]).toMatchObject({ base: "SLOTS", types: ["POSI_L", "DG_C"] });
  });

  it("reads the warehouse switch and refuses files without the sheets", async () => {
    expect(
      (await parseDistributionWorkbook(await distributionWorkbook({ includeStock: "Нет" })))
        .includeStock,
    ).toBe(false);
    await expect(
      parseDistributionWorkbook(await distributionWorkbook({ posmSheet: false })),
    ).rejects.toBeInstanceOf(DistributionParseError);
    await expect(parseDistributionWorkbook(Buffer.from("not excel"))).rejects.toMatchObject({
      code: "badFile",
    });
  });
});
