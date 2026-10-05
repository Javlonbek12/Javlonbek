import { daysBetween, formatDay, fromDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";

type Week = { start: string; planned: number; actual: number | null };

const W = 640;
const H = 220;
const PAD = { left: 34, right: 12, top: 12, bottom: 26 };
const monthShort = new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" });

// "Plan vs fact": tasks that should be done by each week's end (dashed) and tasks actually done (solid).
// The gap between the lines is how far the project is behind.
export function BurnUpChart({
  weeks,
  total,
  today,
}: {
  weeks: Week[];
  total: number;
  today: string;
}) {
  if (weeks.length < 2 || total === 0) return null;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  // Each point sits at the end of its week.
  const x = (i: number) => PAD.left + (innerW * (i + 1)) / weeks.length;
  const y = (value: number) => PAD.top + innerH - (innerH * value) / total;
  const line = (values: (number | null)[]) =>
    values
      .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  const start = (points: string) => `${PAD.left},${y(0)} ${points}`;
  const planned = line(weeks.map((w) => w.planned));
  const actual = line(weeks.map((w) => w.actual));
  const firstDay = weeks[0]!.start;
  const span = weeks.length * 7;
  const todayDays = daysBetween(firstDay, today);
  const todayX =
    todayDays >= 0 && todayDays < span ? PAD.left + (innerW * (todayDays + 1)) / span : null;
  const ticks = [0, Math.round(total / 2), total];
  // A month label under the first week starting in that month.
  const months = weeks
    .map((w, i) => ({
      i,
      month: w.start.slice(0, 7),
      label: monthShort.format(fromDateString(w.start)),
    }))
    .filter((w, i, all) => i === 0 || w.month !== all[i - 1]!.month);
  const lastActual = weeks.findLastIndex((w) => w.actual !== null);

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <svg width="20" height="4" aria-hidden>
            <line
              x1="0"
              y1="2"
              x2="20"
              y2="2"
              className="stroke-muted-foreground"
              strokeWidth="2"
              strokeDasharray="4 3"
            />
          </svg>
          {t("projects.burnup.planned")}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="20" height="4" aria-hidden>
            <line x1="0" y1="2" x2="20" y2="2" className="stroke-emerald-500" strokeWidth="2" />
          </svg>
          {t("projects.burnup.actual")}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={t("projects.burnup.title")}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-border"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={y(tick) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {tick}
            </text>
          </g>
        ))}
        {months.map((m) => (
          <text
            key={m.month}
            x={PAD.left + (innerW * m.i) / weeks.length}
            y={H - 8}
            className="fill-muted-foreground text-[11px]"
          >
            {m.label}
          </text>
        ))}
        {todayX !== null && (
          <g>
            <line
              x1={todayX}
              x2={todayX}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="stroke-primary/50"
              strokeWidth="1.5"
            />
            <text x={todayX + 4} y={PAD.top + 10} className="fill-muted-foreground text-[11px]">
              {t("projects.burnup.todayLabel")}
            </text>
          </g>
        )}
        <polyline
          points={start(planned)}
          fill="none"
          className="stroke-muted-foreground"
          strokeWidth="2"
          strokeDasharray="5 4"
          strokeLinejoin="round"
        />
        {lastActual >= 0 && (
          <polyline
            points={start(actual)}
            fill="none"
            className="stroke-emerald-500"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        )}
        {lastActual >= 0 && (
          <circle
            cx={x(lastActual)}
            cy={y(weeks[lastActual]!.actual!)}
            r="4"
            className="stroke-background fill-emerald-500"
            strokeWidth="2"
          />
        )}
        {/* Hover targets: one column per week with a tooltip. */}
        {weeks.map((w, i) => (
          <rect
            key={w.start}
            x={x(i) - innerW / weeks.length}
            y={PAD.top}
            width={innerW / weeks.length}
            height={innerH}
            fill="transparent"
            className="hover:fill-foreground/5"
          >
            <title>
              {w.actual === null
                ? t("projects.burnup.pointPlanned", {
                    date: formatDay(w.start),
                    planned: w.planned,
                  })
                : t("projects.burnup.point", {
                    date: formatDay(w.start),
                    planned: w.planned,
                    actual: w.actual,
                  })}
            </title>
          </rect>
        ))}
      </svg>
    </figure>
  );
}
