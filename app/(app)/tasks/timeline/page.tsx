import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock3,
  Eye,
  ListChecks,
  OctagonAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { initials } from "@/components/tasks/task-table-row";
import { Button } from "@/components/ui/button";
import { addDays, formatDay, formatMonth, fromDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { parseTaskFilters } from "@/modules/tasks/filters";
import { listTimeline, type TaskView } from "@/modules/tasks/service";
import { layoutBars, TIMELINE_DAYS, timelineStart } from "@/modules/tasks/timeline";
import { isOverdue } from "@/modules/tasks/today";

const MIN_COL = 40; // px per day at least; wider screens stretch the days to the full width
const ROW = 46; // px per task row
const LABEL_COLS = 5; // free days needed to write the title to the right of a bar

// How a task looks on the timeline: its state decides the colour and the icon.
type State = "notStarted" | "inProgress" | "review" | "done" | "overdue";
const STATE: Record<State, { bar: string; dot: string; icon: LucideIcon }> = {
  notStarted: { bar: "bg-slate-400", dot: "bg-slate-400", icon: CircleDashed },
  inProgress: { bar: "bg-orange-500", dot: "bg-orange-500", icon: Clock3 },
  review: { bar: "bg-violet-500", dot: "bg-violet-500", icon: Eye },
  done: { bar: "bg-emerald-500", dot: "bg-emerald-500", icon: CheckCircle2 },
  overdue: { bar: "bg-red-500", dot: "bg-red-500", icon: OctagonAlert },
};
const LEGEND: [State, string][] = [
  ["notStarted", "tasks.look.notStarted"],
  ["inProgress", "tasks.look.inProgress"],
  ["review", "tasks.look.review"],
  ["done", "tasks.look.done"],
  ["overdue", "tasks.look.colorOverdue"],
];
const PILL: Record<State, string> = {
  notStarted: "bg-muted text-muted-foreground",
  inProgress: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  review: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  done: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  overdue: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300",
};

function stateOf(task: TaskView, today: string): State {
  if (task.status === "DONE") return "done";
  if (isOverdue(task, today)) return "overdue";
  if (task.status === "IN_PROGRESS") return "inProgress";
  if (task.status === "IN_REVIEW") return "review";
  return "notStarted";
}

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
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const days = Array.from({ length: TIMELINE_DAYS }, (_, i) => addDays(from, i));
  // Positions in % of the dates area, so the timeline fills any screen.
  const pct = (cols: number) => `${(cols / TIMELINE_DAYS) * 100}%`;
  const height = Math.max(bars.length, 1) * ROW;
  const href = (next: { from?: string; scope?: string }) =>
    `/tasks/timeline?${new URLSearchParams({ from, scope, ...next })}`;
  const todayCol = days.indexOf(today);
  const weekdays = t("tasks.calendar.weekdays").split(",");
  const weekday = (day: string) => (fromDateString(day).getUTCDay() + 6) % 7;

  // Months over the day columns.
  const months: { month: string; span: number }[] = [];
  for (const day of days) {
    const last = months.at(-1);
    if (last && last.month === day.slice(0, 7)) last.span++;
    else months.push({ month: day.slice(0, 7), span: 1 });
  }

  const shown = bars.map((bar) => byId.get(bar.id)!);
  const count = (state: State) => shown.filter((task) => stateOf(task, today) === state).length;
  const share = (n: number) => (shown.length ? Math.round((n / shown.length) * 100) : 0);
  const stats = [
    {
      icon: ListChecks,
      tone: "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300",
      value: shown.length,
      label: t("tasks.look.total"),
      note: null,
    },
    {
      icon: CheckCircle2,
      tone: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-300",
      value: count("done"),
      label: t("tasks.look.done"),
      note: "text-emerald-600",
    },
    {
      icon: Clock3,
      tone: "bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-300",
      value: count("inProgress") + count("review"),
      label: t("tasks.look.inProgress"),
      note: "text-orange-600",
    },
    {
      icon: OctagonAlert,
      tone: "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-300",
      value: count("overdue"),
      label: t("tasks.look.overdue"),
      note: "text-red-600",
    },
    {
      icon: Users,
      tone: "bg-violet-100 text-violet-600 dark:bg-violet-900/50 dark:text-violet-300",
      value: new Set(shown.map((task) => task.assigneeId)).size,
      label: t("tasks.look.people"),
      note: null,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          asChild
          variant="outline"
          size="icon"
          className="bg-card rounded-xl"
          aria-label={t("tasks.calendar.prev")}
        >
          <Link href={href({ from: addDays(from, -7) })}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          size="icon"
          className="bg-card rounded-xl"
          aria-label={t("tasks.calendar.next")}
        >
          <Link href={href({ from: addDays(from, 7) })}>
            <ChevronRight />
          </Link>
        </Button>
        <span className="bg-card shadow-card flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-medium">
          <CalendarDays className="text-primary size-4" />
          {formatDay(from)} – {formatDay(days.at(-1)!)}
        </span>
        <Button asChild variant="outline" className="bg-card h-9 rounded-xl">
          <Link href={href({ from: addDays(today, -7) })}>{t("tasks.calendar.today")}</Link>
        </Button>
        <div className="bg-card shadow-card ml-auto flex rounded-xl border p-1 text-sm">
          {(["mine", "team"] as const).map((s) => (
            <Link
              key={s}
              href={href({ scope: s })}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5",
                s === scope ? "bg-secondary text-primary font-semibold" : "text-muted-foreground",
              )}
            >
              {s === "team" && <Users className="size-4" />}
              {s === "mine" ? t("tasks.filters.scopeMine") : t("tasks.filters.scopeTeam")}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {stats.map(({ icon: Icon, tone, value, label, note }) => (
          <div
            key={label}
            className="bg-card shadow-card flex items-center gap-3 rounded-2xl border p-3 md:p-4"
          >
            <span
              className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", tone)}
            >
              <Icon className="size-5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-xl leading-tight font-bold tabular-nums">{value}</span>
              <span className="text-muted-foreground truncate text-xs">{label}</span>
            </span>
            {note && (
              <span className={cn("text-xs font-semibold", note)}>
                {t("tasks.look.share", { percent: share(value) })}
              </span>
            )}
          </div>
        ))}
      </div>

      {bars.length === 0 ? (
        <p className="text-muted-foreground bg-card rounded-2xl border p-6 text-center text-sm">
          {t("tasks.empty")}
        </p>
      ) : (
        <div className="bg-card shadow-card overflow-hidden rounded-2xl border">
          <div className="flex text-xs">
            {/* Task titles stay in place while the dates scroll sideways. */}
            <div className="bg-card z-10 w-44 shrink-0 border-r md:w-80">
              <div className="flex h-16 items-end border-b px-4 pb-2.5 text-sm font-bold">
                {t("tasks.look.task")}
              </div>
              {bars.map((bar) => {
                const task = byId.get(bar.id)!;
                const state = stateOf(task, today);
                return (
                  <Link
                    key={bar.id}
                    href={`/tasks/${task.id}`}
                    className="hover:bg-accent/40 flex items-center gap-2.5 border-b px-3 md:px-4"
                    style={{ height: ROW }}
                    title={task.title}
                  >
                    <span className={cn("size-2.5 shrink-0 rounded-full", STATE[state].dot)} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{task.title}</span>
                      {task.project && (
                        <span className="text-muted-foreground truncate text-[11px]">
                          {task.project}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "hidden shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold md:block",
                        PILL[state],
                      )}
                    >
                      {state === "overdue"
                        ? t("tasks.look.colorOverdue")
                        : t(`tasks.status.${task.status}`)}
                    </span>
                    <span className="bg-secondary text-primary hidden size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold md:flex">
                      {initials(task.assignee)}
                    </span>
                  </Link>
                );
              })}
            </div>
            <div className="min-w-0 flex-1 overflow-x-auto">
              <div
                style={{ width: `max(100%, ${TIMELINE_DAYS * MIN_COL}px)` }}
                className="relative"
              >
                <div className="flex h-7 border-b">
                  {months.map((m) => (
                    <div
                      key={m.month}
                      style={{ width: pct(m.span) }}
                      className="flex items-center border-r px-2 font-semibold"
                    >
                      <span className="truncate">{formatMonth(`${m.month}-01`)}</span>
                    </div>
                  ))}
                </div>
                <div className="relative flex h-9 border-b">
                  {todayCol >= 0 && (
                    <span
                      className="bg-primary text-primary-foreground absolute -top-6 z-[3] -translate-x-1/2 rounded-md px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
                      style={{ left: pct(todayCol + 0.5) }}
                    >
                      {t("tasks.look.todayMark", { date: formatDay(today) })}
                    </span>
                  )}
                  {days.map((day) => {
                    const weekend = weekday(day) >= 5;
                    return (
                      <div
                        key={day}
                        style={{ width: pct(1) }}
                        className={cn(
                          "flex flex-col items-center justify-center border-r leading-tight",
                          weekend && "bg-red-50/60 text-red-500 dark:bg-red-950/20",
                          day === today && "bg-secondary text-primary font-bold",
                        )}
                      >
                        <span className="font-semibold">{Number(day.slice(8))}</span>
                        <span className="text-[9px] opacity-70">{weekdays[weekday(day)]}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="relative" style={{ height }}>
                  {/* Day grid and weekends. */}
                  <div className="absolute inset-0 flex">
                    {days.map((day) => (
                      <div
                        key={day}
                        style={{ width: pct(1) }}
                        className={cn(
                          "border-border/50 h-full border-r",
                          weekday(day) >= 5 && "bg-muted/40",
                        )}
                      />
                    ))}
                  </div>
                  {bars.map((_, index) => (
                    <div
                      key={index}
                      className="border-border/50 absolute inset-x-0 border-b"
                      style={{ top: (index + 1) * ROW - 1 }}
                    />
                  ))}
                  {todayCol >= 0 && (
                    <div
                      className="bg-primary absolute top-0 bottom-0 z-[1] w-0.5"
                      style={{ left: pct(todayCol + 0.5) }}
                    />
                  )}
                  {bars.map((bar, index) => {
                    const task = byId.get(bar.id)!;
                    const state = stateOf(task, today);
                    const Icon = STATE[state].icon;
                    const labelRight = TIMELINE_DAYS - (bar.startCol + bar.span) >= LABEL_COLS;
                    const dates = `${formatDay(task.startDate ?? task.dueDate!)} – ${formatDay(task.dueDate!)}`;
                    return (
                      <div key={bar.id}>
                        <Link
                          href={`/tasks/${task.id}`}
                          title={`${task.title}\n${dates}`}
                          className={cn(
                            "absolute z-[2] flex items-center gap-1.5 overflow-hidden rounded-lg px-2 text-white shadow-sm",
                            STATE[state].bar,
                            task.openBlockers > 0 && "ring-2 ring-amber-400",
                            bar.clippedStart && "rounded-l-none",
                            bar.clippedEnd && "rounded-r-none",
                          )}
                          style={{
                            left: `calc(${pct(bar.startCol)} + 3px)`,
                            width: `calc(${pct(bar.span)} - 6px)`,
                            top: index * ROW + 8,
                            height: ROW - 16,
                          }}
                        >
                          <Icon className="size-3.5 shrink-0" />
                          {!labelRight && (
                            <span className="truncate font-medium">{task.title}</span>
                          )}
                        </Link>
                        {labelRight && (
                          <span
                            className="pointer-events-none absolute z-[2] flex flex-col leading-tight"
                            style={{
                              left: `calc(${pct(bar.startCol + bar.span)} + 4px)`,
                              top: index * ROW + 7,
                              maxWidth: pct(LABEL_COLS),
                            }}
                          >
                            <span className="truncate font-medium">{task.title}</span>
                            <span className="text-muted-foreground text-[10px]">{dates}</span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {/* "Blocks" arrows: horizontal – vertical – horizontal, in % so they follow the bars. */}
                  <svg
                    className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
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
                      const x1 = pct(a.startCol + a.span);
                      const xm = pct(Math.max(a.startCol + a.span + 0.3, b.startCol - 0.3));
                      const x2 = pct(b.startCol);
                      const y1 = fromRow * ROW + ROW / 2;
                      const y2 = toRow * ROW + ROW / 2;
                      const line = { strokeWidth: 1.5, className: "stroke-amber-500/60" };
                      return (
                        <g key={`${edge.blockerId}-${edge.blockedId}`}>
                          <line x1={x1} y1={y1} x2={xm} y2={y1} {...line} />
                          <line x1={xm} y1={y1} x2={xm} y2={y2} {...line} />
                          <line x1={xm} y1={y2} x2={x2} y2={y2} {...line} markerEnd="url(#arrow)" />
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>
            </div>
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-2 border-t px-4 py-3 text-xs">
            {LEGEND.map(([state, key]) => (
              <span key={state} className="flex items-center gap-1.5">
                <span className={cn("size-2.5 rounded-full", STATE[state].dot)} />
                {t(key as Parameters<typeof t>[0])}
              </span>
            ))}
            <span className="ml-auto">
              {t("tasks.look.shown", { count: bars.length })} · {formatDay(from)} –{" "}
              {formatDay(days.at(-1)!)}
            </span>
          </div>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        {t("tasks.timeline.hint")} {t("tasks.timeline.noDates")}
      </p>
    </div>
  );
}
