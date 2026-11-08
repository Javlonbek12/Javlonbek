import { todayInTimezone } from "@/lib/dates";

// «2 ч 15 мин»: the i18n key and its values for a number of minutes (the server and the browser
// each translate it with their own t).
export function durationText(minutes: number): {
  key: "tasks.time.hm" | "tasks.time.h" | "tasks.time.m";
  values: Record<string, number>;
} {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return { key: "tasks.time.hm", values: { h, m } };
  if (h > 0) return { key: "tasks.time.h", values: { h } };
  return { key: "tasks.time.m", values: { m } };
}

// After this long a running timer asks «Забыли остановить?» (the owner's decision).
export const FORGOTTEN_TIMER_HOURS = 10;

// A timer that has run more than 10 hours, or since an earlier day where the person is, was most
// likely forgotten: the app asks before writing that time down.
export function isForgottenTimer(startedAt: Date | string, now: Date, timeZone: string) {
  const start = new Date(startedAt);
  if (now.getTime() - start.getTime() > FORGOTTEN_TIMER_HOURS * 3_600_000) return true;
  return todayInTimezone(timeZone, start) < todayInTimezone(timeZone, now);
}

// A running timer as «0:12:34».
export function clockText(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(total / 3600)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}
