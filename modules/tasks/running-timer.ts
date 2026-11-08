import { db } from "@/lib/db";

// The timer a person has running now (one at a time), for the header pill and «Сегодня».
export async function getRunningTimer(userId: string) {
  const entry = await db.taskTimeEntry.findFirst({
    where: { userId, endedAt: null },
    include: { task: { select: { id: true, title: true } } },
  });
  return entry
    ? { taskId: entry.task.id, title: entry.task.title, startedAt: entry.startedAt.toISOString() }
    : null;
}

export type RunningTimer = NonNullable<Awaited<ReturnType<typeof getRunningTimer>>>;
