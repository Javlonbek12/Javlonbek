import { TaskForm } from "@/components/tasks/task-form";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { isApprover } from "@/modules/tasks/access";
import { getTaskFormOptions } from "@/modules/tasks/form-options";

import { createTaskAction } from "../actions";

export default async function NewTaskPage({ searchParams }: PageProps<"/tasks/new">) {
  const user = await requireUser();
  const { due } = await searchParams;
  const options = await getTaskFormOptions(user);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{t("tasks.newTask")}</h2>
      <TaskForm
        action={createTaskAction}
        isNew
        canApprove={isApprover(user.role)}
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
