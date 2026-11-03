import { AlertCircle, CalendarDays, Folder, Lock, Minus, Repeat } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { daysBetween, formatDay } from "@/lib/dates";
import type { TaskPriority } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { displayName } from "@/modules/core/users/display-name";
import type { TaskView } from "@/modules/tasks/service";
import { isOverdue } from "@/modules/tasks/today";

import { StatusBadge } from "./task-badges";

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  URGENT: "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300",
  HIGH: "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300",
  MEDIUM: "bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300",
  LOW: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
};

export const initials = (person: { firstName: string; lastName?: string | null }) =>
  `${person.firstName.charAt(0)}${person.lastName?.charAt(0) ?? ""}`.toUpperCase();

// One task in the list: title with badges and a line of the description, the due date (with
// "overdue by N days" / "in N days"), importance, project and the assignee.
export function TaskTableRow({ task, today }: { task: TaskView; today: string }) {
  const overdue = isOverdue(task, today);
  const days = task.dueDate ? daysBetween(today, task.dueDate) : null;
  return (
    <li
      className={cn(
        "bg-card shadow-card hover:border-primary/30 relative rounded-2xl border transition-colors",
        overdue && "border-l-destructive border-l-4",
      )}
    >
      <Link
        href={`/tasks/${task.id}`}
        className="grid gap-x-5 gap-y-2.5 p-3.5 md:grid-cols-[minmax(0,1fr)_8.5rem_7.5rem_minmax(0,10rem)_minmax(0,11rem)] md:items-center md:px-5"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{task.title}</span>
            <StatusBadge status={task.status} />
            {task.isPersonal && <Badge variant="outline">{t("tasks.fields.personalShort")}</Badge>}
            {task.seriesId && (
              <Badge variant="outline" title={t("tasks.repeat.title")}>
                <Repeat className="size-3" aria-label={t("tasks.repeat.title")} />
              </Badge>
            )}
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
          </span>
          {task.description && (
            <span className="text-muted-foreground line-clamp-1 text-xs">{task.description}</span>
          )}
        </span>

        <span className="flex flex-wrap items-center gap-2 md:flex-col md:items-start md:gap-1">
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
              <span
                className={cn(
                  "text-[11px]",
                  overdue ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {overdue
                  ? t("tasks.look.overdueBy", { count: -days! })
                  : days === 0
                    ? t("tasks.look.dueToday")
                    : t("tasks.look.inDays", { count: days! })}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          )}
        </span>

        <span>
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

        <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
          {task.project ? (
            <>
              <Folder className="text-primary size-4 shrink-0" />
              <span className="text-foreground truncate">{task.project}</span>
            </>
          ) : (
            "—"
          )}
        </span>

        <span className="flex min-w-0 items-center gap-2.5">
          <span className="bg-secondary text-primary flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold">
            {initials(task.assignee)}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{displayName(task.assignee)}</span>
            <span className="text-muted-foreground text-[11px]">{t("tasks.look.assignee")}</span>
          </span>
        </span>
      </Link>
    </li>
  );
}
