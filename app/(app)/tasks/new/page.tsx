import { TaskForm } from "@/components/tasks/task-form";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { getTaskFormOptions } from "@/modules/tasks/form-options";
import { routeHints } from "@/modules/tasks/route-hints";

import { createTaskAction } from "../actions";

export default async function NewTaskPage({ searchParams }: PageProps<"/tasks/new">) {
  const user = await requireUser();
  const { due } = await searchParams;
  const [options, routes, today] = await Promise.all([
    getTaskFormOptions(user),
    routeHints(user.id),
    getUserToday(user.id),
  ]);

  return (
    <div className="flex flex-col gap-3">
      {/* On a phone the title is in the short header above (← Назад). */}
      <h2 className="hidden text-lg font-medium md:block">{t("tasks.newTask")}</h2>
      <TaskForm
        action={createTaskAction}
        isNew
        routes={routes}
        today={today}
        initial={{
          assigneeId: user.id,
          priority: "MEDIUM",
          dueDate: typeof due === "string" ? due : "",
        }}
        {...options}
      />
    </div>
  );
}
