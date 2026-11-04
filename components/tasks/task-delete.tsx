import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";
import type { DeleteMode } from "@/modules/tasks/delete-service";

import { deleteTaskAction, requestDeleteTaskAction } from "@/app/(app)/tasks/actions";

// "Delete" on the task page: right away (with one confirming click) or as a request to the manager.
export function TaskDeleteControl({
  taskId,
  mode,
  requested,
  trashDays,
}: {
  taskId: string;
  mode: DeleteMode;
  requested: boolean;
  // A team task deleted right away goes to the bin for this many days (null: a personal task).
  trashDays: number | null;
}) {
  if (mode === "none" || (mode === "request" && requested)) return null;
  const direct = mode === "direct";
  return (
    <details className="relative">
      <summary className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-full px-3 py-1.5 text-sm [&::-webkit-details-marker]:hidden">
        <Trash2 className="size-4" />
        {direct ? t("tasks.remove.button") : t("tasks.remove.requestButton")}
      </summary>
      <div className="bg-card shadow-card absolute left-0 z-30 mt-1 flex w-72 flex-col gap-2 rounded-xl border p-3 text-sm">
        <span className="font-medium">
          {direct ? t("tasks.remove.title") : t("tasks.remove.requestTitle")}
        </span>
        <span className="text-muted-foreground text-xs">
          {!direct
            ? t("tasks.remove.requestHint")
            : trashDays === null
              ? t("tasks.remove.direct")
              : t("tasks.remove.directTeam", { days: trashDays })}
        </span>
        <form
          action={direct ? deleteTaskAction : requestDeleteTaskAction}
          className="flex flex-col gap-2"
        >
          <input type="hidden" name="taskId" value={taskId} />
          {(!direct || trashDays !== null) && (
            <label className="flex flex-col gap-1 text-xs">
              {t("tasks.remove.reason")}
              <Textarea name="reason" rows={2} maxLength={500} />
            </label>
          )}
          <div>
            <Button type="submit" variant="destructive" size="sm">
              {direct ? t("tasks.remove.yes") : t("tasks.remove.send")}
            </Button>
          </div>
        </form>
      </div>
    </details>
  );
}
