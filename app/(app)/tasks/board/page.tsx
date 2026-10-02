import { KanbanBoard } from "@/components/tasks/kanban-board";
import { ScopeSelect } from "@/components/tasks/scope-filter";
import { Button } from "@/components/ui/button";
import { addDays } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { parseTaskFilters } from "@/modules/tasks/filters";
import { listTasks } from "@/modules/tasks/service";
import { availableTransitions, TEAM_FLOW } from "@/modules/tasks/status";
import { isOverdue } from "@/modules/tasks/today";

export default async function BoardPage({ searchParams }: PageProps<"/tasks/board">) {
  const user = await requireUser();
  const filters = {
    ...parseTaskFilters(await searchParams),
    status: "all" as const,
    due: "any" as const,
  };
  const today = await getUserToday(user.id);
  const recentDone = addDays(today, -30);

  // Cancelled tasks are hidden; done ones only for the last 30 days.
  const tasks = (await listTasks(user, filters, today)).filter(
    (task) =>
      task.status !== "CANCELLED" &&
      (task.status !== "DONE" ||
        (task.completedAt?.toISOString().slice(0, 10) ?? "") >= recentDone),
  );

  return (
    <div className="flex flex-col gap-3">
      <form className="flex gap-2">
        <ScopeSelect value={filters.scope} />
        <Button type="submit" variant="secondary">
          {t("tasks.filters.apply")}
        </Button>
      </form>
      <KanbanBoard
        key={tasks.map((task) => `${task.id}:${task.status}`).join(",")}
        columns={TEAM_FLOW}
        initialCards={tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          assigneeName: displayName(task.assignee),
          dueDate: task.dueDate,
          overdue: isOverdue(task, today),
          blocked: task.openBlockers > 0,
          transitions: availableTransitions(user, task),
        }))}
      />
    </div>
  );
}
