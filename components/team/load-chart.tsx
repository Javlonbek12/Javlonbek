import { addDays, formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { WeekLoad } from "@/modules/team/stats";

// Weekly load: one bar per week (tasks due that week), current week in the accent step.
// Single series → no legend; the title names it. Colors: blue ramp, validated
// (light: 250 / 450 on #fcfcfb; dark: 600 / 400 on #1a1a19) with the dataviz validator.
export function LoadChart({ weeks, compact = false }: { weeks: WeekLoad[]; compact?: boolean }) {
  const max = Math.max(1, ...weeks.map((w) => w.tasks));
  const height = compact ? 32 : 72;
  const label = (w: WeekLoad) =>
    `${formatDay(w.weekStart)} – ${formatDay(addDays(w.weekStart, 6))}: ${t("team.stats.loadTooltip", { tasks: w.tasks, hours: w.hours })}`;

  const current = weeks.find((w) => w.current);

  return (
    <figure className="flex flex-col gap-1">
      {compact ? (
        // The small chart on the team page says what it is and the current number in words.
        <figcaption className="text-muted-foreground flex justify-between gap-2 text-[11px]">
          <span>{t("team.stats.loadShort")}</span>
          {current && (
            <span className="text-foreground font-medium">
              {t("team.stats.thisWeekTasks", { tasks: current.tasks })}
            </span>
          )}
        </figcaption>
      ) : (
        <figcaption className="text-muted-foreground text-xs">{t("team.stats.load")}</figcaption>
      )}
      <div className="flex items-end gap-0.5" style={{ height }} aria-hidden>
        {weeks.map((w) => (
          <div
            key={w.weekStart}
            tabIndex={compact ? undefined : 0}
            // Hover shows the week's numbers on the small chart too.
            title={compact ? label(w) : undefined}
            className="group relative flex h-full flex-1 items-end outline-none"
          >
            {/* Selective direct label: only the current week's value. */}
            {!compact && w.current && (
              <span className="text-foreground absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-medium">
                {w.tasks}
              </span>
            )}
            <div
              className={cn(
                "w-full rounded-t-[4px]",
                w.current ? "bg-[#2a78d6] dark:bg-[#3987e5]" : "bg-[#86b6ef] dark:bg-[#184f95]",
              )}
              // Zero weeks keep a 2px stub so the baseline stays readable.
              style={{ height: w.tasks === 0 ? 2 : `${(w.tasks / max) * 100}%` }}
            />
            {!compact && (
              <span
                role="tooltip"
                className="bg-popover text-popover-foreground pointer-events-none absolute bottom-full left-1/2 z-10 mb-5 hidden -translate-x-1/2 rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-sm group-hover:block group-focus:block"
              >
                {label(w)}
              </span>
            )}
          </div>
        ))}
      </div>
      {!compact && (
        <div className="text-muted-foreground flex justify-between text-[10px]">
          <span>{formatDay(weeks[0].weekStart)}</span>
          <span>{t("team.stats.thisWeek")}</span>
          <span>{formatDay(weeks.at(-1)!.weekStart)}</span>
        </div>
      )}
      {/* Table view for screen readers (a table ignores sr-only sizing, so it is wrapped). */}
      <div className="sr-only">
        <table>
          <caption>{t("team.stats.load")}</caption>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.weekStart}>
                <td>{label(w)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
