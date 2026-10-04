import { z } from "zod";

// Equipment shape: shelves top to bottom; each shelf has `slots` cells (one facing each).
// `offset` shifts a shelf right by that many slots (stepped shapes like LEGO);
// `group` draws a visual separator every N slots (modules are grouped by 3).
export const shelfSchema = z.object({
  slots: z.number().int().min(1).max(40),
  offset: z.number().int().min(0).max(40).default(0),
  group: z.number().int().min(0).max(40).default(0),
});

export const geometrySchema = z.object({
  header: z.enum(["horizontal", "vertical"]).nullable().default(null),
  shelves: z.array(shelfSchema).min(1).max(20),
});

export type Shelf = z.infer<typeof shelfSchema>;
export type Geometry = z.infer<typeof geometrySchema>;

export function parseGeometry(value: unknown): Geometry {
  return geometrySchema.parse(value);
}

export const slotKey = (shelf: number, position: number) => `${shelf}:${position}`;

export function parseSlotKey(key: string): { shelf: number; position: number } {
  const [shelf, position] = key.split(":").map(Number);
  return { shelf, position };
}

// All slots in reading order: top shelf first, left to right.
export function allSlots(geometry: Geometry): { shelf: number; position: number }[] {
  return geometry.shelves.flatMap((s, shelf) =>
    Array.from({ length: s.slots }, (_, position) => ({ shelf, position })),
  );
}

export function totalSlots(geometry: Geometry): number {
  return geometry.shelves.reduce((sum, s) => sum + s.slots, 0);
}

// Width of the whole equipment in slot units (the widest shelf including its offset).
export function widthInSlots(geometry: Geometry): number {
  return Math.max(...geometry.shelves.map((s) => s.offset + s.slots));
}

export function isInside(geometry: Geometry, shelf: number, position: number): boolean {
  const s = geometry.shelves[shelf];
  return Boolean(s) && Number.isInteger(position) && position >= 0 && position < s.slots;
}

// Short description for lists: "7 полок × 10" or "3 + 9 + 9".
export function describeGeometry(geometry: Geometry): string {
  const counts = geometry.shelves.map((s) => s.slots);
  return counts.every((c) => c === counts[0])
    ? `${counts.length} × ${counts[0]}`
    : counts.join(" + ");
}
