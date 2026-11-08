import { db } from "@/lib/db";
import { fromDateString, isDateString } from "@/lib/dates";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";

import type { TaskAccessInfo } from "./access";
import { TaskError } from "./errors";
import { changeStatus } from "./service";
import { availableTransitions } from "./status";
import { canTrackTime, finishTimer, MAX_MANUAL_MINUTES, timerMinutes } from "./time-rules";

// Time spent on a task (BACKLOG item 24, step 5): a timer one starts and stops, or time added by
// hand. One timer per person runs at a time: starting another stops it. Seen in the task only for
// now (owner's decision); the entries are kept for a report later.

async function loadTask(actor: Actor, taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canTrackTime(actor, task)) throw new TaskError("forbidden");
  return task;
}

// The timer stopped because another one started: on which task, and the minutes it counted.
export type StoppedTimer = { taskId: string; title: string; minutes: number };

// Starts the actor's timer on the task, stopping the one running elsewhere — and says which one
// (`stopped`), so the page can tell. On a task that waits to be taken into work, the one who may
// take it does so (`started`), as with the first ticked step.
export async function startTimer(
  actor: Actor,
  taskId: string,
  now = new Date(),
): Promise<{ started: boolean; stopped: StoppedTimer | null }> {
  const task = await loadTask(actor, taskId);
  const running = await db.taskTimeEntry.findFirst({
    where: { userId: actor.id, endedAt: null },
    include: { task: { select: { title: true } } },
  });
  if (running?.taskId === taskId) return { started: false, stopped: null };
  const stopped = running
    ? {
        taskId: running.taskId,
        title: running.task.title,
        minutes: await finishTimer(running, now),
      }
    : null;
  await db.taskTimeEntry.create({ data: { taskId, userId: actor.id, startedAt: now } });
  const waiting = task.isPersonal ? task.status === "DRAFT" : task.status === "APPROVED";
  if (waiting && availableTransitions(actor, task).includes("IN_PROGRESS")) {
    await changeStatus(actor, task.id, "IN_PROGRESS", { now });
    return { started: true, stopped };
  }
  return { started: false, stopped };
}

// The person's running timer (one at most), with its task: for the task rows («⏱ идёт»), the
// morning digest and anything that shows «the timer is on».
export async function getRunningTimer(userId: string) {
  const entry = await db.taskTimeEntry.findFirst({
    where: { userId, endedAt: null },
    include: { task: { select: { id: true, title: true } } },
    orderBy: { startedAt: "desc" },
  });
  return entry
    ? { taskId: entry.task.id, title: entry.task.title, startedAt: entry.startedAt }
    : null;
}

export type RunningTimer = NonNullable<Awaited<ReturnType<typeof getRunningTimer>>>;

// Stops the actor's timer on the task; the minutes it counted (0: it ran under a minute or
// wasn't running).
export async function stopTimer(actor: Actor, taskId: string, now = new Date()) {
  const running = await db.taskTimeEntry.findFirst({
    where: { userId: actor.id, taskId, endedAt: null },
  });
  if (!running) return 0;
  return finishTimer(running, now);
}

// Time added by hand (a timer forgotten): minutes on a day, not in the future.
export async function addTime(
  actor: Actor,
  taskId: string,
  minutes: number,
  day: string,
  today: string,
) {
  await loadTask(actor, taskId);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MANUAL_MINUTES)
    throw new TaskError("timeInvalid");
  if (!isDateString(day) || day > today) throw new TaskError("timeInvalid");
  const at = fromDateString(day);
  await db.taskTimeEntry.create({
    data: { taskId, userId: actor.id, startedAt: at, endedAt: at, minutes, manual: true },
  });
  await logActivity({
    actorId: actor.id,
    action: "task.time_logged",
    entityType: "Task",
    entityId: taskId,
    details: { minutes, manual: true },
  });
}

// One's own entry, while the task is open (a running timer: cancelled).
export async function removeTimeEntry(actor: Actor, entryId: string) {
  const entry = await db.taskTimeEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.userId !== actor.id) throw new TaskError("forbidden");
  await loadTask(actor, entry.taskId);
  await db.taskTimeEntry.delete({ where: { id: entryId } });
  if (entry.endedAt)
    await logActivity({
      actorId: actor.id,
      action: "task.time_removed",
      entityType: "Task",
      entityId: entry.taskId,
      details: { minutes: entry.minutes },
    });
}

// The task's time for its card: the total, the viewer's running timer, who spent how much (and
// whose timer runs now), and the latest entries. Running timers count with their minutes so far —
// except the viewer's own, which the card adds itself, ticking (`totalMinutes` leaves it out).
export async function getTaskTime(
  task: TaskAccessInfo & { id: string },
  viewer: Actor,
  now = new Date(),
) {
  const entries = await db.taskTimeEntry.findMany({
    where: { taskId: task.id },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { startedAt: "desc" },
  });
  const minutesOf = (e: (typeof entries)[number]) =>
    e.endedAt ? e.minutes : timerMinutes(e.startedAt, now);
  const people = new Map<string, { id: string; name: string; minutes: number; running: boolean }>();
  for (const e of entries) {
    const person = people.get(e.userId) ?? {
      id: e.userId,
      name: displayName(e.user),
      minutes: 0,
      running: false,
    };
    person.minutes += minutesOf(e);
    if (!e.endedAt) person.running = true;
    people.set(e.userId, person);
  }
  const mine = entries.find((e) => e.userId === viewer.id && !e.endedAt);
  return {
    totalMinutes: entries.reduce((sum, e) => sum + (e === mine ? 0 : minutesOf(e)), 0),
    running: mine ? mine.startedAt.toISOString() : null,
    canTrack: canTrackTime(viewer, task),
    people: [...people.values()].sort((a, b) => b.minutes - a.minutes),
    entries: entries.slice(0, 30).map((e) => ({
      id: e.id,
      name: displayName(e.user),
      mine: e.userId === viewer.id,
      minutes: minutesOf(e),
      running: !e.endedAt,
      manual: e.manual,
      at: e.startedAt.toISOString(),
    })),
  };
}

export type TaskTimeView = Awaited<ReturnType<typeof getTaskTime>>;
