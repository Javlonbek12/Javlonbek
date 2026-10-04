import { describe, expect, it } from "vitest";

import { autofill } from "./autofill";
import { diffLayouts, highlightCells } from "./diff";
import { EQUIPMENT_FIXTURES, SKU_FIXTURES } from "./fixtures";
import {
  allSlots,
  describeGeometry,
  parseGeometry,
  slotKey,
  totalSlots,
  widthInSlots,
} from "./geometry";
import { coveredSlots, layoutProblems, type Layout } from "./layout";
import { formatPrice, mergePriceLists, priceChanges } from "./prices";
import { adaptLayout, insertSku, replaceSku } from "./transform";
import { DEFAULT_RULES, hasCritical, validatePlanogram, type Rule } from "./validate";

const geo = (code: string) => EQUIPMENT_FIXTURES.find((e) => e.code === code)!.geometry;
const skus = SKU_FIXTURES;
const rule = (
  kind: Rule["kind"],
  params: Record<string, unknown> = {},
  severity: Rule["severity"] = "CRITICAL",
): Rule => ({
  kind,
  severity,
  enabled: true,
  params,
});
const put = (
  layout: Layout,
  shelf: number,
  position: number,
  skuId: string,
  badges: string[] = [],
) => {
  layout[slotKey(shelf, position)] = { kind: "SKU", skuId, badges };
};

describe("geometry of the four equipment types", () => {
  it("Display L: header + 7 shelves × 10", () => {
    const g = geo("DISPLAY_L");
    expect(totalSlots(g)).toBe(70);
    expect(g.header).toBe("horizontal");
    expect(describeGeometry(g)).toBe("7 × 10");
  });

  it("Module 9×2: 18 slots grouped by 3", () => {
    expect(totalSlots(geo("MODULE_9x2"))).toBe(18);
    expect(geo("MODULE_9x2").shelves[0].group).toBe(3);
  });

  it("LEGO 21: a stepped shape (3 centred + 9 + 9)", () => {
    const g = geo("LEGO_21");
    expect(totalSlots(g)).toBe(21);
    expect(widthInSlots(g)).toBe(9);
    expect(describeGeometry(g)).toBe("3 + 9 + 9");
    expect(allSlots(g).slice(0, 4)).toEqual([
      { shelf: 0, position: 0 },
      { shelf: 0, position: 1 },
      { shelf: 0, position: 2 },
      { shelf: 1, position: 0 },
    ]);
  });

  it("POG MINI: one row of 18", () => {
    expect(totalSlots(geo("POG_MINI"))).toBe(18);
  });

  it("rejects broken geometry", () => {
    expect(() => parseGeometry({ shelves: [] })).toThrow();
    expect(() => parseGeometry({ shelves: [{ slots: 0 }] })).toThrow();
    expect(parseGeometry({ shelves: [{ slots: 5 }] })).toEqual({
      header: null,
      shelves: [{ slots: 5, offset: 0, group: 0 }],
    });
  });

  it("a POSM banner covers several slots and may not overlap other items", () => {
    const g = geo("DISPLAY_L");
    const layout: Layout = { "2:0": { kind: "POSM", posmId: "banner", span: 10 } };
    expect(coveredSlots(layout).size).toBe(9);
    put(layout, 2, 3, "sku-1");
    expect(layoutProblems(layout, g)).toEqual(["overlap:2:3"]);
    expect(layoutProblems({ "0:8": { kind: "POSM", posmId: "x", span: 3 } }, g)).toEqual([
      "span:0:8",
    ]);
  });
});

describe("rules", () => {
  const pog = geo("POG_MINI");

  it("mandatory SKUs: shows which of the 9 are missing (critical)", () => {
    const layout: Layout = {};
    put(layout, 0, 0, "sku-1");
    put(layout, 0, 1, "sku-2", ["YANGI"]);
    const violations = validatePlanogram(layout, pog, skus, [rule("MANDATORY_SKUS")]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      message: "mandatory",
      params: { count: 7, total: 9 },
      severity: "CRITICAL",
    });
    expect(String(violations[0].params.names)).toContain("ESSE Change (тест)");
    expect(hasCritical(violations)).toBe(true);
  });

  it("mandatory SKUs on given shelves only (e.g. the front row)", () => {
    const g = geo("MODULE_9x2");
    const layout: Layout = {};
    skus.filter((s) => s.isMandatory).forEach((s, i) => put(layout, 1, i, s.id));
    expect(
      validatePlanogram(layout, g, skus, [rule("MANDATORY_SKUS", { shelves: [0] })])[0].params
        .count,
    ).toBe(9);
    expect(validatePlanogram(layout, g, skus, [rule("MANDATORY_SKUS", { shelves: [1] })])).toEqual(
      [],
    );
  });

  it("min / max facings, with a per-SKU override", () => {
    const layout: Layout = {};
    for (let i = 0; i < 5; i++) put(layout, 0, i, "sku-1");
    put(layout, 0, 5, "sku-3");
    const v = validatePlanogram(layout, pog, skus, [
      rule("FACINGS", { min: 1, max: 4, perSku: { "SKU-TEST-003": { min: 2 } } }),
    ]);
    expect(v.map((x) => [x.message, x.params.name])).toEqual([
      ["facingsMax", "ESSE Special Gold (тест)"],
      ["facingsMin", "ESSE Change W (тест)"],
    ]);
  });

  it("brand blocks: one brand stands together on a shelf", () => {
    const layout: Layout = {};
    put(layout, 0, 0, "sku-1"); // ESSE
    put(layout, 0, 1, "sku-9"); // BOHEM
    put(layout, 0, 2, "sku-3"); // ESSE again → broken block
    const v = validatePlanogram(layout, pog, skus, [rule("BRAND_BLOCKS", {}, "WARNING")]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ params: { brand: "ESSE", shelf: 1 }, cells: ["0:0", "0:2"] });
  });

  it("brand order ESSE → BOHEM → PINE", () => {
    const layout: Layout = {};
    put(layout, 0, 0, "sku-12"); // PINE first
    put(layout, 0, 1, "sku-1"); // ESSE
    expect(
      validatePlanogram(layout, pog, skus, [
        rule("BRAND_ORDER", { order: ["ESSE", "BOHEM", "PINE"] }),
      ])[0].message,
    ).toBe("brandOrder");
  });

  it("new items need the YANGI badge and a priority shelf", () => {
    const g = geo("DISPLAY_L");
    const layout: Layout = {};
    put(layout, 3, 0, "sku-2", ["1mg"]);
    const v = validatePlanogram(layout, g, skus, [
      rule("NEW_ITEMS", { shelves: [0], badge: "YANGI" }, "WARNING"),
    ]);
    expect(v.map((x) => x.message)).toEqual(["newBadge", "newShelf"]);
  });

  it("every slot is filled or deliberately empty; POSM-covered slots count as decided", () => {
    const g = geo("MODULE_9x2");
    const layout: Layout = {
      "0:0": { kind: "POSM", posmId: "sticker", span: 2 },
      "0:2": { kind: "EMPTY" },
    };
    const v = validatePlanogram(layout, g, skus, [rule("ALL_SLOTS_DECIDED")]);
    expect(v[0].params.count).toBe(18 - 3);
  });

  it("disabled rules are skipped", () => {
    expect(
      validatePlanogram({}, pog, skus, [{ ...rule("ALL_SLOTS_DECIDED"), enabled: false }]),
    ).toEqual([]);
  });
});

describe("autofill", () => {
  it("fills POG MINI with all 18 SKUs in brand order, no critical violations", () => {
    const g = geo("POG_MINI");
    const { layout, dropped } = autofill(g, skus);
    expect(dropped).toEqual([]);
    const violations = validatePlanogram(layout, g, skus, DEFAULT_RULES);
    expect(hasCritical(violations)).toBe(false);
    // The new item comes first with its YANGI badge.
    expect(layout["0:0"]).toEqual({ kind: "SKU", skuId: "sku-2", badges: ["YANGI", "1mg"] });
  });

  it("on Display L, spare slots become extra facings and every rule passes", () => {
    const g = geo("DISPLAY_L");
    const { layout } = autofill(g, skus);
    expect(Object.values(layout).filter((c) => c.kind === "EMPTY")).toHaveLength(0);
    expect(validatePlanogram(layout, g, skus, DEFAULT_RULES)).toEqual([]);
  });

  it("on a small module, mandatory SKUs stay and others drop off", () => {
    const g = parseGeometry({ shelves: [{ slots: 10 }] });
    const { layout, dropped } = autofill(g, skus);
    expect(dropped).toHaveLength(8);
    expect(validatePlanogram(layout, g, skus, [rule("MANDATORY_SKUS")])).toEqual([]);
  });

  it("is deterministic", () => {
    expect(autofill(geo("LEGO_21"), skus)).toEqual(autofill(geo("LEGO_21"), [...skus].reverse()));
  });
});

describe("changes between versions", () => {
  const g = geo("MODULE_9x2");
  const base = (): Layout => {
    const l: Layout = {};
    put(l, 0, 0, "sku-1");
    put(l, 0, 1, "sku-1");
    put(l, 0, 2, "sku-9");
    put(l, 1, 0, "sku-12");
    return l;
  };

  it("finds added, removed, moved, facings and price changes", () => {
    const before = base();
    const after = base();
    delete after["0:2"]; // BOHEM removed
    put(after, 0, 2, "sku-17"); // Simple added
    delete after["1:0"];
    put(after, 1, 5, "sku-12"); // PINE moved on its shelf
    put(after, 0, 3, "sku-1"); // ESSE: 2 → 3 facings
    const changes = diffLayouts(
      { layout: before, geometry: g, prices: new Map([["sku-1", 31000]]) },
      { layout: after, geometry: g, prices: new Map([["sku-1", 33000]]) },
    );
    expect(changes).toEqual([
      { type: "facings", itemType: "SKU", id: "sku-1", from: 2, to: 3 },
      { type: "price", itemType: "SKU", id: "sku-1", from: 31000, to: 33000 },
      { type: "added", itemType: "SKU", id: "sku-17", to: [{ shelf: 0, position: 2 }] },
      {
        type: "moved",
        itemType: "SKU",
        id: "sku-12",
        from: [{ shelf: 1, position: 0 }],
        to: [{ shelf: 1, position: 5 }],
        direction: "same",
      },
      { type: "removed", itemType: "SKU", id: "sku-9", from: [{ shelf: 0, position: 2 }] },
    ]);
    const cells = highlightCells(changes);
    expect(cells.before.get("0:2")).toBe("removed");
    expect(cells.after.get("0:2")).toBe("added");
  });

  it("moving to a lower shelf is «down» (Вниз)", () => {
    const before = base();
    const after = base();
    delete after["0:2"];
    put(after, 1, 2, "sku-9");
    const [change] = diffLayouts(
      { layout: before, geometry: g, prices: new Map() },
      { layout: after, geometry: g, prices: new Map() },
    );
    expect(change).toMatchObject({ type: "moved", direction: "down" });
  });

  it("identical versions have no changes", () => {
    const prices = new Map([["sku-1", 1]]);
    expect(
      diffLayouts({ layout: base(), geometry: g, prices }, { layout: base(), geometry: g, prices }),
    ).toEqual([]);
  });
});

describe("prices", () => {
  it("formats price tags", () => {
    expect(formatPrice(31000)).toBe("31 000");
    expect(formatPrice(18000, "MING")).toBe("18 ming");
    expect(formatPrice(18500, "MING")).toBe("18 500");
  });

  it("a new price list keeps old prices and overrides the uploaded ones", () => {
    const merged = mergePriceLists(
      new Map([
        ["a", 1],
        ["b", 2],
      ]),
      new Map([["b", 3]]),
    );
    expect([...merged]).toEqual([
      ["a", 1],
      ["b", 3],
    ]);
    expect(
      priceChanges(
        ["a", "b", "a"],
        new Map([
          ["a", 1],
          ["b", 2],
        ]),
        merged,
      ),
    ).toEqual([{ skuId: "b", from: 2, to: 3 }]);
  });
});

describe("mass operations", () => {
  const g = geo("MODULE_9x2");

  it("replaces a SKU everywhere", () => {
    const layout: Layout = {};
    put(layout, 0, 0, "sku-1", ["YANGI"]);
    put(layout, 1, 0, "sku-1");
    const { layout: result, replaced } = replaceSku(layout, "sku-1", "sku-3");
    expect(replaced).toBe(2);
    expect(result["0:0"]).toEqual({ kind: "SKU", skuId: "sku-3", badges: ["YANGI"] });
  });

  it("inserts a new item at a position, shifting the shelf right", () => {
    const layout: Layout = {};
    for (let p = 0; p < 9; p++) put(layout, 0, p, `sku-${p + 1}`);
    const result = insertSku(layout, g, 0, 1, "sku-2", ["YANGI"]);
    expect(result.ok).toBe(true);
    expect(result.droppedSkuId).toBe("sku-9");
    expect((result.layout["0:2"] as { skuId: string }).skuId).toBe("sku-2");
    expect((result.layout["0:1"] as { badges: string[] }).badges).toEqual(["YANGI"]);
  });

  it("does not insert across a POSM", () => {
    const layout: Layout = { "0:5": { kind: "POSM", posmId: "s", span: 2 } };
    expect(insertSku(layout, g, 0, 1, "sku-2", []).ok).toBe(false);
  });

  it("adapts Display L to Display M keeping mandatory SKUs", () => {
    const { layout } = autofill(geo("DISPLAY_L"), skus);
    const adapted = adaptLayout(layout, geo("DISPLAY_L"), geo("DISPLAY_M"), skus);
    expect(
      validatePlanogram(adapted.layout, geo("DISPLAY_M"), skus, [
        rule("MANDATORY_SKUS"),
        rule("ALL_SLOTS_DECIDED"),
      ]),
    ).toEqual([]);
  });
});
