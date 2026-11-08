import { cookies } from "next/headers";

import { KanbanBoard } from "@/components/tasks/kanban-board";
import { ScopeSelect } from "@/components/tasks/scope-filter";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { parseTaskFilters } from "@/modules/tasks/filters";
import { rememberedScope, SCOPE_COOKIE } from "@/modules/tasks/scope-cookie";
import { BOARD_DONE_DAYS, LIST_LIMIT, listBoardTasks } from "@/modules/tasks/service";
import { availableTransitions, needsReason, TEAM_FLOW } from "@/modules/tasks/status";
import { isLateWork } from "@/modules/tasks/today";

// The board: every open task and those done in the last 30 days (cancelled ones are hidden).
export default async function BoardPage({ searchParams }: PageProps<"/tasks/board">) {
  const user = await requireUser();
  const params = await searchParams;
  const remembered = rememberedScope((await cookies()).get(SCOPE_COOKIE)?.value, user.id);
  const filters = parseTaskFilters({ ...params, scope: params.scope ?? remembered });
  const today = await getUserToday(user.id);
  const { tasks, cut } = await listBoardTasks(user, filters, today);

  return (
    <div className="flex flex-col gap-3">
      <form className="flex gap-2">
        <ScopeSelect value={filters.scope} />
        <Button type="submit" variant="secondary">
          {t("tasks.filters.apply")}
        </Button>
      </form>
      <p className="text-muted-foreground text-xs">
        {t("tasks.kanban.shown", { days: BOARD_DONE_DAYS })}
      </p>
      {cut && (
        <p className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          {t("tasks.look.cut", { count: LIST_LIMIT })}
        </p>
      )}
      <KanbanBoard
        key={tasks.map((task) => `${task.id}:${task.status}`).join(",")}
        columns={TEAM_FLOW}
        initialCards={tasks.map((task) => {
          const transitions = availableTransitions(user, task);
          return {
            id: task.id,
            title: task.title,
            status: task.status,
            assigneeName: displayName(task.assignee),
            dueDate: task.dueDate,
            overdue: isLateWork(task, today),
            blocked: task.openBlockers > 0,
            transitions,
            // Moves that need words: a reason (declining, sending back), or accepting although a
            // blocking task was cancelled.
            reasonFor: transitions.filter((to) => needsReason(user, task, to)),
            despiteCancelled: !task.isPersonal && task.cancelledBlockers > 0,
          };
        })}
      />
    </div>
  );
}
