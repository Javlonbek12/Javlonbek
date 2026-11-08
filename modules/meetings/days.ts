import { addDays, fromDateString } from "@/lib/dates";
import { dateFormat, t } from "@/lib/i18n";

// The meetings list by day: «Сегодня · четверг, 8 ноября», «Завтра · пятница, 9 ноября»,
// «понедельник, 12 ноября»; the year only when it is not this year.
export function dayHeading(day: string, today: string): string {
  const date = dateFormat({
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
  }).format(fromDateString(day));
  if (day === today) return `${t("meetings.day.today")} · ${date}`;
  if (day === addDays(today, 1)) return `${t("meetings.day.tomorrow")} · ${date}`;
  return date;
}

export type SeriesStep = "week" | "twoWeeks" | "month";

// How often a series repeats, from two of its meetings in a row.
export function seriesStep(first: Date, second: Date): SeriesStep | null {
  const days = Math.round((second.getTime() - first.getTime()) / 86_400_000);
  if (days === 7) return "week";
  if (days === 14) return "twoWeeks";
  if (days >= 28 && days <= 31) return "month";
  return null;
}

type Listed = { id: string; seriesId: string | null; startsAt: Date };

// A series shows once, as its first meeting in the list, with how many follow and until when
// («каждую неделю · ещё 5 до 15 дек.»), instead of six identical cards.
export function collapseSeries<T extends Listed>(meetings: T[]) {
  const seen = new Set<string>();
  const rows: { meeting: T; step: SeriesStep | null; more: number; last: Date | null }[] = [];
  for (const meeting of meetings) {
    if (!meeting.seriesId) {
      rows.push({ meeting, step: null, more: 0, last: null });
      continue;
    }
    if (seen.has(meeting.seriesId)) continue;
    seen.add(meeting.seriesId);
    const series = meetings.filter((m) => m.seriesId === meeting.seriesId);
    rows.push({
      meeting,
      step: series[1] ? seriesStep(series[0]!.startsAt, series[1].startsAt) : null,
      more: series.length - 1,
      last: series.length > 1 ? series.at(-1)!.startsAt : null,
    });
  }
  return rows;
}
