import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { addDays, formatDay, fromDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { parseTaskFilters } from "@/modules/tasks/filters";
import { listTimeline } from "@/modules/tasks/service";
import { layoutBars, TIMELINE_DAYS, timelineStart } from "@/modules/tasks/timeline";
import { isOverdue } from "@/modules/tasks/today";

const COL = 32; // px per day
const ROW = 36; // px per task row

export default async function TimelinePage({ searchParams }: PageProps<"/tasks/timeline">) {
  const user = await requireUser();
  const params = await searchParams;
  const today = await getUserToday(user.id);
  const { scope } = parseTaskFilters(params);
  const from = timelineStart(params, today);
  const to = addDays(from, TIMELINE_DAYS);
  const { tasks, edges } = await listTimeline(user, scope, from, to);

  const bars = layoutBars(tasks, from);
  const rowOf = new Map(bars.map((bar, index) => [bar.id, index]));
  const days = Array.from({ length: TIMELINE_DAYS }, (_, i) => addDays(from, i));
  const width = TIMELINE_DAYS * COL;
  const height = Math.max(bars.length, 1) * ROW;
  const href = (next: { from?: string; scope?: string }) =>
    `/tasks/timeline?${new URLSearchParams({ from, scope, ...next })}`;
  const todayCol = days.indexOf(today);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label={t("tasks.calendar.prev")}>
          <Link href={href({ from: addDays(from, -7) })}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={href({ from: addDays(today, -7) })}>{t("tasks.calendar.today")}</Link>
        </Button>
        <Button asChild variant="outline" size="icon" aria-label={t("tasks.calendar.next")}>
          <Link href={href({ from: addDays(from, 7) })}>
            <ChevronRight />
          </Link>
        </Button>
        <span className="text-sm font-medium">
          {formatDay(from)} – {formatDay(days.at(-1)!)}
        </span>
        <div className="flex rounded-md border p-0.5 text-sm">
          {(["mine", "team"] as const).map((s) => (
            <Link
              key={s}
              href={href({ scope: s })}
              className={cn("rounded px-3 py-1", s === scope && "bg-secondary font-medium")}
            >
              {s === "mine" ? t("tasks.filters.scopeMine") : t("tasks.filters.scopeTeam")}
            </Link>
          ))}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        {t("tasks.timeline.hint")} {t("tasks.timeline.noDates")}
      </p>

      {bars.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("tasks.empty")}</p>
      ) : (
        <div className="flex overflow-hidden rounded-lg border text-xs">
          {/* Task titles stay in place while the dates scroll sideways. */}
          <div className="bg-background z-10 w-32 shrink-0 border-r md:w-48">
            <div className="h-8 border-b" />
            {bars.map((bar) => {
              const task = tasks.find((x) => x.id === bar.id)!;
              return (
                <Link
                  key={bar.id}
                  href={`/tasks/${task.id}`}
                  className="flex items-center truncate border-b px-2 hover:underline"
                  style={{ height: ROW }}
                  title={task.title}
                >
                  <span className="truncate">{task.title}</span>
                </Link>
              );
            })}
          </div>
          <div className="overflow-x-auto">
            <div style={{ width }} className="relative">
              <div className="flex h-8 border-b">
                {days.map((day) => {
                  const weekend = [0, 6].includes(fromDateString(day).getUTCDay());
                  return (
                    <div
                      key={day}
                      style={{ width: COL }}
                      className={cn(
                        "flex items-center justify-center border-r",
                        weekend && "bg-muted",
                        day === today && "text-primary font-bold",
                      )}
                    >
                      {Number(day.slice(8))}
                    </div>
                  );
                })}
              </div>
              <div className="relative" style={{ height }}>
                {todayCol >= 0 && (
                  <div
                    className="bg-primary/40 absolute top-0 bottom-0 w-0.5"
                    style={{ left: todayCol * COL + COL / 2 }}
                  />
                )}
                {bars.map((bar, index) => {
                  const task = tasks.find((x) => x.id === bar.id)!;
                  return (
                    <Link
                      key={bar.id}
                      href={`/tasks/${task.id}`}
                      title={task.title}
                      className={cn(
                        "absolute flex items-center overflow-hidden rounded px-1.5 text-white",
                        task.status === "DONE"
                          ? "bg-emerald-500"
                          : isOverdue(task, today)
                            ? "bg-destructive"
                            : "bg-blue-500",
                        task.openBlockers > 0 && "ring-2 ring-amber-400",
                        bar.clippedStart && "rounded-l-none",
                        bar.clippedEnd && "rounded-r-none",
                      )}
                      style={{
                        left: bar.startCol * COL + 2,
                        width: bar.span * COL - 4,
                        top: index * ROW + 6,
                        height: ROW - 12,
                      }}
                    >
                      <span className="truncate">{task.title}</span>
                    </Link>
                  );
                })}
                <svg
                  className="pointer-events-none absolute inset-0"
                  width={width}
                  height={height}
                  aria-hidden
                >
                  <defs>
                    <marker
                      id="arrow"
                      markerWidth="8"
                      markerHeight="8"
                      refX="7"
                      refY="4"
                      orient="auto"
                    >
                      <path d="M0,0 L8,4 L0,8 z" className="fill-amber-500" />
                    </marker>
                  </defs>
                  {edges.map((edge) => {
                    const fromRow = rowOf.get(edge.blockerId);
                    const toRow = rowOf.get(edge.blockedId);
                    if (fromRow === undefined || toRow === undefined) return null;
                    const a = bars[fromRow];
                    const b = bars[toRow];
                    const x1 = (a.startCol + a.span) * COL - 2;
                    const y1 = fromRow * ROW + ROW / 2;
                    const x2 = b.startCol * COL + 2;
                    const y2 = toRow * ROW + ROW / 2;
                    const mid = Math.max(x1 + 8, (x1 + x2) / 2);
                    return (
                      <path
                        key={`${edge.blockerId}-${edge.blockedId}`}
                        d={`M${x1},${y1} H${mid} V${y2} H${x2}`}
                        fill="none"
                        strokeWidth="1.5"
                        className="stroke-amber-500"
                        markerEnd="url(#arrow)"
                      />
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
