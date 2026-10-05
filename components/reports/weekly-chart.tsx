import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { Report } from "@/modules/reports/data";

// Tasks created vs completed per week: grouped bars, two series → legend + direct labels on
// the latest week only. Colors: dataviz reference palette slots 1–2, validated for both modes
// (light #2a78d6 / #eb6834 on #fcfcfb; dark #3987e5 / #d95926 on #1a1a19).
const SERIES = [
  { key: "created", label: "reports.chart.created", className: "bg-[#2a78d6] dark:bg-[#3987e5]" },
  {
    key: "completed",
    label: "reports.chart.completed",
    className: "bg-[#eb6834] dark:bg-[#d95926]",
  },
] as const;

export function WeeklyChart({ weeks }: { weeks: Report["weeks"] }) {
  const max = Math.max(1, ...weeks.flatMap((w) => [w.created, w.completed]));
  const step = Math.max(1, Math.ceil(max / 4));
  const top = step * 4;
  const tooltip = (w: Report["weeks"][number]) =>
    t("reports.chart.tooltip", {
      date: formatDay(w.weekStart),
      created: w.created,
      completed: w.completed,
    });

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="font-medium">{t("reports.chart.title")}</figcaption>
        <div className="text-muted-foreground flex gap-4 text-xs">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-[2px] ${s.className}`} />
              {t(s.label)}
            </span>
          ))}
        </div>
      </div>
      <div className="relative h-48" aria-hidden>
        {/* Recessive gridlines with values. */}
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="absolute inset-x-0 flex items-center gap-1"
            style={{ bottom: `${(i / 4) * 100}%` }}
          >
            <span className="text-muted-foreground w-6 translate-y-1/2 text-right text-[10px] tabular-nums">
              {step * i}
            </span>
            <div className={`h-px flex-1 ${i === 0 ? "bg-border" : "bg-border/50"}`} />
          </div>
        ))}
        <div className="absolute inset-y-0 right-0 left-7 flex items-end">
          {weeks.map((w, i) => (
            <div
              key={w.weekStart}
              tabIndex={0}
              className="group relative flex h-full flex-1 items-end justify-center gap-[2px] outline-none"
            >
              {SERIES.map((s) => {
                const value = w[s.key];
                return (
                  <div key={s.key} className="relative flex h-full w-[38%] max-w-4 items-end">
                    {i === weeks.length - 1 && (
                      <span
                        className="text-foreground absolute left-1/2 -translate-x-1/2 text-[10px] font-medium"
                        style={{ bottom: `calc(${(value / top) * 100}% + 2px)` }}
                      >
                        {value}
                      </span>
                    )}
                    <div
                      className={`w-full rounded-t-[4px] ${s.className}`}
                      style={{ height: value === 0 ? 2 : `${(value / top) * 100}%` }}
                    />
                  </div>
                );
              })}
              <span
                role="tooltip"
                className="bg-popover text-popover-foreground pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-sm group-hover:block group-focus:block"
              >
                {tooltip(w)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="text-muted-foreground ml-7 flex text-[10px]">
        {weeks.map((w, i) => {
          const fromEnd = weeks.length - 1 - i;
          // Phones: every third date; wider screens: every other one when dense.
          const wide = weeks.length <= 8 || fromEnd % 2 === 0;
          const narrow = fromEnd % 3 === 0;
          return (
            <span key={w.weekStart} className="flex-1 text-center">
              {wide && (
                <span className={narrow ? undefined : "hidden sm:inline"}>
                  {formatDay(w.weekStart)}
                </span>
              )}
            </span>
          );
        })}
      </div>
      <div className="sr-only">
        <table>
          <caption>{t("reports.chart.title")}</caption>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.weekStart}>
                <td>{tooltip(w)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
