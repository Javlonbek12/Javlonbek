import { NewTaskForm } from "@/components/tasks/new-task-form";
import { db } from "@/lib/db";
import { isDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { isAiConfigured } from "@/modules/ai/client";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { canViewMeeting } from "@/modules/meetings/access";
import { getTaskFormOptions } from "@/modules/tasks/form-options";
import { routeHints } from "@/modules/tasks/route-hints";

import { composeTaskAction, createComposedTasksAction, createTaskAction } from "../actions";

// ?due=YYYY-MM-DD fills the due date (the calendar); ?meeting=<id> makes it a task for that
// meeting (its page's «+ Добавить задачу»); ?assignee=<id> picks the assignee (the employee
// card's «Поставить задачу») when that person can be given work. «Оформить с ИИ» above the form
// fills it from the task written in one's own words.
export default async function NewTaskPage({ searchParams }: PageProps<"/tasks/new">) {
  const user = await requireUser();
  const { due, meeting: meetingId, assignee } = await searchParams;
  const [options, routes, today, found] = await Promise.all([
    getTaskFormOptions(user),
    routeHints(user.id),
    getUserToday(user.id),
    typeof meetingId === "string"
      ? db.meeting.findUnique({
          where: { id: meetingId },
          include: { participants: { select: { userId: true } } },
        })
      : null,
  ]);
  const meeting =
    found &&
    canViewMeeting(user, {
      createdById: found.createdById,
      participantIds: found.participants.map((p) => p.userId),
    })
      ? { id: found.id, title: found.title }
      : undefined;
  // Only someone the form offers (active people).
  const assigneeId =
    typeof assignee === "string" && options.users.some((u) => u.id === assignee)
      ? assignee
      : user.id;

  return (
    <div className="flex flex-col gap-3">
      {/* On a phone the title is in the short header above (← Назад). */}
      <h2 className="hidden text-lg font-medium md:block">{t("tasks.newTask")}</h2>
      <NewTaskForm
        action={createTaskAction}
        compose={isAiConfigured() ? composeTaskAction : undefined}
        createMany={createComposedTasksAction}
        isNew
        routes={routes}
        today={today}
        canAskApproval={user.role !== "OWNER"}
        meeting={meeting}
        initial={{
          assigneeId,
          priority: "MEDIUM",
          dueDate: typeof due === "string" && isDateString(due) ? due : "",
        }}
        {...options}
      />
    </div>
  );
}
