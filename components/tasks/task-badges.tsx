import { Badge } from "@/components/ui/badge";
import type { TaskPriority, TaskStatus } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<TaskStatus, string> = {
  DRAFT: "bg-secondary text-secondary-foreground",
  PENDING_APPROVAL: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  APPROVED: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  IN_PROGRESS: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  IN_REVIEW: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100",
  DONE: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  CANCELLED: "bg-muted text-muted-foreground line-through",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", STATUS_COLORS[status])}>
      {t(`tasks.status.${status}`)}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === "MEDIUM") return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        priority === "URGENT" && "border-destructive text-destructive",
        priority === "HIGH" && "border-orange-500 text-orange-700 dark:text-orange-300",
      )}
    >
      {t(`tasks.priority.${priority}`)}
    </Badge>
  );
}
