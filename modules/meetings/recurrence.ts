import { addDays, addMonths } from "@/lib/dates";

export const MAX_OCCURRENCES = 52;

export const REPEAT_EVERY = ["week", "twoWeeks", "month"] as const;
export type RepeatEvery = (typeof REPEAT_EVERY)[number];

// The day of the month in a month that may be shorter (31 → the 30th, or the 28th in February).
function monthDay(firstDay: string, months: number) {
  const start = addMonths(firstDay, months);
  const wanted = Number(firstDay.slice(8));
  const last = Number(addDays(addMonths(start, 1), -1).slice(8));
  return `${start.slice(0, 8)}${String(Math.min(wanted, last)).padStart(2, "0")}`;
}

// Local start times ("YYYY-MM-DDTHH:mm") of a series, up to `until` (a date, inclusive): every
// week, every two weeks or every month on the same day.
export function repeatOccurrences(
  firstLocal: string,
  until: string | null,
  every: RepeatEvery = "week",
): string[] {
  const date = firstLocal.slice(0, 10);
  const time = firstLocal.slice(11);
  if (!until) return [firstLocal];
  const result: string[] = [];
  for (let i = 0; result.length < MAX_OCCURRENCES; i++) {
    const day =
      every === "month" ? monthDay(date, i) : addDays(date, i * (every === "week" ? 7 : 14));
    if (day > until) break;
    result.push(`${day}T${time}`);
  }
  return result.length > 0 ? result : [firstLocal];
}
