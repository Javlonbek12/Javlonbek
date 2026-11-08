import { db } from "@/lib/db";
import { addDays, formatDay, fromDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { displayName } from "@/modules/core/users/display-name";
import type { Actor } from "@/modules/core/permissions";
import { CLOSED_STATUSES, visibleTasksWhere } from "@/modules/tasks/access";

// Friday summary for the owner and managers: team tasks of their own zone (personal tasks are
// private). Without an actor: the whole team.
export async function weeklySummaryText(
  weekStart: string,
  today: string,
  actor?: Actor,
): Promise<string> {
  const from = fromDateString(weekStart);
  const to = fromDateString(addDays(weekStart, 7));
  const zone = actor ? visibleTasksWhere(actor) : {};
  const teamTasks = await db.task.findMany({
    where: {
      AND: [zone],
      isPersonal: false,
      approvedAt: { not: null },
      OR: [{ status: { notIn: CLOSED_STATUSES } }, { completedAt: { gte: from, lt: to } }],
    },
    select: {
      status: true,
      dueDate: true,
      completedAt: true,
      assignee: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  const pending = await db.task.count({
    where: { AND: [zone], isPersonal: false, status: "PENDING_APPROVAL" },
  });
  // Handed-in work waits for acceptance: it is not overdue (owner's decision, as in the task list).
  const isOverdue = (task: (typeof teamTasks)[number]) =>
    !CLOSED_STATUSES.includes(task.status) &&
    task.status !== "IN_REVIEW" &&
    task.dueDate !== null &&
    task.dueDate < fromDateString(today);

  const done = teamTasks.filter((task) => task.status === "DONE");
  const active = teamTasks.filter((task) => !CLOSED_STATUSES.includes(task.status));
  const people = new Map<string, { name: string; done: number; active: number; overdue: number }>();
  for (const task of teamTasks) {
    const entry = people.get(task.assignee.id) ?? {
      name: displayName(task.assignee),
      done: 0,
      active: 0,
      overdue: 0,
    };
    if (task.status === "DONE") entry.done += 1;
    else if (!CLOSED_STATUSES.includes(task.status)) entry.active += 1;
    if (isOverdue(task)) entry.overdue += 1;
    people.set(task.assignee.id, entry);
  }

  return [
    t("weekly.period", { from: formatDay(weekStart), to: formatDay(addDays(weekStart, 6)) }),
    t("weekly.done", { count: done.length }),
    t("weekly.inProgress", { count: active.length }),
    t("weekly.overdue", { count: teamTasks.filter(isOverdue).length }),
    t("weekly.pending", { count: pending }),
    "",
    ...[...people.values()]
      .sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name))
      .map((p) => t("weekly.person", p)),
  ].join("\n");
}
