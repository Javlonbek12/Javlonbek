import { dateFormat, type Locale } from "@/lib/i18n";

// Calendar dates as "YYYY-MM-DD" strings. Task and plan dates have no time of day,
// so working with strings avoids timezone shifts. "Today" depends on the user's timezone.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

// Prisma returns @db.Date columns as Date at 00:00 UTC.
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fromDateString(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function todayInTimezone(timeZone: string, now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

export function addDays(value: string, days: number): string {
  const date = fromDateString(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

export function addMonths(value: string, months: number): string {
  const date = fromDateString(value);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  return toDateString(date);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((fromDateString(to).getTime() - fromDateString(from).getTime()) / 86_400_000);
}

// Weeks start on Monday.
export function startOfWeek(value: string): string {
  const weekday = (fromDateString(value).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(value, -weekday);
}

export function startOfMonth(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

export function startOfYear(value: string): string {
  return `${value.slice(0, 4)}-01-01`;
}

// Weeks (Monday..Sunday) that cover the month containing `value`.
export function monthGrid(value: string): string[][] {
  const first = startOfMonth(value);
  const nextMonth = addMonths(first, 1);
  const weeks: string[][] = [];
  for (let day = startOfWeek(first); day < nextMonth; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return weeks;
}

// ISO 8601 week number.
export function isoWeekNumber(value: string): number {
  const thursday = addDays(startOfWeek(value), 3);
  const yearStart = startOfYear(thursday);
  return Math.floor(daysBetween(yearStart, thursday) / 7) + 1;
}

// In the current language (client components pass theirs).
export function formatDay(value: string, locale?: Locale): string {
  return dateFormat({ day: "numeric", month: "short", timeZone: "UTC" }, locale).format(
    fromDateString(value),
  );
}

export function formatDayLong(value: string, locale?: Locale): string {
  return dateFormat(
    { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" },
    locale,
  ).format(fromDateString(value));
}

export function formatMonth(value: string, locale?: Locale): string {
  const text = dateFormat({ month: "long", year: "numeric", timeZone: "UTC" }, locale)
    .format(fromDateString(value))
    .replace(" г.", "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
