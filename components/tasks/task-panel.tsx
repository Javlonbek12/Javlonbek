import { t } from "@/lib/i18n";
import type { Actor } from "@/modules/core/permissions";

import { TaskDetail } from "./task-detail";

// The task opened next to a list (?task=…). As in the owner's layout: the panel lies over the
// right side of the list, which keeps its columns; on a phone it takes the whole screen.
export function TaskPanel({
  user,
  taskId,
  base,
  closeHref,
  params,
}: {
  user: Actor & { id: string };
  taskId: string;
  // The list with this task open: forms come back here.
  base: string;
  // The list without the task.
  closeHref: string;
  params: Record<string, string | string[] | undefined>;
}) {
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);
  return (
    <aside
      aria-label={t("tasks.panel.title")}
      className="bg-background md:bg-card fixed inset-0 z-50 overflow-y-auto overscroll-contain md:inset-y-3 md:right-3 md:left-auto md:w-[30rem] md:rounded-2xl md:border md:shadow-2xl lg:w-[32rem]"
    >
      <TaskDetail
        user={user}
        taskId={taskId}
        variant="panel"
        base={base}
        tab={one("tab")}
        error={one("error")}
        notice={one("notice")}
        closeHref={closeHref}
      />
    </aside>
  );
}
