import { isInside, slotKey, type Geometry } from "@/modules/planograms/geometry";
import { coveredSlots, posmArea, type Layout, type SlotContent } from "@/modules/planograms/layout";

// Pure editing operations used by the planogram editor (kept outside React for clarity).

// Removes the item that occupies `key` (also when `key` is under a POSM spanning slots or
// shelves).
export function removeAt(layout: Layout, key: string): Layout {
  const result = { ...layout };
  if (result[key]) {
    delete result[key];
    return result;
  }
  for (const [start, content] of Object.entries(result))
    if (content.kind === "POSM" && posmArea(start, content.span, content.rows).includes(key)) {
      delete result[start];
      break;
    }
  return result;
}

// Puts content at `key`. A POSM spanning slots (and shelves) replaces whatever stands under it;
// it fails (returns null) when it doesn't fit on the equipment.
export function placeAt(
  layout: Layout,
  geometry: Geometry,
  key: string,
  content: SlotContent,
): Layout | null {
  const area = content.kind === "POSM" ? posmArea(key, content.span, content.rows) : [key];
  if (
    area.some((k) => {
      const [s, p] = k.split(":").map(Number);
      return !isInside(geometry, s, p);
    })
  )
    return null;
  let result = layout;
  for (const k of area) result = removeAt(result, k);
  return { ...result, [key]: content };
}

export function moveCell(
  layout: Layout,
  geometry: Geometry,
  from: string,
  to: string,
): Layout | null {
  const content = layout[from];
  if (!content || from === to) return null;
  const target = layout[to];
  let result = removeAt(layout, from);
  // Two single-slot items swap places.
  if (target && target.kind !== "POSM" && content.kind !== "POSM") {
    return { ...result, [from]: target, [to]: content };
  }
  result = placeAt(result, geometry, to, content) ?? layout;
  return result === layout ? null : result;
}

export function toggleBadge(layout: Layout, keys: string[], badge: string): Layout {
  const result = { ...layout };
  const cells = keys
    .map((k) => result[k])
    .filter((c): c is Extract<SlotContent, { kind: "SKU" }> => c?.kind === "SKU");
  const allHave = cells.every((c) => c.badges.includes(badge));
  for (const key of keys) {
    const c = result[key];
    if (c?.kind !== "SKU") continue;
    result[key] = {
      ...c,
      badges: allHave ? c.badges.filter((b) => b !== badge) : [...new Set([...c.badges, badge])],
    };
  }
  return result;
}

function shelfContents(layout: Layout, shelf: number, slots: number) {
  return Array.from({ length: slots }, (_, p) => layout[slotKey(shelf, p)]);
}

// Copies shelf `from` onto shelf `to` (same number of slots only).
export function copyShelf(
  layout: Layout,
  geometry: Geometry,
  from: number,
  to: number,
): Layout | null {
  const a = geometry.shelves[from];
  const b = geometry.shelves[to];
  if (!a || !b || a.slots !== b.slots) return null;
  const result = { ...layout };
  const source = shelfContents(layout, from, a.slots);
  source.forEach((content, p) => {
    if (content) result[slotKey(to, p)] = content;
    else delete result[slotKey(to, p)];
  });
  return result;
}

// Swaps two shelves with the same number of slots ("move shelf up / down").
export function swapShelves(
  layout: Layout,
  geometry: Geometry,
  a: number,
  b: number,
): Layout | null {
  const sa = geometry.shelves[a];
  const sb = geometry.shelves[b];
  if (!sa || !sb || sa.slots !== sb.slots) return null;
  const result = { ...layout };
  const ca = shelfContents(layout, a, sa.slots);
  const cb = shelfContents(layout, b, sb.slots);
  for (let p = 0; p < sa.slots; p++) {
    if (cb[p]) result[slotKey(a, p)] = cb[p]!;
    else delete result[slotKey(a, p)];
    if (ca[p]) result[slotKey(b, p)] = ca[p]!;
    else delete result[slotKey(b, p)];
  }
  return result;
}

export { coveredSlots };
