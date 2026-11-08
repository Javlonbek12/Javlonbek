import { describe, expect, it } from "vitest";

import {
  equipmentWorkbook,
  launchTemplateWorkbook,
  outletBaseWorkbook,
  posmWorkbook,
} from "@/tests/helpers/distribution";

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
  tsmBreakdown,
  typedShare,
  type Count,
  type Item,
  type TypeFacts,
} from "./compute";
import {
  DistributionParseError,
  bomElements,
  parseEquipmentFile,
  parseLaunchTemplate,
  parseOutletBase,
  parsePosmList,
} from "./parse";
import { controlRows, controlTone, controlTotal, hasMinus } from "./control";
import {
  canonicalRegion,
  destinationLabel,
  NO_TSM,
  parseDestination,
  regionLabel,
  tagPrice,
  typeFromPivotHeader,
} from "./types";

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
  // Test Town's outlets have no TSM in the base.
  { kind: "INSTALLED", region: "Test Town", tsm: NO_TSM, type: "POSI_L", count: 6 },
  { kind: "INSTALLED", region: "Test Town", tsm: NO_TSM, type: "MW24_S", count: 2 },
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

  it("plans an item by the units of its types, then breaks each region down by TSM", () => {
    const shelf = item({ ordered: 19, types: ["POSI_L"] });
    const plan = planItem(shelf, regions, tsms, facts);
    // 19 × 12/18 = 12.67 → 12; 19 × 6/18 = 6.33 → 6; 1 left.
    expect(plan.byRegion.get("Tashkent")).toBe(12);
    expect(plan.byRegion.get("Test Town")).toBe(6);
    expect(plan.distributed).toBe(18);
    expect(plan.central).toBe(1);
    // Tashkent's 12 by POSI L units: TSM 7, TSM 3, and 2 in its warehouse (no TSM) → 7, 3, 2.
    expect(plan.byTsm.get("Tashkent · TSM_TEST_1")).toBe(7);
    expect(plan.byTsm.get("Tashkent · TSM_TEST_2")).toBe(3);
    expect(plan.tsmRest.get("Tashkent")).toBe(2);
    // Test Town has no TSM in the base: its whole share is the «TSM не назначен» row.
    expect(plan.byTsm.get(`Test Town · ${NO_TSM}`)).toBe(6);
    expect(plan.tsmRest.get("Test Town")).toBe(0);
    expect(plannedFor(plan, "Tashkent · TSM_TEST_1")).toBe(7);
    expect(plannedFor(plan, "Test Town")).toBe(6);
    const rows = tsmBreakdown([plan], tsms);
    expect(rows.map((r) => [r.kind, r.label, r.values[0]])).toEqual([
      ["region", "Tashkent", 12],
      ["tsm", "TSM_TEST_1", 7],
      ["tsm", "TSM_TEST_2", 3],
      ["rest", "Tashkent", 2],
      ["region", "Test Town", 6],
      ["tsm", NO_TSM, 6],
      ["rest", "Test Town", 0],
    ]);
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
    expect(out.find((f) => f.key === "noTsm")?.params).toEqual({ count: "8" });
    expect(out.findIndex((f) => f.tone === "info")).toBeGreaterThan(
      out.findIndex((f) => f.tone === "warn"),
    );

    // Without price tags in the campaign: one quiet line instead of a red line per price.
    const noTags = [items[0]!];
    const quiet = findings({
      items: noTags,
      regions,
      tsms,
      counts,
      includeStock: true,
      plans: noTags.map((i) => planItem(i, regions, tsms, facts)),
      controls: noTags.map((i) => controlItem(i, total)),
      tags: priceTagNeed(noTags, total, facts),
      facts,
    }).map((f) => f.key);
    expect(quiet).not.toContain("tagShort");
    expect(quiet).toContain("tagNone");
  });
});

describe("the TSM breakdown", () => {
  it("gives units without a TSM their own row; only the stock's share stays in the region", () => {
    const some: Count[] = [
      { kind: "INSTALLED", region: "Test Town", tsm: "", type: "POSI_L", count: 10 },
      { kind: "STOCK", region: "Test Town", tsm: "", type: "POSI_L", count: 2 },
      { kind: "INSTALLED", region: "Test Town", tsm: "TSM_A", type: "POSI_L", count: 4 },
      { kind: "INSTALLED", region: "Test Town", tsm: "TSM_B", type: "POSI_L", count: 1.5 },
      { kind: "INSTALLED", region: "Test Town", tsm: NO_TSM, type: "POSI_L", count: 4.5 },
    ];
    const regions = regionBase(some, true);
    const tsms = tsmBase(some);
    expect([...tsms.get("Test Town")!.keys()]).toEqual(["TSM_A", "TSM_B", NO_TSM]);
    const plan = planItem(item({ ordered: 20, types: ["POSI_L"] }), regions, tsms, facts);
    // Of 12 units: 20 × 4/12 = 6.67 → 6, 20 × 1.5/12 = 2.5 → 2, «TSM не назначен» 20 × 4.5/12 =
    // 7.5 → 7; the stock's 3.33 and the rounding (5 in all) stay at Test Town's warehouse.
    expect(plan.byTsm.get("Test Town · TSM_A")).toBe(6);
    expect(plan.byTsm.get("Test Town · TSM_B")).toBe(2);
    expect(plan.byTsm.get(`Test Town · ${NO_TSM}`)).toBe(7);
    expect(plan.tsmRest.get("Test Town")).toBe(5);
    const out = findings({
      items: [],
      regions,
      tsms,
      counts: some,
      includeStock: true,
      plans: [],
      controls: [],
      tags: [],
      facts,
    });
    expect(out.find((f) => f.key === "noTsm")?.params).toEqual({ count: "5" });
  });
});

describe("the control equation", () => {
  it("leaves the unaccounted as the difference and colours it", () => {
    const rows = controlRows(
      [
        { types: ["POSI_L"], quantity: 100 },
        { types: ["DG_C"], quantity: 50 },
        { types: ["POSI_MOD"], quantity: 2400 },
      ],
      { POSI_L: 90, DG_C: 52, POSI_MOD: 1074.67, MW24_S: 3 },
      { POSI_L: 9, POSI_MOD: 1246.5 },
    );
    const by = Object.fromEntries(rows.map((r) => [r.types.join("+"), r]));
    expect(by.POSI_L).toMatchObject({ unaccounted: 1, tone: "ok" });
    // A minus: duplicate rows or dismantled equipment left in the file.
    expect(by.DG_C).toMatchObject({ unaccounted: -2, tone: "bad" });
    // Display MOD as in the real file: 78.83 of 2400 (3.3%) is a small plus.
    expect(by.POSI_MOD!.unaccounted).toBeCloseTo(78.83, 2);
    expect(by.POSI_MOD!.tone).toBe("ok");
    // Nothing bought entered: no equation, no colour, and no block.
    expect(by.MW24_S).toMatchObject({ purchased: null, unaccounted: null, tone: "none" });
    expect(hasMinus(rows)).toBe(true);
    expect(controlTone(100, 6)).toBe("warn");
    expect(controlTone(10, 1)).toBe("ok");
    expect(controlTone(10, 1.5)).toBe("warn");
    expect(controlTotal(rows)).toMatchObject({ purchased: 2550, stock: 1255.5 });
    expect(hasMinus(controlRows([], { POSI_L: 5 }, {}))).toBe(false);
  });

  it("checks types bought together as one row", () => {
    // As in the ESSE template: Display L = DG L + Metawerk L, 620 bought.
    const rows = controlRows(
      [
        { types: ["DG_L", "MW25_L", "MW24_L"], quantity: 620 },
        { types: ["POSI_M"], quantity: 700 },
      ],
      { DG_L: 191, MW25_L: 320, MW24_L: 99, POSI_M: 669, DG_C: 4 },
      { DG_L: 5, MW25_L: 2, MW24_L: 2, POSI_M: 32 },
    );
    expect(rows.map((r) => [r.types.join("+"), r.purchased, r.unaccounted, r.tone])).toEqual([
      ["POSI_M", 700, -1, "bad"],
      ["DG_L+MW25_L+MW24_L", 620, 1, "ok"],
      ["DG_C", null, null, "none"],
    ]);
    // A later entry for one type of the group still counts in the group.
    const more = controlRows(
      [
        { types: ["DG_L", "MW25_L"], quantity: 500 },
        { types: ["MW24_L"], quantity: 100 },
        { types: ["MW25_L", "MW24_L"], quantity: 20 },
      ],
      { DG_L: 191, MW25_L: 320, MW24_L: 99 },
      {},
    );
    expect(more.map((r) => [r.types.join("+"), r.purchased, r.unaccounted])).toEqual([
      ["DG_L+MW25_L+MW24_L", 620, 10],
    ]);
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

  it("reads the equipment file's names, regions and destinations", () => {
    expect(typeFromPivotHeader("Display XL (12*10) POSI")).toBe("POSI_XL");
    expect(typeFromPivotHeader("Display l (10*10) MW")).toBe("MW25_L");
    expect(typeFromPivotHeader("Display-M (9*6) POSI")).toBe("POSI_M");
    expect(typeFromPivotHeader("Display MOD")).toBe("POSI_MOD");
    expect(typeFromPivotHeader("LIGHTBOX")).toBe("LIGHTBOX");
    expect(canonicalRegion("Sirdarya")).toBe("Syrdarya");
    expect(canonicalRegion(" navoi ")).toBe("Navai");
    expect(canonicalRegion("Test Town")).toBe("Test Town");
    expect(parseDestination("Test Town · TSM_A")).toEqual({ region: "Test Town", tsm: "TSM_A" });
    expect(parseDestination("Test Town")).toEqual({ region: "Test Town", tsm: null });
  });

  it("reads the price on a price tag", () => {
    expect(tagPrice("Ценник 28000")).toBe(28000);
    expect(tagPrice("Ценник 19,000 blue")).toBe(19000);
    expect(tagPrice("Ценник Universal")).toBeNull();
    expect(tagPrice("Divider (2 slot)")).toBeNull();
  });
});

describe("the files", () => {
  it("reads the equipment file unit by unit, with the warehouse stock", async () => {
    const file = await parseEquipmentFile(await equipmentWorkbook());
    expect(file.units).toHaveLength(23);
    expect(file.skipped).toEqual([
      { row: 25, reason: "unknownType", region: "Test Town", description: "Fridge" },
    ]);
    expect(file.unknownTypes).toEqual(["Fridge"]);
    expect(file.units[0]).toEqual({
      outletId: "1",
      outletKey: "1",
      region: "Tashkent",
      type: "POSI_L",
      units: 1,
      posName: "Точка 1",
      tin: "",
    });
    expect(file.units.find((u) => u.type === "POSI_MOD")).toMatchObject({ units: 2 });
    expect(file.stock).toEqual([{ region: "Tashkent", type: "POSI_L", count: 2 }]);
  });

  it("keeps rows without an ID by TIN or name, and says why a row is skipped", async () => {
    const file = await parseEquipmentFile(await equipmentWorkbook({ extra: true }));
    expect(file.units).toHaveLength(25);
    expect(file.units.find((u) => !u.outletId)).toMatchObject({
      outletKey: "Test Town|tin:300000001",
      posName: "Без ID",
      tin: "300000001",
    });
    expect(file.skipped.map((r) => [r.row, r.reason])).toEqual([
      [25, "unknownType"],
      [28, "noIdentity"],
    ]);
  });

  it("reads a POSM launch template: equipment groups and the BOM", async () => {
    expect(bomElements('Shelftalker POSI №1-2 "Change 1mg" (C)')).toEqual([
      "Shelftalker №1",
      "Shelftalker №2",
    ]);
    expect(bomElements("Display Box POSI (XL)")).toEqual(["Display Box"]);
    expect(bomElements('Divider "Ozgarmas Narx" (2 slot)')).toEqual(["Divider"]);
    const t = await parseLaunchTemplate(await launchTemplateWorkbook());
    expect(t.launch).toBe("Тестовый запуск");
    expect(t.equipment.map((e) => [e.code, e.types, e.count])).toEqual([
      ["L", ["DG_L", "MW25_L", "MW24_L"], 20],
      ["LP", ["POSI_L"], 12],
      ["C", ["DG_C"], 4],
    ]);
    const size = (element: string, type: string) =>
      t.sizes.find((s) => s.element === element && s.type === type);
    expect(size("Header", "MW24_L")).toMatchObject({ heightMm: 230, widthMm: 600, perUnit: 1 });
    expect(size("Header", "POSI_L")).toMatchObject({ heightMm: 294, widthMm: 578 });
    expect(size("Combo Box", "DG_L")).toMatchObject({ widthMm: 288 });
    expect(size("Shelftalker №4", "DG_L")).toMatchObject({ widthMm: 310, perUnit: 1 });
    // Two dividers on L, one on C.
    expect(size("Divider", "DG_L")?.perUnit).toBe(2);
    expect(size("Divider", "DG_C")?.perUnit).toBe(1);
    expect(t.skipped).toEqual(["Jumbo Pack Header (тест)"]);
  });

  it("reads the outlet base and the POSM list", async () => {
    const outlets = await parseOutletBase(await outletBaseWorkbook());
    expect(outlets).toHaveLength(24);
    expect(outlets[0]).toEqual({ outletId: "1", region: "Tashkent", tsm: "TSM_TEST_1" });
    expect(outlets.at(-1)).toEqual({ outletId: "30", region: "Test Town", tsm: null });

    const posm = await parsePosmList(await posmWorkbook());
    expect(posm).toHaveLength(3);
    expect(posm[0]).toMatchObject({
      name: "Shelftalker (тест)",
      ordered: 19,
      norm: 1,
      normReserve: 0.1,
      base: "UNITS",
      types: ["POSI_L"],
    });
    expect(posm[1]).toMatchObject({ inStock: 5, reservePct: 0.1, norm: null });
    expect(posm[1]!.types).toHaveLength(12);
    expect(posm[2]).toMatchObject({ base: "SLOTS", types: ["POSI_L", "DG_C"] });
  });

  it("refuses files without what it needs", async () => {
    await expect(parsePosmList(await posmWorkbook({ posmSheet: false }))).rejects.toBeInstanceOf(
      DistributionParseError,
    );
    await expect(parseEquipmentFile(await posmWorkbook())).rejects.toMatchObject({
      code: "noEquipment",
    });
    await expect(parseOutletBase(await posmWorkbook())).rejects.toMatchObject({
      code: "noOutlets",
    });
    await expect(parseEquipmentFile(Buffer.from("not excel"))).rejects.toMatchObject({
      code: "badFile",
    });
  });
});

describe("a share typed in percent", () => {
  it("keeps the stored value when the field comes back as shown", () => {
    // 1/11 is shown as 9.1 %: saving other fields must not turn it into 0.091.
    expect(typedShare("9.1", "9.1", String(1 / 11))).toBe(1 / 11);
    expect(typedShare("9,1", "9.1", String(1 / 11))).toBe(1 / 11);
    expect(typedShare("12", "9.1", String(1 / 11))).toBe(0.12);
    expect(typedShare("", "0", "")).toBe(0);
  });
});

describe("region names on screen", () => {
  it("are Russian in Russian, the stored name otherwise", () => {
    expect(regionLabel("Tashkent", "ru")).toBe("Ташкент");
    expect(regionLabel("Tashkent", "en")).toBe("Tashkent");
    expect(regionLabel("Test Town", "ru")).toBe("Test Town");
    expect(destinationLabel("Jizzax · TSM_TEST_1", "ru")).toBe("Джизак · TSM_TEST_1");
  });
});
