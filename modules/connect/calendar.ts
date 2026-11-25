import type { RouteAnalysis, RouteZone } from "./routes";
import { targetTone, type Tone } from "./tone";

// «Календарь»: zones down, the period's days across — a cell is a zone's day, coloured against
// the target. A TSM's day shows the planned visits made and is coloured by attendance; a rep's
// day shows the visits with an order and is coloured by hit rate (reps visit nearly everything,
// so attendance says little). Pure, so the page and the Excel file draw the same grid.

export type CalendarMode = "attendance" | "hitRate";

const share = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

// A day of a zone: its number, its share and the colour.
export function calendarCell(
  day: RouteAnalysis["calendar"][string][string] | undefined,
  mode: CalendarMode,
  target: number,
): { text: string; rate: number | null; tone: Tone | null; of: string } | null {
  if (!day) return null;
  const [part, whole] =
    mode === "attendance" ? [day.visited, day.planned] : [day.orders, day.visits];
  // A day with only visits out of plan (attendance) has nothing to take a share of.
  if (!whole)
    return mode === "attendance" && day.visits
      ? { text: "+", rate: null, tone: null, of: "" }
      : null;
  const rate = share(part, whole);
  return { text: String(part), rate, tone: targetTone(rate, target), of: `${part} / ${whole}` };
}

// The days anyone shown has something on (a Sunday without routes is not a column).
export const calendarDays = (analysis: RouteAnalysis, rows: RouteZone[]) =>
  [...new Set(rows.flatMap((z) => Object.keys(analysis.calendar[z.zone] ?? {})))].sort();

// The period's share of a zone and what it is of.
export function calendarTotal(zone: RouteZone, mode: CalendarMode) {
  const [part, whole] =
    mode === "attendance" ? [zone.visited, zone.planned] : [zone.orders, zone.visits];
  return { share: mode === "attendance" ? zone.attendance : zone.hitRate, part, whole };
}
