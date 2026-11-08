import Link from "next/link";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PERCENT_FROM_TASKS, type EmployeeStats } from "@/modules/team/stats";

// The person's tasks in the task list: open ones, or only the overdue ones.
export const personTasksHref = (userId: string, overdue = false) =>
  `/tasks?${new URLSearchParams({ person: userId, ...(overdue ? { due: "overdue" } : {}) })}`;

// «3 из 3» rather than «100%» while there are few tasks; null — nothing to show.
export function onTimeText(rate: EmployeeStats["onTime30"]) {
  if (rate.percent === null) return null;
  return rate.total < PERCENT_FROM_TASKS
    ? t("team.stats.ofTotal", { onTime: rate.onTime, total: rate.total })
    : `${rate.percent}%`;
}

// «в работе: 8 · просрочено: 3» — each number opens that person's tasks.
export function StatLinks({
  userId,
  stats,
  className,
}: {
  userId: string;
  stats: Pick<EmployeeStats, "active" | "overdue">;
  className?: string;
}) {
  return (
    <span className={cn("flex flex-wrap gap-x-3 gap-y-0.5 text-xs", className)}>
      <Link href={personTasksHref(userId)} className="hover:underline">
        {t("team.org.active", { count: stats.active })}
      </Link>
      {stats.overdue > 0 && (
        <Link
          href={personTasksHref(userId, true)}
          className="text-destructive font-medium hover:underline"
        >
          {t("team.org.overdue", { count: stats.overdue })}
        </Link>
      )}
    </span>
  );
}
