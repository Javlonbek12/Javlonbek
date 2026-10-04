import { addDays, startOfWeek, todayInTimezone } from "@/lib/dates";
import { minutesOfDayInTimezone } from "@/lib/time";

// Fixed local times for reminders (minutes from midnight).
export const DUE_REMINDER_TIME = 17 * 60; // the day before the due date
export const OVERDUE_TIME = 9 * 60; // the morning after the due date
export const WEEKLY_SUMMARY_TIME = 17 * 60; // Friday
// A digest that is more than 4 hours late (e.g. the worker was down) is skipped.
export const DIGEST_WINDOW_MINUTES = 4 * 60;
// Overdue tasks older than this are not announced again after downtime.
export const OVERDUE_LOOKBACK_DAYS = 7;

export type LocalClock = { date: string; minutes: number; weekday: number };

// The user's local date, time and weekday (Monday = 0).
export function localClock(now: Date, timeZone: string): LocalClock {
  const date = todayInTimezone(timeZone, now);
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return { date, minutes: minutesOfDayInTimezone(now, timeZone), weekday };
}

export function isDigestTime(clock: LocalClock, digestTime: number): boolean {
  return clock.minutes >= digestTime && clock.minutes < digestTime + DIGEST_WINDOW_MINUTES;
}

// Due date of tasks to remind about now (tomorrow), or null if it's not reminder time yet.
export function dueReminderDate(clock: LocalClock): string | null {
  return clock.minutes >= DUE_REMINDER_TIME ? addDays(clock.date, 1) : null;
}

// Range of due dates [from, to) that count as "newly overdue" now, or null before 09:00.
export function overdueRange(clock: LocalClock): { from: string; to: string } | null {
  if (clock.minutes < OVERDUE_TIME) return null;
  return { from: addDays(clock.date, -OVERDUE_LOOKBACK_DAYS), to: clock.date };
}

// Week (by its Monday) to summarize now, or null if it's not Friday evening.
export function weeklySummaryWeek(clock: LocalClock): string | null {
  return clock.weekday === 4 && clock.minutes >= WEEKLY_SUMMARY_TIME
    ? startOfWeek(clock.date)
    : null;
}
