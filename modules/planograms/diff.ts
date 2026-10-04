import { allSlots, slotKey, type Geometry } from "./geometry";
import type { Layout } from "./layout";

export type Position = { shelf: number; position: number };

export type LayoutChange =
  | { type: "added"; itemType: "SKU" | "POSM"; id: string; to: Position[] }
  | { type: "removed"; itemType: "SKU" | "POSM"; id: string; from: Position[] }
  | {
      type: "moved";
      itemType: "SKU" | "POSM";
      id: string;
      from: Position[];
      to: Position[];
      direction: "up" | "down" | "same";
    }
  | { type: "facings"; itemType: "SKU"; id: string; from: number; to: number }
  | { type: "price"; itemType: "SKU"; id: string; from: number | null; to: number | null };

function positionsById(layout: Layout, geometry: Geometry) {
  const result = new Map<string, { itemType: "SKU" | "POSM"; positions: Position[] }>();
  for (const { shelf, position } of allSlots(geometry)) {
    const content = layout[slotKey(shelf, position)];
    if (!content || content.kind === "EMPTY") continue;
    const id = content.kind === "SKU" ? content.skuId : content.posmId;
    const entry = result.get(id) ?? { itemType: content.kind, positions: [] };
    entry.positions.push({ shelf, position });
    result.set(id, entry);
  }
  return result;
}

const same = (a: Position[], b: Position[]) =>
  a.length === b.length &&
  a.every((p, i) => p.shelf === b[i].shelf && p.position === b[i].position);

const averageShelf = (positions: Position[]) =>
  positions.reduce((sum, p) => sum + p.shelf, 0) / positions.length;

// What changed from `before` to `after`: replaces the hand-made "delete / Вниз / price" notes in PowerPoint.
export function diffLayouts(
  before: { layout: Layout; geometry: Geometry; prices: Map<string, number> },
  after: { layout: Layout; geometry: Geometry; prices: Map<string, number> },
): LayoutChange[] {
  const old = positionsById(before.layout, before.geometry);
  const now = positionsById(after.layout, after.geometry);
  const changes: LayoutChange[] = [];

  for (const [id, { itemType, positions }] of now) {
    const was = old.get(id);
    if (!was) {
      changes.push({ type: "added", itemType, id, to: positions });
      continue;
    }
    if (itemType === "SKU" && was.positions.length !== positions.length) {
      changes.push({
        type: "facings",
        itemType: "SKU",
        id,
        from: was.positions.length,
        to: positions.length,
      });
    } else if (!same(was.positions, positions)) {
      const delta = averageShelf(positions) - averageShelf(was.positions);
      changes.push({
        type: "moved",
        itemType,
        id,
        from: was.positions,
        to: positions,
        direction: delta > 0 ? "down" : delta < 0 ? "up" : "same",
      });
    }
    if (itemType === "SKU") {
      const from = before.prices.get(id) ?? null;
      const to = after.prices.get(id) ?? null;
      if (from !== to) changes.push({ type: "price", itemType: "SKU", id, from, to });
    }
  }
  for (const [id, { itemType, positions }] of old) {
    if (!now.has(id)) changes.push({ type: "removed", itemType, id, from: positions });
  }
  return changes;
}

// Cells to highlight in a side-by-side comparison.
export function highlightCells(changes: LayoutChange[]) {
  const before = new Map<string, "removed" | "moved">();
  const after = new Map<string, "added" | "moved" | "price">();
  for (const change of changes) {
    if (change.type === "added")
      change.to.forEach((p) => after.set(slotKey(p.shelf, p.position), "added"));
    if (change.type === "removed")
      change.from.forEach((p) => before.set(slotKey(p.shelf, p.position), "removed"));
    if (change.type === "moved") {
      change.from.forEach((p) => before.set(slotKey(p.shelf, p.position), "moved"));
      change.to.forEach((p) => after.set(slotKey(p.shelf, p.position), "moved"));
    }
  }
  return { before, after };
}
