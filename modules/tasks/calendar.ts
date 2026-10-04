import {
  addDays,
  addMonths,
  isDateString,
  monthGrid,
  startOfMonth,
  startOfWeek,
} from "@/lib/dates";

export const CALENDAR_MODES = ["month", "week", "day"] as const;
export type CalendarMode = (typeof CALENDAR_MODES)[number];

// Visible days and the date range [from, to) to load for a calendar view.
export function calendarRange(mode: CalendarMode, date: string) {
  if (mode === "day") return { days: [date], from: date, to: addDays(date, 1) };
  if (mode === "week") {
    const start = startOfWeek(date);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return { days, from: start, to: addDays(start, 7) };
  }
  const weeks = monthGrid(date);
  return { days: weeks.flat(), from: weeks[0][0], to: addDays(weeks.at(-1)!.at(-1)!, 1) };
}

// The date that the "previous" / "next" buttons go to.
export function shiftCalendar(mode: CalendarMode, date: string, step: 1 | -1): string {
  if (mode === "day") return addDays(date, step);
  if (mode === "week") return addDays(startOfWeek(date), 7 * step);
  return addMonths(startOfMonth(date), step);
}

export function parseCalendarParams(
  params: Record<string, string | string[] | undefined>,
  today: string,
) {
  const mode = CALENDAR_MODES.find((m) => m === params.mode) ?? "month";
  const date = typeof params.date === "string" && isDateString(params.date) ? params.date : today;
  return { mode, date };
}
