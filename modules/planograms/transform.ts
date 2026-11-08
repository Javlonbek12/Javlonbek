import { allSlots, isInside, slotKey, type Geometry } from "./geometry";
import {
  coveredSlots,
  posmArea,
  skuFacings,
  type Layout,
  type SkuInfo,
  type SlotContent,
} from "./layout";

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

type Facing = Extract<SlotContent, { kind: "SKU" }>;

// Same planogram on other equipment. Everything stays on its shelf and place where it fits
// (packs, deliberate empties, POSM); what is cut off (a shorter shelf, fewer shelves) moves to the
// free places in reading order, the SKUs not on the new equipment yet first. A SKU that still has
// no place takes an extra facing of another one (mandatory SKUs first); `dropped` lists the SKUs
// that found none, for the user to see.
export function adaptLayout(layout: Layout, from: Geometry, to: Geometry, skus: SkuInfo[]) {
  const result: Layout = {};
  const taken = new Set<string>();
  const overflow: Facing[] = [];
  for (const { shelf, position } of allSlots(from)) {
    const key = slotKey(shelf, position);
    const content = layout[key];
    if (!content) continue;
    const area = content.kind === "POSM" ? posmArea(key, content.span, content.rows) : [key];
    const fits = area.every((k) => {
      const [s, p] = k.split(":").map(Number);
      return isInside(to, s, p) && !taken.has(k);
    });
    if (fits) {
      result[key] = content;
      for (const k of area) taken.add(k);
    } else if (content.kind === "SKU") overflow.push(content);
  }

  const free = allSlots(to)
    .map(({ shelf, position }) => slotKey(shelf, position))
    .filter((k) => !taken.has(k));
  const onTarget = () =>
    new Set(Object.values(result).flatMap((c) => (c.kind === "SKU" ? [c.skuId] : [])));
  // Fewer free places than packs cut off: the first facing of each SKU not placed yet goes first,
  // then extra facings; the chosen ones keep their order.
  let moving = overflow;
  if (free.length < overflow.length) {
    const present = onTarget();
    const first = new Set<number>();
    overflow.forEach((c, i) => {
      if (!present.has(c.skuId)) {
        present.add(c.skuId);
        first.add(i);
      }
    });
    const keep = new Set([...first].slice(0, free.length));
    for (let i = 0; i < overflow.length && keep.size < free.length; i++) keep.add(i);
    moving = overflow.filter((_, i) => keep.has(i));
  }
  moving.forEach((c, i) => (result[free[i]!] = c));
  for (const key of free.slice(moving.length)) result[key] = { kind: "EMPTY" };

  // SKUs still missing take an extra facing of another SKU (of the same brand if possible),
  // looking from the end of the equipment.
  const source = skuFacings(layout, from).map((f) => f.content.skuId);
  const info = new Map(skus.map((s) => [s.id, s]));
  const present = onTarget();
  const missing = [...new Set(source)]
    .filter((id) => !present.has(id))
    .sort((a, b) => Number(info.get(b)?.isMandatory ?? 0) - Number(info.get(a)?.isMandatory ?? 0));
  const dropped: string[] = [];
  const order = allSlots(to)
    .map(({ shelf, position }) => slotKey(shelf, position))
    .reverse();
  for (const id of missing) {
    const counts = new Map<string, number>();
    for (const c of Object.values(result))
      if (c.kind === "SKU") counts.set(c.skuId, (counts.get(c.skuId) ?? 0) + 1);
    const extra = (key: string) => {
      const c = result[key];
      return c?.kind === "SKU" && (counts.get(c.skuId) ?? 0) > 1;
    };
    const brand = info.get(id)?.brand;
    const key =
      order.find(
        (k) =>
          extra(k) && info.get((result[k] as Facing).skuId)?.brand === brand && brand !== undefined,
      ) ?? order.find(extra);
    if (!key) {
      dropped.push(id);
      continue;
    }
    const sku = info.get(id);
    const old = overflow.find((c) => c.skuId === id);
    result[key] = { kind: "SKU", skuId: id, badges: old?.badges ?? sku?.defaultBadges ?? [] };
  }
  return { layout: result, dropped };
}
