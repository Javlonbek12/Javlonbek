import { allSlots, slotKey, type Geometry } from "./geometry";
import type { Layout, SkuInfo } from "./layout";
import { DEFAULT_BRAND_ORDER } from "./validate";

export type AutofillOptions = {
  brandOrder?: string[];
  maxFacings?: number;
  // Shelves where new items go first (top shelf by default).
  priorityShelves?: number[];
  newBadge?: string;
  // Desired facings per SKU id (e.g. from an existing planogram); default 1 + spare slots.
  facings?: Map<string, number>;
};

function brandRank(order: string[], brand: string) {
  const index = order.indexOf(brand);
  return index === -1 ? order.length : index;
}

// Deterministic layout: new items on priority shelves → mandatory SKUs → brand blocks
// in the brand order → spare slots become extra facings (mandatory first).
export function autofill(
  geometry: Geometry,
  skus: SkuInfo[],
  options: AutofillOptions = {},
): { layout: Layout; dropped: string[] } {
  const order = options.brandOrder ?? DEFAULT_BRAND_ORDER;
  const maxFacings = options.maxFacings ?? 4;
  const priority = options.priorityShelves ?? [0];
  const badge = options.newBadge ?? "YANGI";
  const slots = allSlots(geometry);

  const sorted = [...skus].sort(
    (a, b) =>
      brandRank(order, a.brand) - brandRank(order, b.brand) ||
      a.brand.localeCompare(b.brand) ||
      Number(b.isMandatory) - Number(a.isMandatory) ||
      a.code.localeCompare(b.code),
  );
  const newItems = sorted.filter((s) => s.isNew);
  const regular = sorted.filter((s) => !s.isNew);

  // Fit the list into the available slots: drop non-mandatory SKUs from the end first.
  const chosen = [...newItems, ...regular];
  const dropped: string[] = [];
  while (chosen.length > slots.length) {
    const index = chosen.findLastIndex((s) => !s.isMandatory);
    const removed = chosen.splice(index === -1 ? chosen.length - 1 : index, 1)[0];
    dropped.push(removed.id);
  }

  const facings = new Map(
    chosen.map((s) => [s.id, Math.max(1, Math.min(maxFacings, options.facings?.get(s.id) ?? 1))]),
  );
  const used = () => [...facings.values()].reduce((a, b) => a + b, 0);
  // Too many facings requested: take them back from the largest ones.
  while (used() > slots.length) {
    const [id] = [...facings.entries()].sort((a, b) => b[1] - a[1])[0];
    facings.set(id, facings.get(id)! - 1);
  }
  // Spare slots: one more facing at a time, mandatory SKUs first.
  const growOrder = [
    ...chosen.filter((s) => s.isMandatory),
    ...chosen.filter((s) => !s.isMandatory),
  ];
  for (let grew = true; grew && used() < slots.length;) {
    grew = false;
    for (const sku of growOrder) {
      if (used() >= slots.length) break;
      if (!options.facings && facings.get(sku.id)! < maxFacings) {
        facings.set(sku.id, facings.get(sku.id)! + 1);
        grew = true;
      }
    }
  }

  const layout: Layout = {};
  const free = [...slots];
  const take = (preferShelves: number[] | null) => {
    const index = preferShelves ? free.findIndex((s) => preferShelves.includes(s.shelf)) : 0;
    return free.splice(index === -1 ? 0 : index, 1)[0];
  };
  const place = (sku: SkuInfo, preferShelves: number[] | null) => {
    for (let i = 0; i < facings.get(sku.id)!; i++) {
      const slot = take(preferShelves);
      if (!slot) return;
      const badges = [...new Set([...(sku.isNew ? [badge] : []), ...sku.defaultBadges])];
      layout[slotKey(slot.shelf, slot.position)] = { kind: "SKU", skuId: sku.id, badges };
    }
  };
  for (const sku of chosen.filter((s) => s.isNew)) place(sku, priority);
  for (const sku of chosen.filter((s) => !s.isNew)) place(sku, null);
  for (const slot of free) layout[slotKey(slot.shelf, slot.position)] = { kind: "EMPTY" };
  return { layout, dropped };
}
