import { allSlots, slotKey, type Geometry } from "./geometry";
import { coveredSlots, skuFacings, type Layout, type SkuInfo } from "./layout";
import { autofill } from "./autofill";

// Replace one SKU with another everywhere in the layout (badges are kept).
export function replaceSku(
  layout: Layout,
  fromId: string,
  toId: string,
): { layout: Layout; replaced: number } {
  let replaced = 0;
  const result: Layout = {};
  for (const [key, content] of Object.entries(layout)) {
    if (content.kind === "SKU" && content.skuId === fromId) {
      result[key] = { ...content, skuId: toId };
      replaced += 1;
    } else {
      result[key] = content;
    }
  }
  return { layout: result, replaced };
}

// Put a SKU at (shelf, position), shifting the rest of the shelf to the right; the last
// item that no longer fits falls off. Shelves with POSM after the position are not changed.
export function insertSku(
  layout: Layout,
  geometry: Geometry,
  shelf: number,
  position: number,
  skuId: string,
  badges: string[],
): { layout: Layout; ok: boolean; droppedSkuId: string | null } {
  const slots = geometry.shelves[shelf]?.slots ?? 0;
  if (position < 0 || position >= slots) return { layout, ok: false, droppedSkuId: null };
  const covered = coveredSlots(layout);
  for (let p = position; p < slots; p++) {
    const key = slotKey(shelf, p);
    if (layout[key]?.kind === "POSM" || covered.has(key))
      return { layout, ok: false, droppedSkuId: null };
  }
  const result: Layout = { ...layout };
  const last = layout[slotKey(shelf, slots - 1)];
  for (let p = slots - 1; p > position; p--) {
    const previous = layout[slotKey(shelf, p - 1)];
    if (previous) result[slotKey(shelf, p)] = previous;
    else delete result[slotKey(shelf, p)];
  }
  result[slotKey(shelf, position)] = { kind: "SKU", skuId, badges };
  return { layout: result, ok: true, droppedSkuId: last?.kind === "SKU" ? last.skuId : null };
}

// Same assortment on other equipment: keeps the SKU order and facings where they fit
// (fewer slots → fewer facings, then non-mandatory SKUs drop off). POSM is not carried over.
export function adaptLayout(layout: Layout, from: Geometry, to: Geometry, skus: SkuInfo[]) {
  const facings = new Map<string, number>();
  for (const f of skuFacings(layout, from))
    facings.set(f.content.skuId, (facings.get(f.content.skuId) ?? 0) + 1);
  const ordered = [...facings.keys()]
    .map((id) => skus.find((s) => s.id === id))
    .filter((s): s is SkuInfo => Boolean(s));
  const brandOrder = [...new Set(ordered.map((s) => s.brand))];
  const result = autofill(to, ordered, { brandOrder, facings, maxFacings: 40 });
  // Spare slots stay empty rather than inventing facings.
  for (const { shelf, position } of allSlots(to))
    result.layout[slotKey(shelf, position)] ??= { kind: "EMPTY" };
  return result;
}
