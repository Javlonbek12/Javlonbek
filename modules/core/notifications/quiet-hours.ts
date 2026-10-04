import { minutesOfDayInTimezone } from "@/lib/time";

// Quiet hours are [start, end) in the user's timezone and may cross midnight (22:00–08:00).
export function isInQuietHours(
  now: Date,
  timeZone: string,
  start: number | null,
  end: number | null,
): boolean {
  if (start === null || end === null || start === end) return false;
  const minutes = minutesOfDayInTimezone(now, timeZone);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
