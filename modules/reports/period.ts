import {
  addDays,
  addMonths,
  daysBetween,
  isDateString,
  startOfMonth,
  startOfWeek,
} from "@/lib/dates";

// A report period: calendar dates "YYYY-MM-DD", both ends included.
export type Period = { from: string; to: string };

export const PRESETS = ["week", "lastWeek", "month", "lastMonth", "quarter"] as const;
export type Preset = (typeof PRESETS)[number];

export function presetPeriod(preset: Preset, today: string): Period {
  switch (preset) {
    case "week":
      return { from: startOfWeek(today), to: today };
    case "lastWeek": {
      const from = addDays(startOfWeek(today), -7);
      return { from, to: addDays(from, 6) };
    }
    case "month":
      return { from: startOfMonth(today), to: today };
    case "lastMonth": {
      const from = addMonths(startOfMonth(today), -1);
      return { from, to: addDays(startOfMonth(today), -1) };
    }
    case "quarter": {
      const month = Number(today.slice(5, 7));
      const first = `${today.slice(0, 4)}-${String(month - ((month - 1) % 3)).padStart(2, "0")}-01`;
      return { from: first, to: today };
    }
  }
}

// Reads ?preset= or ?from=&to= from the page / download URL; defaults to this week.
// Custom periods are limited to a year.
export function parsePeriod(
  params: { preset?: unknown; from?: unknown; to?: unknown },
  today: string,
): Period & { preset: Preset | null } {
  const { from, to } = params;
  if (
    typeof from === "string" &&
    typeof to === "string" &&
    isDateString(from) &&
    isDateString(to) &&
    from <= to &&
    daysBetween(from, to) <= 366
  ) {
    return { from, to, preset: null };
  }
  const preset = PRESETS.includes(params.preset as Preset) ? (params.preset as Preset) : "week";
  return { ...presetPeriod(preset, today), preset };
}

// The period of the same length right before this one, for "compared with before".
export function previousPeriod(period: Period): Period {
  const days = daysBetween(period.from, period.to) + 1;
  return { from: addDays(period.from, -days), to: addDays(period.from, -1) };
}

// Week starts (Mondays) shown in the chart: the weeks of the period, at least 8 for context
// (going back from the period end), at most 13.
export function chartWeeks(period: Period): string[] {
  const last = startOfWeek(period.to);
  const inPeriod = Math.floor(daysBetween(startOfWeek(period.from), last) / 7) + 1;
  const count = Math.min(13, Math.max(8, inPeriod));
  return Array.from({ length: count }, (_, i) => addDays(last, (i - count + 1) * 7));
}
