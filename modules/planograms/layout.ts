import { allSlots, isInside, slotKey, type Geometry } from "./geometry";

export type SlotContent =
  | { kind: "SKU"; skuId: string; badges: string[] }
  | { kind: "POSM"; posmId: string; span: number; rows: number }
  | { kind: "EMPTY" };

// Contents by slot key "shelf:position". A POSM item sits at its first slot (top left) and covers
// `span` slots on `rows` shelves downwards.
export type Layout = Record<string, SlotContent>;

export type SkuInfo = {
  id: string;
  code: string;
  brand: string;
  name: string;
  isNew: boolean;
  isMandatory: boolean;
  defaultBadges: string[];
};

// The slots a POSM item at `key` covers, its own first slot included.
export function posmArea(key: string, span: number, rows: number): string[] {
  const [shelf, position] = key.split(":").map(Number);
  const out: string[] = [];
  for (let r = 0; r < Math.max(1, rows); r++)
    for (let i = 0; i < Math.max(1, span); i++) out.push(slotKey(shelf + r, position + i));
  return out;
}

// Slot keys hidden under a multi-slot POSM item (not including its first slot).
export function coveredSlots(layout: Layout): Set<string> {
  const covered = new Set<string>();
  for (const [key, content] of Object.entries(layout)) {
    if (content.kind !== "POSM") continue;
    for (const k of posmArea(key, content.span, content.rows)) if (k !== key) covered.add(k);
  }
  return covered;
}

// Of those, the ones on lower shelves (the item hangs over them): the row keeps their place.
export function coveredBelow(layout: Layout): Set<string> {
  const below = new Set<string>();
  for (const [key, content] of Object.entries(layout)) {
    if (content.kind !== "POSM" || content.rows <= 1) continue;
    const shelf = Number(key.split(":")[0]);
    for (const k of posmArea(key, content.span, content.rows))
      if (Number(k.split(":")[0]) !== shelf) below.add(k);
  }
  return below;
}

// SKU facings in reading order.
export function skuFacings(layout: Layout, geometry: Geometry) {
  return allSlots(geometry)
    .map(({ shelf, position }) => ({ shelf, position, content: layout[slotKey(shelf, position)] }))
    .filter(
      (
        x,
      ): x is { shelf: number; position: number; content: Extract<SlotContent, { kind: "SKU" }> } =>
        x.content?.kind === "SKU",
    );
}

// Checks that every item is inside the equipment and POSM items don't overlap others.
export function layoutProblems(layout: Layout, geometry: Geometry): string[] {
  const problems: string[] = [];
  const covered = coveredSlots(layout);
  for (const [key, content] of Object.entries(layout)) {
    const [shelf, position] = key.split(":").map(Number);
    if (!isInside(geometry, shelf, position)) problems.push(`outside:${key}`);
    if (covered.has(key)) problems.push(`overlap:${key}`);
    if (
      content.kind === "POSM" &&
      posmArea(key, content.span, content.rows).some((k) => {
        const [s, p] = k.split(":").map(Number);
        return !isInside(geometry, s, p);
      })
    )
      problems.push(`span:${key}`);
  }
  return problems;
}
