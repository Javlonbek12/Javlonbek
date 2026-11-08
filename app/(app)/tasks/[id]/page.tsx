import { notFound } from "next/navigation";

import { TaskDetail } from "@/components/tasks/task-detail";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/modules/core/auth/current-user";
import { canViewTask } from "@/modules/tasks/access";
import { db } from "@/lib/db";

// The task on its own page: links from notifications, the bot, the calendar and other tasks. The
// list opens the same card in a panel next to it (/tasks?task=…).
export default async function TaskPage({ params, searchParams }: PageProps<"/tasks/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { error, notice, tab, stopped } = await searchParams;
  const task = await db.task.findUnique({ where: { id } });
  if (!task || !canViewTask(user, task)) notFound();
  return (
    <Card className="gap-0">
      <TaskDetail
        user={user}
        taskId={id}
        variant="page"
        base={`/tasks/${encodeURIComponent(id)}`}
        tab={typeof tab === "string" ? tab : undefined}
        error={typeof error === "string" ? error : undefined}
        notice={typeof notice === "string" ? notice : undefined}
        stopped={typeof stopped === "string" ? stopped : undefined}
      />
    </Card>
  );
}
