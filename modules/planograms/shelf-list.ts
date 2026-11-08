import { slotKey, type Geometry } from "./geometry";
import { coveredBelow, coveredSlots, type Layout } from "./layout";
import { formatPrice, type PriceStyle } from "./prices";

// An SKU's full name without the brand twice: many names already start with it («ESSE Change»).
export function skuLabel(sku: { brand: string; name: string }): string {
  return sku.name.toLowerCase().startsWith(sku.brand.toLowerCase())
    ? sku.name
    : `${sku.brand} ${sku.name}`;
}

export type ShelfEntry =
  | { kind: "SKU"; name: string; facings: number; price: string | null; badges: string[] }
  | { kind: "POSM"; name: string }
  | { kind: "EMPTY"; places: number }
  | { kind: "UNDECIDED"; places: number };

// The planogram as a list a merchandiser reads in the shop: each shelf from the top, left to
// right, neighbouring facings of one SKU together with their price and marks. It reads on a phone
// even where packs have no pictures.
export function shelfList(
  layout: Layout,
  geometry: Geometry,
  skus: Map<string, { brand: string; name: string; priceStyle: PriceStyle }>,
  posmNames: Map<string, string>,
  prices: Map<string, number>,
): { shelf: number; entries: ShelfEntry[] }[] {
  const covered = coveredSlots(layout);
  const below = coveredBelow(layout);
  return geometry.shelves.map((shelf, index) => {
    const entries: ShelfEntry[] = [];
    for (let p = 0; p < shelf.slots; p++) {
      const key = slotKey(index, p);
      if (covered.has(key) || below.has(key)) continue;
      const cell = layout[key];
      const last = entries.at(-1);
      if (cell?.kind === "SKU") {
        const sku = skus.get(cell.skuId);
        const name = sku ? skuLabel(sku) : "?";
        const price = prices.get(cell.skuId);
        const text = price === undefined ? null : formatPrice(price, sku?.priceStyle);
        if (last?.kind === "SKU" && last.name === name && last.badges.join() === cell.badges.join())
          last.facings += 1;
        else entries.push({ kind: "SKU", name, facings: 1, price: text, badges: cell.badges });
      } else if (cell?.kind === "POSM") {
        entries.push({ kind: "POSM", name: posmNames.get(cell.posmId) ?? "POSM" });
      } else {
        const kind = cell?.kind === "EMPTY" ? "EMPTY" : "UNDECIDED";
        if (last?.kind === kind) last.places += 1;
        else entries.push({ kind, places: 1 });
      }
    }
    return { shelf: index + 1, entries };
  });
}
