import { Lock } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { displayName } from "@/modules/core/users/display-name";
import { isOverdue } from "@/modules/tasks/today";
import type { TaskView } from "@/modules/tasks/service";

import { PriorityBadge, StatusBadge } from "./task-badges";

export function TaskRow({ task, today }: { task: TaskView; today: string }) {
  const overdue = isOverdue(task, today);
  return (
    <Link
      href={`/tasks/${task.id}`}
      className="bg-card hover:bg-accent/50 flex flex-col gap-1.5 rounded-lg border p-3 transition-colors"
    >
      <span className="font-medium">{task.title}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-xs">
        <StatusBadge status={task.status} />
        <PriorityBadge priority={task.priority} />
        {task.isPersonal && <Badge variant="outline">{t("tasks.fields.personalShort")}</Badge>}
        {task.openBlockers > 0 && (
          <Badge variant="outline" className="border-destructive text-destructive">
            <Lock className="size-3" />
            {t("tasks.blocked")}
          </Badge>
        )}
        {task.project && <Badge variant="secondary">{task.project}</Badge>}
      </span>
      <span className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
        {!task.isPersonal && <span>{displayName(task.assignee)}</span>}
        {task.dueDate && (
          <span className={cn(overdue && "text-destructive font-medium")}>
            {t("tasks.fields.dueDate")}: {formatDay(task.dueDate)}
            {overdue && ` · ${t("tasks.overdue")}`}
          </span>
        )}
      </span>
    </Link>
  );
}

export function TaskList({
  tasks,
  today,
  empty,
}: {
  tasks: TaskView[];
  today: string;
  empty?: string;
}) {
  if (tasks.length === 0) {
    return <p className="text-muted-foreground text-sm">{empty ?? t("tasks.empty")}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} today={today} />
      ))}
    </div>
  );
}
