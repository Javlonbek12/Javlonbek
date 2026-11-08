import {
  AlertCircle,
  CalendarDays,
  Folder,
  ListChecks,
  Lock,
  Minus,
  Repeat,
  Timer,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { daysBetween, formatDay } from "@/lib/dates";
import type { TaskPriority } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { displayName } from "@/modules/core/users/display-name";
import { isClosed } from "@/modules/tasks/access";
import type { TaskView } from "@/modules/tasks/service";
import { isLateWork } from "@/modules/tasks/today";

import { StatusBadge } from "./task-badges";

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  URGENT: "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300",
  HIGH: "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300",
  MEDIUM: "bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300",
  LOW: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
};

export const initials = (person: { firstName: string; lastName?: string | null }) =>
  `${person.firstName.charAt(0)}${person.lastName?.charAt(0) ?? ""}`.toUpperCase();

// What the date means for this task: «Просрочена на 3 дн.», «Сегодня», «Через 2 дн.» — or, for
// work handed in, «ждёт приёмки» (not overdue); a closed task has no relative date at all.
function dueNote(task: TaskView, today: string) {
  if (task.status === "IN_REVIEW") return { text: t("tasks.look.awaitsAcceptance"), late: false };
  if (!task.dueDate || isClosed(task.status)) return null;
  const days = daysBetween(today, task.dueDate);
  if (isLateWork(task, today))
    return { text: t("tasks.look.overdueBy", { count: -days }), late: true };
  return {
    text: days === 0 ? t("tasks.look.dueToday") : t("tasks.look.inDays", { count: days }),
    late: false,
  };
}

// One task in the list. On a phone, two or three lines: the title, then status · due · assignee
// (empty values are left out, not drawn as «—»). On a wider screen, a table row: title with badges
// and a line of the description, the due date, importance, project and the assignee.
// The list opens the task in the panel next to it (`href`); the round button before the title
// (`circle`) takes the next step towards closing it. `timerRunning`: the viewer's timer runs on it.
export function TaskTableRow({
  task,
  today,
  href,
  circle,
  selected = false,
  timerRunning = false,
}: {
  task: TaskView;
  today: string;
  href?: string;
  circle?: ReactNode;
  selected?: boolean;
  timerRunning?: boolean;
}) {
  const overdue = isLateWork(task, today);
  const note = dueNote(task, today);
  const assignee = (
    <>
      {displayName(task.assignee)}
      {task.coAssigneeIds.length > 0 && (
        <span className="text-muted-foreground font-normal"> +{task.coAssigneeIds.length}</span>
      )}
    </>
  );
  const timer = timerRunning && (
    <span className="text-primary inline-flex items-center gap-1 text-xs font-medium">
      <Timer className="size-3.5" aria-hidden />
      {t("tasks.look.timerRunning")}
    </span>
  );
  return (
    <li
      className={cn(
        "bg-card shadow-card hover:border-primary/30 relative flex items-start rounded-2xl border transition-colors",
        overdue && "border-l-destructive border-l-4",
        selected && "border-primary ring-primary/30 ring-2",
      )}
    >
      {circle && <div className="py-3.5 pl-3 md:self-center md:py-0 md:pl-4">{circle}</div>}
      <Link
        href={href ?? `/tasks/${task.id}`}
        scroll={false}
        aria-current={selected ? "true" : undefined}
        className="grid min-w-0 flex-1 gap-x-5 gap-y-1 p-3 md:grid-cols-[minmax(0,1fr)_8.5rem_7.5rem_minmax(0,10rem)_minmax(0,11rem)] md:items-center md:gap-y-2.5 md:px-5 md:py-3.5"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{task.title}</span>
            <span className="hidden md:inline-flex">
              <StatusBadge status={task.status} />
            </span>
            {task.isPersonal && <Badge variant="outline">{t("tasks.fields.personalShort")}</Badge>}
            {task.seriesId && (
              <Badge variant="outline" title={t("tasks.repeat.title")}>
                <Repeat className="size-3" aria-label={t("tasks.repeat.title")} />
              </Badge>
            )}
            {task.steps.total > 0 && (
              <Badge
                variant="outline"
                className="tabular-nums"
                title={t("tasks.steps.progressLabel", {
                  done: task.steps.done,
                  total: task.steps.total,
                })}
              >
                <ListChecks className="size-3" aria-hidden />
                {task.steps.done}/{task.steps.total}
              </Badge>
            )}
            {task.labels.slice(0, 3).map((label) => (
              <Badge key={label} variant="secondary" className="hidden font-normal md:inline-flex">
                {label}
              </Badge>
            ))}
            {task.openBlockers > 0 && (
              <Badge variant="outline" className="border-destructive text-destructive">
                <Lock className="size-3" />
                {t("tasks.blocked")}
              </Badge>
            )}
            {task.deleteRequestedAt && (
              <Badge variant="outline" className="border-destructive text-destructive">
                {t("tasks.remove.badge")}
              </Badge>
            )}
            <span className="hidden md:inline-flex">{timer}</span>
          </span>
          {task.description && (
            <span className="text-muted-foreground hidden text-xs md:line-clamp-1">
              {task.description}
            </span>
          )}
        </span>

        {/* A phone: one line under the title — status · due · who · the timer. */}
        <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs md:hidden">
          <StatusBadge status={task.status} />
          {task.dueDate && (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                overdue && "text-destructive font-medium",
              )}
            >
              <CalendarDays className="size-3.5" aria-hidden />
              {formatDay(task.dueDate)}
              {note && ` · ${note.text}`}
            </span>
          )}
          {!task.dueDate && task.status === "IN_REVIEW" && note && <span>{note.text}</span>}
          {(task.priority === "HIGH" || task.priority === "URGENT") && (
            <span className="text-destructive inline-flex items-center gap-1">
              <AlertCircle className="size-3.5" aria-hidden />
              {t(`tasks.priority.${task.priority}`)}
            </span>
          )}
          <span className="text-foreground truncate">{assignee}</span>
          {timer}
        </span>

        <span className="hidden flex-col items-start gap-1 md:flex">
          {task.dueDate ? (
            <>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold",
                  overdue
                    ? "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300"
                    : "bg-muted text-foreground",
                )}
              >
                <CalendarDays className="size-3.5" />
                {formatDay(task.dueDate)}
              </span>
              {note && (
                <span
                  className={cn(
                    "text-[11px]",
                    note.late ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {note.text}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground text-xs">{note?.text ?? "—"}</span>
          )}
        </span>

        <span className="hidden md:block">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold",
              PRIORITY_STYLE[task.priority],
            )}
          >
            {task.priority === "LOW" ? (
              <Minus className="size-3.5" />
            ) : (
              <AlertCircle className="size-3.5" />
            )}
            {t(`tasks.priority.${task.priority}`)}
          </span>
        </span>

        <span className="text-muted-foreground hidden min-w-0 items-center gap-2 text-xs md:flex">
          {task.project ? (
            <>
              <Folder className="text-primary size-4 shrink-0" />
              <span className="text-foreground truncate">{task.project}</span>
            </>
          ) : (
            "—"
          )}
        </span>

        <span className="hidden min-w-0 items-center gap-2.5 md:flex">
          <span className="bg-secondary text-primary flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold">
            {initials(task.assignee)}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{assignee}</span>
            <span className="text-muted-foreground text-[11px]">{t("tasks.look.assignee")}</span>
          </span>
        </span>
      </Link>
    </li>
  );
}
