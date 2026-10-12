import { dateFormat } from "@/lib/i18n";

// Minutes from midnight (0..1439) of `date` in the given IANA timezone.
export function minutesOfDayInTimezone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  return hour * 60 + minute;
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// "HH:MM" -> minutes from midnight, or null for empty / invalid input.
export function parseTimeOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatTimeOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatDate(date: Date, timeZone: string): string {
  return dateFormat({ timeZone, day: "numeric", month: "long", year: "numeric" }).format(date);
}

export function formatDateTime(date: Date, timeZone: string): string {
  return dateFormat({
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

// Offset of the timezone from UTC at the given moment, in minutes (Tashkent = +300).
function timezoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}

// "2026-10-05T10:00" in the given timezone → the exact moment (Date, UTC inside).
export function zonedLocalToUtc(local: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes handle a daylight-saving change between the guess and the result.
  let result = guess - timezoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  result = guess - timezoneOffsetMinutes(new Date(result), timeZone) * 60_000;
  return new Date(result);
}

// The moment as "YYYY-MM-DDTHH:mm" in the timezone (for <input type="datetime-local">).
export function utcToZonedLocal(date: Date, timeZone: string): string {
  const shifted = new Date(date.getTime() + timezoneOffsetMinutes(date, timeZone) * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function formatTime(date: Date, timeZone: string): string {
  return dateFormat({ timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    date,
  );
}
