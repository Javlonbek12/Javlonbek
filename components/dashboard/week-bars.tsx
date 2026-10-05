import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";

// Done tasks per week: the current week is highlighted, earlier weeks are muted.
export function WeekBars({ weeks }: { weeks: { start: string; count: number }[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.count));
  return (
    <div className="flex h-36 items-end gap-1.5">
      {weeks.map((week, i) => {
        const current = i === weeks.length - 1;
        return (
          <div
            key={week.start}
            className="flex h-full flex-1 flex-col items-center justify-end gap-1"
            title={t("home.dashboard.weekTip", { date: formatDay(week.start), count: week.count })}
          >
            <span
              className={current ? "text-xs font-semibold" : "text-muted-foreground text-[10px]"}
            >
              {week.count > 0 || current ? week.count : ""}
            </span>
            <div
              className="w-full max-w-7 rounded-t-[4px]"
              style={{
                height: `${Math.max(3, (week.count / max) * 96)}px`,
                background: current
                  ? "linear-gradient(180deg, var(--series-7), var(--series-1))"
                  : "var(--muted)",
              }}
            />
            <span className="text-muted-foreground text-[10px] whitespace-nowrap">
              {formatDay(week.start).replace(/\.$/, "")}
            </span>
          </div>
        );
      })}
    </div>
  );
}
