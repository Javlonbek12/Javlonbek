import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";

// Done tasks per week: the current week is highlighted, earlier weeks are muted.
export function WeekBars({ weeks }: { weeks: { start: string; count: number }[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.count));
  return (
    <div className="flex h-44 items-end gap-2">
      {weeks.map((week, i) => {
        const current = i === weeks.length - 1;
        return (
          <div
            key={week.start}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
            title={t("home.dashboard.weekTip", { date: formatDay(week.start), count: week.count })}
          >
            <span className={current ? "text-xs font-bold" : "text-muted-foreground text-[11px]"}>
              {week.count}
            </span>
            <div
              className="w-full max-w-10 rounded-t-md"
              style={{
                height: `${Math.max(4, (week.count / max) * 112)}px`,
                background: current
                  ? "linear-gradient(180deg, oklch(0.62 0.2 270), var(--primary))"
                  : "color-mix(in oklch, var(--muted-foreground) 16%, var(--card))",
                boxShadow: current ? "0 8px 18px -8px var(--primary)" : undefined,
              }}
            />
            {/* With many weeks every other date, so labels fit on phones. */}
            <span className="text-muted-foreground text-[11px] whitespace-nowrap">
              {weeks.length <= 6 || (weeks.length - 1 - i) % 2 === 0
                ? formatDay(week.start).replace(/\.$/, "")
                : "\u00a0"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
