import { undoQuickAction } from "@/app/(app)/tasks/actions";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import type { Actor } from "@/modules/core/permissions";
import { canViewTask, isDoer } from "@/modules/tasks/access";
import { withParams } from "@/modules/tasks/back";
import { canReopen } from "@/modules/tasks/service";

// After the round button in a list (?done=<taskId>): what it did, with «Вернуть» to undo a click
// too many — work handed in comes back from review, a closed task back to work.
export async function QuickUndo({
  user,
  taskId,
  back,
}: {
  user: Actor & { id: string };
  taskId: string | null;
  // The list without ?done.
  back: string;
}) {
  if (!taskId) return null;
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canViewTask(user, task)) return null;
  if (task.status !== "IN_REVIEW" && task.status !== "DONE") return null;
  const undoable = task.status === "IN_REVIEW" ? isDoer(user, task) : canReopen(user, task);
  return (
    <form
      action={undoQuickAction}
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300"
    >
      <input type="hidden" name="taskId" value={task.id} />
      <input type="hidden" name="back" value={withParams(back, { done: null })} />
      <span className="min-w-0">
        {t(task.status === "IN_REVIEW" ? "tasks.quickDone.IN_REVIEW" : "tasks.quickDone.DONE", {
          title: task.title,
        })}
      </span>
      {undoable && (
        <Button type="submit" size="sm" variant="outline">
          {t("tasks.quickDone.undo")}
        </Button>
      )}
    </form>
  );
}
