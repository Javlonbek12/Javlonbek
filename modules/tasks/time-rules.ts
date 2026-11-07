import { db } from "@/lib/db";
import type { TaskTimeEntry } from "@/lib/generated/prisma/client";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { canControl, canViewTask, isClosed, isDoer, type TaskAccessInfo } from "./access";

// Time spent on a task (BACKLOG item 24, step 5): the rules and stopping timers. Starting, adding
// and the summary are in time.ts.

// A timer left running is counted for 12 hours at most: a forgotten one doesn't add days.
export const MAX_TIMER_MINUTES = 12 * 60;
// Time added by hand: at most a day at once.
export const MAX_MANUAL_MINUTES = 24 * 60;

// Tracked by whoever works on the task: its author, the assignee, co-assignees and whoever
// controls it (a personal task: its author), while it is open.
export function canTrackTime(actor: Actor, task: TaskAccessInfo) {
  if (isClosed(task.status) || !canViewTask(actor, task)) return false;
  if (task.isPersonal) return task.creatorId === actor.id;
  return task.creatorId === actor.id || isDoer(actor, task) || canControl(actor, task);
}

// The minutes a timer counts from its start to `now` (whole minutes, capped).
export function timerMinutes(startedAt: Date, now: Date) {
  return Math.min(
    MAX_TIMER_MINUTES,
    Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 60_000)),
  );
}

// Stops a running timer: under a minute it leaves nothing; otherwise one line in the history.
export async function finishTimer(entry: TaskTimeEntry, now: Date) {
  const minutes = timerMinutes(entry.startedAt, now);
  if (minutes < 1) {
    await db.taskTimeEntry.delete({ where: { id: entry.id } });
    return 0;
  }
  const capped = new Date(entry.startedAt.getTime() + MAX_TIMER_MINUTES * 60_000);
  await db.taskTimeEntry.update({
    where: { id: entry.id },
    data: { endedAt: now < capped ? now : capped, minutes },
  });
  await logActivity({
    actorId: entry.userId,
    action: "task.time_logged",
    entityType: "Task",
    entityId: entry.taskId,
    details: { minutes },
  });
  return minutes;
}

// A task that closes or goes to the bin stops the timers running on it.
export async function stopTimersOnTask(taskId: string, now = new Date()) {
  const running = await db.taskTimeEntry.findMany({ where: { taskId, endedAt: null } });
  for (const entry of running) await finishTimer(entry, now);
}
