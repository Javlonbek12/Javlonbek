import { allSlots, isInside, slotKey, type Geometry } from "./geometry";

export type SlotContent =
  | { kind: "SKU"; skuId: string; badges: string[] }
  | { kind: "POSM"; posmId: string; span: number }
  | { kind: "EMPTY" };

// Contents by slot key "shelf:position". A POSM item sits at its first slot and covers `span` slots.
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

// Slot keys hidden under a multi-slot POSM item (not including its first slot).
export function coveredSlots(layout: Layout): Set<string> {
  const covered = new Set<string>();
  for (const [key, content] of Object.entries(layout)) {
    if (content.kind !== "POSM") continue;
    const [shelf, position] = key.split(":").map(Number);
    for (let i = 1; i < content.span; i++) covered.add(slotKey(shelf, position + i));
  }
  return covered;
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
    if (content.kind === "POSM" && !isInside(geometry, shelf, position + content.span - 1))
      problems.push(`span:${key}`);
  }
  return problems;
}
