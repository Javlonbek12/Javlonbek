import { db } from "@/lib/db";
import type { TaskTimeEntry } from "@/lib/generated/prisma/client";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { canControl, canViewTask, isClosed, isDoer, type TaskAccessInfo } from "./access";

// Time spent on a task (BACKLOG item 24, step 5): the rules and stopping timers. Starting, adding
// and the summary are in time.ts.

// Time added by hand (and a timer's time corrected): at most a day at once.
export const MAX_MANUAL_MINUTES = 24 * 60;

// Tracked by whoever works on the task: its author, the assignee, co-assignees and whoever
// controls it (a personal task: its author), while it is open.
export function canTrackTime(actor: Actor, task: TaskAccessInfo) {
  if (isClosed(task.status) || !canViewTask(actor, task)) return false;
  if (task.isPersonal) return task.creatorId === actor.id;
  return task.creatorId === actor.id || isDoer(actor, task) || canControl(actor, task);
}

// The minutes a timer counts from its start to `now` (whole minutes). Not capped: a forgotten
// timer is caught by «Забыли остановить?» (time-format.ts), and the person says how long they
// really worked — the app never writes a made-up number by itself.
export function timerMinutes(startedAt: Date, now: Date) {
  return Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 60_000));
}

// Stops a running timer: under a minute it leaves nothing; otherwise one line in the history.
// `worked`: the minutes the person says they really worked («Исправить время»), at most what the
// timer counted; 0 leaves nothing.
export async function finishTimer(entry: TaskTimeEntry, now: Date, worked?: number) {
  const counted = timerMinutes(entry.startedAt, now);
  const minutes = worked === undefined ? counted : Math.min(counted, worked);
  if (minutes < 1) {
    await db.taskTimeEntry.delete({ where: { id: entry.id } });
    return 0;
  }
  await db.taskTimeEntry.update({
    where: { id: entry.id },
    data: {
      endedAt: worked === undefined ? now : new Date(entry.startedAt.getTime() + minutes * 60_000),
      minutes,
    },
  });
  await logActivity({
    actorId: entry.userId,
    action: "task.time_logged",
    entityType: "Task",
    entityId: entry.taskId,
    details: worked === undefined ? { minutes } : { minutes, corrected: true },
  });
  return minutes;
}

// A task that is handed in, closes or goes to the bin stops the timers running on it; one person
// taken off the task (a co-assignee) — only theirs.
export async function stopTimersOnTask(taskId: string, now = new Date(), userId?: string) {
  const running = await db.taskTimeEntry.findMany({
    where: { taskId, endedAt: null, ...(userId ? { userId } : {}) },
  });
  for (const entry of running) await finishTimer(entry, now);
}
