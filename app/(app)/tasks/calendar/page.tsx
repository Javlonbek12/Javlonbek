import { CalendarDays, ChevronLeft, ChevronRight, Folder, Lock, Users, Video } from "lucide-react";
import Link from "next/link";

import { Ring } from "@/components/dashboard/ring";
import { TaskTableRow } from "@/components/tasks/task-table-row";
import { Button } from "@/components/ui/button";
import {
  addDays,
  formatDay,
  formatDayLong,
  formatMonth,
  monthGrid,
  startOfMonth,
} from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatTime, utcToZonedLocal, zonedLocalToUtc } from "@/lib/time";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings, getUserToday } from "@/modules/core/settings/service";
import { listMeetingsBetween } from "@/modules/meetings/service";
import {
  calendarRange,
  CALENDAR_MODES,
  parseCalendarParams,
  shiftCalendar,
} from "@/modules/tasks/calendar";
import { parseTaskFilters } from "@/modules/tasks/filters";
import { listTasksDueBetween, type TaskView } from "@/modules/tasks/service";
import { isOverdue } from "@/modules/tasks/today";

type Meeting = Awaited<ReturnType<typeof listMeetingsBetween>>[number];

// Colours of calendar items (the legend on the right lists them).
const KIND = {
  high: { dot: "bg-red-500", box: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200" },
  medium: {
    dot: "bg-amber-500",
    box: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  },
  low: {
    dot: "bg-emerald-500",
    box: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  },
  meeting: {
    dot: "bg-blue-500",
    box: "bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
  },
  personal: {
    dot: "bg-violet-500",
    box: "bg-violet-50 text-violet-900 dark:bg-violet-950/40 dark:text-violet-200",
  },
} as const;
const LEGEND = [
  ["high", "colorUrgent"],
  ["medium", "colorMedium"],
  ["low", "colorLow"],
  ["meeting", "colorMeeting"],
  ["personal", "colorPersonal"],
] as const;

function kindOf(task: TaskView): keyof typeof KIND {
  if (task.isPersonal) return "personal";
  if (task.priority === "URGENT" || task.priority === "HIGH") return "high";
  return task.priority === "LOW" ? "low" : "medium";
}

function TaskItem({ task, today, compact }: { task: TaskView; today: string; compact?: boolean }) {
  const kind = isOverdue(task, today) ? KIND.high : KIND[kindOf(task)];
  const body = (
    <>
      <span className="flex items-center gap-1.5 font-medium">
        <span className={cn("size-1.5 shrink-0 rounded-full", kind.dot)} />
        <span className="truncate">{task.title}</span>
      </span>
      {(task.project || task.isPersonal) && (
        <span className="flex items-center gap-1 truncate pl-3 text-[11px] opacity-75">
          {task.openBlockers > 0 ? <Lock className="size-3" /> : <Folder className="size-3" />}
          <span className="truncate">{task.project ?? t("tasks.fields.personalShort")}</span>
        </span>
      )}
    </>
  );
  const className = cn(
    "flex flex-col gap-0.5 rounded-lg px-2 py-1.5 text-xs",
    kind.box,
    task.status === "DONE" && "line-through opacity-60",
  );
  // Inside a month cell (itself a link) a plain block: links can't nest.
  return compact ? (
    <span className={cn(className, "hidden md:flex")}>{body}</span>
  ) : (
    <Link href={`/tasks/${task.id}`} className={className}>
      {body}
    </Link>
  );
}

function MeetingItem({
  meeting,
  timezone,
  compact,
}: {
  meeting: Meeting;
  timezone: string;
  compact?: boolean;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 font-medium">
        <span className={cn("size-1.5 shrink-0 rounded-full", KIND.meeting.dot)} />
        <span className="shrink-0">{formatTime(meeting.startsAt, timezone)}</span>
        <span className="truncate">{meeting.title}</span>
      </span>
      <span className="flex items-center gap-1 pl-3 text-[11px] opacity-75">
        <Video className="size-3" />
        {t("tasks.look.colorMeeting")}
      </span>
    </>
  );
  const className = cn("flex flex-col gap-0.5 rounded-lg px-2 py-1.5 text-xs", KIND.meeting.box);
  return compact ? (
    <span className={cn(className, "hidden md:flex")}>{body}</span>
  ) : (
    <Link href={`/meetings/${meeting.id}`} className={className}>
      {body}
    </Link>
  );
}

export default async function CalendarPage({ searchParams }: PageProps<"/tasks/calendar">) {
  const user = await requireUser();
  const params = await searchParams;
  const today = await getUserToday(user.id);
  const { mode, date } = parseCalendarParams(params, today);
  const { scope } = parseTaskFilters(params);
  const { days, from, to } = calendarRange(mode, date);
  const { timezone } = await getSettings(user.id);
  const [tasks, todayTasks, meetings] = await Promise.all([
    listTasksDueBetween(user, scope, from, to),
    listTasksDueBetween(user, scope, today, addDays(today, 1)),
    // Meetings: "mine" = I take part; "team" = every meeting I can see.
    listMeetingsBetween(
      user,
      zonedLocalToUtc(`${from}T00:00`, timezone)!,
      zonedLocalToUtc(`${to}T00:00`, timezone)!,
      scope === "mine",
    ),
  ]);
  const meetingsByDay = new Map<string, Meeting[]>();
  for (const m of meetings) {
    const day = utcToZonedLocal(m.startsAt, timezone).slice(0, 10);
    meetingsByDay.set(day, [...(meetingsByDay.get(day) ?? []), m]);
  }
  const byDay = new Map<string, TaskView[]>();
  for (const task of tasks) byDay.set(task.dueDate!, [...(byDay.get(task.dueDate!) ?? []), task]);

  const href = (next: Partial<{ mode: string; date: string; scope: string }>) =>
    `/tasks/calendar?${new URLSearchParams({ mode, date, scope, ...next })}`;
  const title =
    mode === "month"
      ? formatMonth(date)
      : mode === "week"
        ? `${formatDay(from)} – ${formatDay(days[6])}`
        : formatDayLong(date);
  const weekdays = t("tasks.calendar.weekdays").split(",");

  // The numbers of the shown period.
  const done = tasks.filter((x) => x.status === "DONE").length;
  const working = tasks.filter(
    (x) => x.status === "IN_PROGRESS" || x.status === "IN_REVIEW",
  ).length;
  const late = tasks.filter((x) => isOverdue(x, today)).length;
  const share = (n: number) => (tasks.length ? Math.round((n / tasks.length) * 100) : 0);
  const stats = [
    { label: t("tasks.look.total"), value: tasks.length, percent: 100, color: "var(--series-1)" },
    { label: t("tasks.look.done"), value: done, percent: share(done), color: "var(--series-3)" },
    {
      label: t("tasks.look.inProgress"),
      value: working,
      percent: share(working),
      color: "var(--series-4)",
    },
    { label: t("tasks.look.overdue"), value: late, percent: share(late), color: "var(--series-8)" },
  ];

  // The small month on the right: the month of the chosen date.
  const mini = monthGrid(date);
  const miniMonth = startOfMonth(date).slice(0, 7);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px] [&>*]:min-w-0">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className="bg-card shadow-card flex items-center gap-3 rounded-2xl border p-3 md:p-4"
            >
              <Ring
                percent={s.percent}
                color={s.color}
                size={56}
                filled={false}
                label=""
                className="hidden sm:block"
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-xl font-bold tabular-nums md:text-2xl">{s.value}</span>
                <span className="text-muted-foreground truncate text-xs">{s.label}</span>
                {s.percent < 100 && (
                  <span className="text-[11px] font-semibold" style={{ color: s.color }}>
                    {t("tasks.look.share", { percent: s.percent })}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            asChild
            variant="outline"
            size="icon"
            className="bg-card rounded-xl"
            aria-label={t("tasks.calendar.prev")}
          >
            <Link href={href({ date: shiftCalendar(mode, date, -1) })}>
              <ChevronLeft />
            </Link>
          </Button>
          <Button asChild variant="outline" className="bg-card h-9 rounded-xl">
            <Link href={href({ date: today })}>{t("tasks.calendar.today")}</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="icon"
            className="bg-card rounded-xl"
            aria-label={t("tasks.calendar.next")}
          >
            <Link href={href({ date: shiftCalendar(mode, date, 1) })}>
              <ChevronRight />
            </Link>
          </Button>
          <h2 className="ml-1 flex items-center gap-2 text-lg font-bold">
            <CalendarDays className="text-primary size-5" />
            {title}
          </h2>
          <div className="ml-auto flex flex-wrap gap-2">
            <div className="bg-card shadow-card flex rounded-xl border p-1 text-sm">
              {(["mine", "team"] as const).map((s) => (
                <Link
                  key={s}
                  href={href({ scope: s })}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5",
                    s === scope
                      ? "bg-secondary text-primary font-semibold"
                      : "text-muted-foreground",
                  )}
                >
                  {s === "team" && <Users className="size-4" />}
                  {s === "mine" ? t("tasks.filters.scopeMine") : t("tasks.filters.scopeTeam")}
                </Link>
              ))}
            </div>
            <div className="bg-card shadow-card flex rounded-xl border p-1 text-sm">
              {CALENDAR_MODES.map((m) => (
                <Link
                  key={m}
                  href={href({ mode: m })}
                  className={cn(
                    "rounded-lg px-3.5 py-1.5",
                    m === mode
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`tasks.calendar.${m}`)}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {mode === "month" && (
          <div className="bg-card shadow-card overflow-hidden rounded-2xl border">
            <div className="grid grid-cols-7 border-b">
              {weekdays.map((d) => (
                <div
                  key={d}
                  className="text-muted-foreground py-2.5 text-center text-xs font-semibold"
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day, i) => {
                const list = byDay.get(day) ?? [];
                const dayMeetings = meetingsByDay.get(day) ?? [];
                const inMonth = day.slice(0, 7) === date.slice(0, 7);
                const total = list.length + dayMeetings.length;
                const shown = Math.max(0, 3 - dayMeetings.slice(0, 2).length);
                return (
                  <Link
                    key={day}
                    href={href({ mode: "day", date: day })}
                    className={cn(
                      "hover:bg-accent/40 flex min-h-16 flex-col gap-1 border-b p-1.5 md:min-h-32 md:p-2",
                      i % 7 !== 6 && "border-r",
                      !inMonth && "bg-muted/50 text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-7 items-center justify-center self-end rounded-full text-xs font-semibold",
                        day === today && "bg-primary text-primary-foreground",
                      )}
                    >
                      {Number(day.slice(8))}
                    </span>
                    {total > 0 && (
                      <span className="bg-primary/10 text-primary rounded-md px-1 text-center text-[11px] font-semibold md:hidden">
                        {total}
                      </span>
                    )}
                    {dayMeetings.slice(0, 2).map((m) => (
                      <MeetingItem key={m.id} meeting={m} timezone={timezone} compact />
                    ))}
                    {list.slice(0, shown).map((task) => (
                      <TaskItem key={task.id} task={task} today={today} compact />
                    ))}
                    {total > dayMeetings.slice(0, 2).length + shown && (
                      <span className="text-muted-foreground hidden pl-1 text-[11px] md:block">
                        {t("tasks.calendar.more", {
                          count: total - dayMeetings.slice(0, 2).length - shown,
                        })}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {mode === "week" && (
          <div className="bg-card shadow-card grid overflow-hidden rounded-2xl border md:grid-cols-7">
            {days.map((day, i) => (
              <section
                key={day}
                className={cn(
                  "flex min-h-24 flex-col gap-1.5 border-b p-2 md:min-h-96 md:border-b-0",
                  i < 6 && "md:border-r",
                )}
              >
                <Link
                  href={href({ mode: "day", date: day })}
                  className="flex items-center justify-between text-xs font-semibold"
                >
                  <span className="text-muted-foreground">{weekdays[i]}</span>
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full",
                      day === today && "bg-primary text-primary-foreground",
                    )}
                  >
                    {Number(day.slice(8))}
                  </span>
                </Link>
                {(meetingsByDay.get(day) ?? []).map((m) => (
                  <MeetingItem key={m.id} meeting={m} timezone={timezone} />
                ))}
                {(byDay.get(day) ?? []).map((task) => (
                  <TaskItem key={task.id} task={task} today={today} />
                ))}
              </section>
            ))}
          </div>
        )}

        {mode === "day" && (
          <div className="flex flex-col gap-2">
            {(meetingsByDay.get(date) ?? []).map((m) => (
              <MeetingItem key={m.id} meeting={m} timezone={timezone} />
            ))}
            {(byDay.get(date) ?? []).length === 0 && !meetingsByDay.has(date) ? (
              <p className="text-muted-foreground bg-card rounded-2xl border p-6 text-center text-sm">
                {t("tasks.empty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(byDay.get(date) ?? []).map((task) => (
                  <TaskTableRow key={task.id} task={task} today={today} />
                ))}
              </ul>
            )}
            <Button asChild variant="outline" size="sm" className="self-start rounded-xl">
              <Link href={`/tasks/new?due=${date}`}>{t("tasks.newTask")}</Link>
            </Button>
          </div>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        <div className="bg-card shadow-card rounded-2xl border p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-bold">{formatMonth(date)}</span>
            <span className="flex gap-1">
              <Link
                href={href({ date: shiftCalendar("month", date, -1) })}
                aria-label={t("tasks.calendar.prev")}
                className="hover:bg-accent rounded-lg border p-1"
              >
                <ChevronLeft className="size-4" />
              </Link>
              <Link
                href={href({ date: shiftCalendar("month", date, 1) })}
                aria-label={t("tasks.calendar.next")}
                className="hover:bg-accent rounded-lg border p-1"
              >
                <ChevronRight className="size-4" />
              </Link>
            </span>
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
            {weekdays.map((d) => (
              <span key={d} className="text-muted-foreground py-1 font-medium">
                {d}
              </span>
            ))}
            {mini.flat().map((day) => {
              const has = (byDay.get(day)?.length ?? 0) + (meetingsByDay.get(day)?.length ?? 0);
              return (
                <Link
                  key={day}
                  href={href({ mode: "day", date: day })}
                  className="flex flex-col items-center gap-0.5 py-0.5"
                >
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full",
                      day.slice(0, 7) !== miniMonth && "text-muted-foreground/60",
                      day === today && "bg-primary text-primary-foreground font-bold",
                      day === date && day !== today && "bg-secondary text-primary font-semibold",
                    )}
                  >
                    {Number(day.slice(8))}
                  </span>
                  <span
                    className={cn("size-1 rounded-full", has ? "bg-primary" : "bg-transparent")}
                  />
                </Link>
              );
            })}
          </div>
        </div>

        <div className="bg-card shadow-card flex flex-col gap-2.5 rounded-2xl border p-4">
          <div className="flex items-center justify-between">
            <span className="font-bold">{t("tasks.look.todayTasks")}</span>
            <span className="bg-secondary text-primary rounded-lg px-2 py-0.5 text-xs font-bold">
              {todayTasks.length}
            </span>
          </div>
          {todayTasks.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("tasks.look.noTasksToday")}</p>
          ) : (
            todayTasks
              .slice(0, 5)
              .map((task) => <TaskItem key={task.id} task={task} today={today} />)
          )}
          {todayTasks.length > 0 && (
            <Link
              href={href({ mode: "day", date: today })}
              className="text-primary flex items-center gap-1 text-sm font-medium"
            >
              {t("tasks.look.showAll")}
              <ChevronRight className="size-4" />
            </Link>
          )}
        </div>

        <div className="bg-card shadow-card flex flex-col gap-2 rounded-2xl border p-4">
          <span className="font-bold">{t("tasks.look.legend")}</span>
          {LEGEND.map(([kind, label]) => (
            <span key={kind} className="flex items-center gap-2.5 text-sm">
              <span className={cn("size-3 rounded-full", KIND[kind].dot)} />
              {t(`tasks.look.${label}`)}
            </span>
          ))}
        </div>
      </aside>
    </div>
  );
}
