import { fromDateString } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import { dateFormat, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { RouteAnalysis, RouteZone } from "@/modules/connect/routes";

import { ToneBar, ToneValue } from "./parts";
import { TsmName } from "./sections";
import { targetTone, TONE_CELL, type Tone } from "./tone";

// «Календарь»: zones down, the period's days across — a cell is a zone's day, coloured against
// the target (after the attendance grid of the Kazakhstan team's dashboard). A TSM's day shows
// the planned visits made and is coloured by attendance; a rep's day shows the visits with an
// order and is coloured by hit rate (reps visit nearly everything, so attendance says little).
// The worst zones come first; the period's share is at the end of the row.

export type CalendarMode = "attendance" | "hitRate";

const share = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

// A day of a zone: its number, its share and the colour.
function cellOf(
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

export function RoutesCalendar({
  analysis,
  mode,
  zones,
  limit,
  href,
}: {
  analysis: RouteAnalysis;
  mode: CalendarMode;
  // The rows, the worst first.
  zones: RouteZone[];
  limit?: number;
  href?: (zone: string) => string;
}) {
  const target = mode === "attendance" ? analysis.targets.attendance : analysis.targets.hitRate;
  const rows = zones.slice(0, limit ?? zones.length);
  // The days anyone shown has something on (a Sunday without routes is not a column).
  const days = [
    ...new Set(rows.flatMap((z) => Object.keys(analysis.calendar[z.zone] ?? {}))),
  ].sort();
  if (!rows.length || !days.length) return null;
  const weekday = dateFormat({ weekday: "short", timeZone: "UTC" });
  const total = (z: RouteZone) => (mode === "attendance" ? z.attendance : z.hitRate);
  return (
    <div className="flex flex-col gap-2">
      <div className="-mx-1 overflow-x-auto px-1 print:overflow-visible">
        <table className="border-separate border-spacing-[2px] text-xs">
          <thead>
            <tr>
              <th className="bg-card sticky left-0 z-10 min-w-36 px-1 text-left align-bottom font-medium">
                {t("connect.routes.col.zone")}
              </th>
              {days.map((day) => {
                const date = fromDateString(day);
                const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
                return (
                  <th
                    key={day}
                    className={cn(
                      "w-7 min-w-7 px-0 text-center font-normal",
                      weekend ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
                    )}
                  >
                    <span className="block text-[10px] leading-tight">{weekday.format(date)}</span>
                    <span className="text-foreground block leading-tight font-medium tabular-nums">
                      {date.getUTCDate()}
                    </span>
                  </th>
                );
              })}
              <th className="min-w-28 px-2 text-left align-bottom font-medium">
                {t(`connect.calendar.total.${mode}`)}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((z) => {
              const tone = targetTone(total(z), target);
              const [part, whole] =
                mode === "attendance" ? [z.visited, z.planned] : [z.orders, z.visits];
              return (
                <tr key={z.zone} className="print:break-inside-avoid">
                  <th className="bg-card sticky left-0 z-10 max-w-44 px-1 py-0.5 text-left font-normal">
                    {href ? (
                      <a href={href(z.zone)} className="hover:text-primary block truncate">
                        <TsmName code={z.zone} name={z.person} />
                      </a>
                    ) : (
                      <TsmName code={z.zone} name={z.person} />
                    )}
                  </th>
                  {days.map((day) => {
                    const cell = cellOf(analysis.calendar[z.zone]?.[day], mode, target);
                    return (
                      <td
                        key={day}
                        title={
                          cell?.of
                            ? `${z.zone} · ${day}: ${cell.of}${cell.rate === null ? "" : ` (${cell.rate}%)`}`
                            : undefined
                        }
                        className={cn(
                          "h-7 w-7 min-w-7 rounded-[5px] p-0 text-center text-[11px] font-medium tabular-nums",
                          cell?.tone
                            ? TONE_CELL[cell.tone]
                            : cell
                              ? "bg-muted text-muted-foreground"
                              : "bg-muted/40",
                        )}
                      >
                        {cell?.text ?? ""}
                      </td>
                    );
                  })}
                  <td className="px-2 py-0.5">
                    <span className="flex items-center gap-2">
                      <span className="w-14 shrink-0">
                        <ToneBar value={total(z) ?? 0} tone={tone} />
                      </span>
                      <ToneValue tone={tone}>
                        {total(z) === null ? "—" : `${formatNumber(total(z)!)}%`}
                      </ToneValue>
                    </span>
                    <span className="text-muted-foreground block text-[10px] tabular-nums">
                      {formatNumber(part)} / {formatNumber(whole)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {(["good", "warn", "bad"] as const).map((tone) => (
          <li key={tone} className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded-[4px]", TONE_CELL[tone])} />
            {t(`connect.calendar.legend.${tone}`, { target })}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="bg-muted/40 size-3 rounded-[4px] border" />
          {t(`connect.calendar.legend.none.${mode}`)}
        </li>
        <li>{t(`connect.calendar.cell.${mode}`)}</li>
      </ul>
      {zones.length > rows.length && (
        <span className="text-muted-foreground text-xs">
          {t("connect.calendar.more", { count: zones.length - rows.length })}
        </span>
      )}
    </div>
  );
}
