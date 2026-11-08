import { describe, expect, it } from "vitest";

import { EQUIPMENT_FIXTURES } from "@/modules/planograms/fixtures";
import { layoutProblems, type Layout } from "@/modules/planograms/layout";

import { copyShelf, moveCell, placeAt, removeAt, swapShelves, toggleBadge } from "./editor-ops";

const g = EQUIPMENT_FIXTURES.find((e) => e.code === "DISPLAY_L")!.geometry;
const sku = (skuId: string, badges: string[] = []) => ({ kind: "SKU" as const, skuId, badges });

describe("editor operations", () => {
  it("a banner replaces what stood in its span; a SKU on the banner removes it", () => {
    const layout: Layout = { "1:0": sku("a"), "1:3": sku("b"), "1:9": sku("c") };
    const withBanner = placeAt(layout, g, "1:0", {
      kind: "POSM",
      posmId: "banner",
      span: 5,
      rows: 1,
    })!;
    expect(withBanner).toEqual({
      "1:0": { kind: "POSM", posmId: "banner", span: 5, rows: 1 },
      "1:9": sku("c"),
    });
    expect(removeAt(withBanner, "1:3")).toEqual({ "1:9": sku("c") });
    expect(placeAt(layout, g, "1:8", { kind: "POSM", posmId: "x", span: 5, rows: 1 })).toBeNull();
  });

  it("a combo box over two shelves replaces what stood under it on both", () => {
    const layout: Layout = { "1:1": sku("a"), "2:2": sku("b"), "2:9": sku("c") };
    const combo = { kind: "POSM" as const, posmId: "combo", span: 5, rows: 2 };
    const placed = placeAt(layout, g, "1:0", combo)!;
    expect(placed).toEqual({ "1:0": combo, "2:9": sku("c") });
    // Clicking a slot it hangs over on the lower shelf removes it.
    expect(removeAt(placed, "2:4")).toEqual({ "2:9": sku("c") });
    // It does not fit below the last shelf.
    expect(placeAt(layout, g, `${g.shelves.length - 1}:0`, combo)).toBeNull();
  });

  it("moves and swaps single cells", () => {
    const layout: Layout = { "0:0": sku("a"), "0:1": sku("b") };
    expect(moveCell(layout, g, "0:0", "0:1")).toEqual({ "0:0": sku("b"), "0:1": sku("a") });
    expect(moveCell(layout, g, "0:0", "3:4")).toEqual({ "0:1": sku("b"), "3:4": sku("a") });
  });

  it("toggles a badge on several cells", () => {
    const layout: Layout = { "0:0": sku("a", ["YANGI"]), "0:1": sku("b") };
    expect(toggleBadge(layout, ["0:0", "0:1"], "YANGI")).toEqual({
      "0:0": sku("a", ["YANGI"]),
      "0:1": sku("b", ["YANGI"]),
    });
    expect(
      toggleBadge(toggleBadge(layout, ["0:0", "0:1"], "YANGI"), ["0:0", "0:1"], "YANGI"),
    ).toEqual({ "0:0": sku("a"), "0:1": sku("b") });
  });

  it("copies and swaps shelves", () => {
    const layout: Layout = { "0:0": sku("a"), "1:5": sku("b") };
    expect(copyShelf(layout, g, 0, 1)).toEqual({ "0:0": sku("a"), "1:0": sku("a") });
    expect(swapShelves(layout, g, 0, 1)).toEqual({ "1:0": sku("a"), "0:5": sku("b") });
  });

  // The editor refuses such a move (it checks layoutProblems) instead of failing on save.
  it("moving shelves under a POSM over several shelves leaves cells under it", () => {
    const combo = { kind: "POSM" as const, posmId: "combo", span: 5, rows: 2 };
    const layout: Layout = { "1:0": combo, "3:2": sku("a") };
    expect(layoutProblems(layout, g)).toEqual([]);
    const swapped = swapShelves(layout, g, 2, 3)!;
    expect(layoutProblems(swapped, g)).toEqual(["overlap:2:2"]);
    expect(layoutProblems(copyShelf(layout, g, 1, 2)!, g)).toContain("overlap:2:0");
  });
});
