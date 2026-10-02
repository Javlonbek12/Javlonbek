import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { TaskList } from "@/components/tasks/task-row";
import { Button } from "@/components/ui/button";
import { formatDay, formatDayLong, formatMonth } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import {
  calendarRange,
  CALENDAR_MODES,
  parseCalendarParams,
  shiftCalendar,
} from "@/modules/tasks/calendar";
import { parseTaskFilters } from "@/modules/tasks/filters";
import { listTasksDueBetween, type TaskView } from "@/modules/tasks/service";
import { isOverdue } from "@/modules/tasks/today";

export default async function CalendarPage({ searchParams }: PageProps<"/tasks/calendar">) {
  const user = await requireUser();
  const params = await searchParams;
  const today = await getUserToday(user.id);
  const { mode, date } = parseCalendarParams(params, today);
  const { scope } = parseTaskFilters(params);
  const { days, from, to } = calendarRange(mode, date);
  const tasks = await listTasksDueBetween(user, scope, from, to);

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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          {CALENDAR_MODES.map((m) => (
            <Link
              key={m}
              href={href({ mode: m })}
              className={cn(
                "rounded px-3 py-1 text-sm",
                m === mode ? "bg-primary text-primary-foreground" : "",
              )}
            >
              {t(`tasks.calendar.${m}`)}
            </Link>
          ))}
        </div>
        <div className="flex rounded-md border p-0.5 text-sm">
          {(["mine", "team"] as const).map((s) => (
            <Link
              key={s}
              href={href({ scope: s })}
              className={cn("rounded px-3 py-1", s === scope ? "bg-secondary font-medium" : "")}
            >
              {s === "mine" ? t("tasks.filters.scopeMine") : t("tasks.filters.scopeTeam")}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label={t("tasks.calendar.prev")}>
          <Link href={href({ date: shiftCalendar(mode, date, -1) })}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={href({ date: today })}>{t("tasks.calendar.today")}</Link>
        </Button>
        <Button asChild variant="outline" size="icon" aria-label={t("tasks.calendar.next")}>
          <Link href={href({ date: shiftCalendar(mode, date, 1) })}>
            <ChevronRight />
          </Link>
        </Button>
        <h2 className="ml-1 text-lg font-medium">{title}</h2>
      </div>

      {mode === "month" && (
        <div className="bg-border grid grid-cols-7 gap-px overflow-hidden rounded-lg border text-xs">
          {weekdays.map((d) => (
            <div key={d} className="bg-muted px-1 py-1 text-center font-medium">
              {d}
            </div>
          ))}
          {days.map((day) => {
            const list = byDay.get(day) ?? [];
            const inMonth = day.slice(0, 7) === date.slice(0, 7);
            return (
              <Link
                key={day}
                href={href({ mode: "day", date: day })}
                className={cn(
                  "bg-background flex min-h-14 flex-col gap-0.5 p-1 md:min-h-24",
                  !inMonth && "text-muted-foreground bg-muted/40",
                )}
              >
                <span
                  className={cn(
                    "self-end rounded-full px-1.5",
                    day === today && "bg-primary text-primary-foreground",
                  )}
                >
                  {Number(day.slice(8))}
                </span>
                {list.length > 0 && (
                  <span className="bg-primary/10 rounded px-1 text-center font-medium md:hidden">
                    {list.length}
                  </span>
                )}
                {list.slice(0, 3).map((task) => (
                  <span
                    key={task.id}
                    className={cn(
                      "hidden truncate rounded px-1 md:block",
                      isOverdue(task, today)
                        ? "bg-destructive/10 text-destructive"
                        : "bg-primary/10",
                      task.status === "DONE" && "line-through opacity-60",
                    )}
                  >
                    {task.title}
                  </span>
                ))}
                {list.length > 3 && (
                  <span className="text-muted-foreground hidden md:block">
                    {t("tasks.calendar.more", { count: list.length - 3 })}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {mode === "week" && (
        <div className="flex flex-col gap-3 md:grid md:grid-cols-7 md:gap-2">
          {days.map((day, i) => (
            <section key={day} className="flex flex-col gap-2">
              <Link
                href={href({ mode: "day", date: day })}
                className={cn("text-sm font-medium", day === today && "text-primary underline")}
              >
                {weekdays[i]}, {formatDay(day)}
              </Link>
              <TaskList tasks={byDay.get(day) ?? []} today={today} empty="—" />
            </section>
          ))}
        </div>
      )}

      {mode === "day" && (
        <div className="flex flex-col gap-2">
          <TaskList tasks={byDay.get(date) ?? []} today={today} />
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link href={`/tasks/new?due=${date}`}>{t("tasks.newTask")}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
