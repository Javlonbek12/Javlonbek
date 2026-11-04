import { notFound } from "next/navigation";

import { TaskForm } from "@/components/tasks/task-form";
import { toDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getTaskFormOptions } from "@/modules/tasks/form-options";
import { getTaskDetail } from "@/modules/tasks/service";

import { updateTaskAction } from "../../actions";

export default async function EditTaskPage({ params }: PageProps<"/tasks/[id]/edit">) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await getTaskDetail(user, id);
  if (!detail || !detail.canEdit) notFound();
  const { task } = detail;
  // A stopped or finished series shows as "don't repeat".
  const series = task.series?.nextDate ? task.series : null;
  const options = await getTaskFormOptions(user);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{t("tasks.edit")}</h2>
      <TaskForm
        action={updateTaskAction}
        isNew={false}
        initial={{
          taskId: task.id,
          title: task.title,
          description: task.description ?? "",
          isPersonal: task.isPersonal ? "on" : "",
          assigneeId: task.assigneeId,
          startDate: task.startDate ?? "",
          dueDate: task.dueDate ?? "",
          priority: task.priority,
          project: task.project ?? "",
          planId: task.planId ?? "",
          estimateHours: task.estimateMinutes === null ? "" : String(task.estimateMinutes / 60),
          repeat: series?.frequency ?? "",
          repeatInterval: series ? String(series.interval) : "",
          repeatDay: series ? series.weekdays.join(",") : "",
          repeatMonthDay: series?.monthDay ? String(series.monthDay) : "",
          repeatUntil: series?.until ? toDateString(series.until) : "",
        }}
        {...options}
      />
    </div>
  );
}
