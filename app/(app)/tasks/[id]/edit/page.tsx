import { notFound } from "next/navigation";

import { TaskForm } from "@/components/tasks/task-form";
import { toDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { getTaskFormOptions } from "@/modules/tasks/form-options";
import { routeHints } from "@/modules/tasks/route-hints";
import { canChangeAssignee, getTaskDetail } from "@/modules/tasks/service";

import { updateTaskAction } from "../../actions";

export default async function EditTaskPage({ params }: PageProps<"/tasks/[id]/edit">) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await getTaskDetail(user, id);
  if (!detail || !detail.canEdit) notFound();
  const { task } = detail;
  // A stopped or finished series shows as "don't repeat".
  const series = task.series?.nextDate ? task.series : null;
  // The assignee may still change before work starts (the route is worked out again), or while
  // open once they were deactivated.
  const assigneeLocked = !task.isPersonal && !canChangeAssignee(task);
  const [options, routes, today] = await Promise.all([
    // The current assignee stays in the list even if deactivated, so saving keeps them.
    getTaskFormOptions(user, [task.assigneeId]),
    // What a new assignee would mean, from the task's author — as in the task panel.
    task.isPersonal || assigneeLocked ? Promise.resolve(undefined) : routeHints(task.creatorId),
    getUserToday(user.id),
  ]);

  return (
    <div className="flex flex-col gap-3">
      {/* On a phone the title is in the short header above (← Назад). */}
      <h2 className="hidden text-lg font-medium md:block">{t("tasks.edit")}</h2>
      <TaskForm
        action={updateTaskAction}
        isNew={false}
        routes={routes}
        assigneeLocked={assigneeLocked}
        today={today}
        initial={{
          taskId: task.id,
          title: task.title,
          description: task.description ?? "",
          isPersonal: task.isPersonal ? "on" : "",
          assigneeId: task.assigneeId,
          needsApproval: task.needsApproval ? "on" : "",
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
