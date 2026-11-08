import { db } from "@/lib/db";
import { type Access, withAccess } from "@/modules/core/access/actor";
import { getRoleConfig } from "@/modules/core/access/config";
import { formatDay, fromDateString, todayInTimezone } from "@/lib/dates";
import { getEnv } from "@/lib/env";

import { Prisma, type User } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import { formatTime } from "@/lib/time";
import { deliverDeferredNotifications, notify } from "@/modules/core/notifications/service";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { tagPendingContent } from "@/modules/content/tagging";
import { CLOSED_STATUSES, reviewerOf } from "@/modules/tasks/access";
import { purgeDeletedTasks } from "@/modules/tasks/delete-service";
import { migrateToRoutingV2 } from "@/modules/tasks/migrate-v2";
import { createRepeatCopies } from "@/modules/tasks/service";

import { collectDigestData, defaultDigestWriter, isDigestEmpty, type DigestWriter } from "./digest";
import {
  dueReminderDates,
  isDigestTime,
  localClock,
  OVERDUE_TIME,
  overdueRange,
  weeklySummaryWeek,
  workdaysBetween,
} from "./plan";
import { weeklySummaryText } from "./weekly";

export const LAST_TICK_KEY = "scheduler.lastTick";

// Records that this (user, kind, key) was handled. Returns false if it already was:
// the unique index makes this safe even if two ticks run at the same time.
export async function claim(userId: string, kind: string, key: string): Promise<boolean> {
  try {
    await db.scheduledSend.create({ data: { userId, kind, key } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return false;
    throw error;
  }
}

// Tasks someone is responsible for reminding about (routing v2): what they do (as the assignee or a
// co-assignee), and as the author
// a team task nobody has started yet (or that waits), and as a decider one that waits for them.
function remindersFor(userId: string, authorStatuses: Prisma.EnumTaskStatusFilter["in"]) {
  return {
    status: { notIn: CLOSED_STATUSES },
    OR: [
      { assigneeId: userId, OR: [{ isPersonal: true }, { approvedAt: { not: null } }] },
      { isPersonal: false, coAssigneeIds: { has: userId }, approvedAt: { not: null } },
      { creatorId: userId, isPersonal: false, status: { in: authorStatuses } },
      { deciderIds: { has: userId }, status: "PENDING_APPROVAL" },
    ],
  } satisfies Prisma.TaskWhereInput;
}

async function digestFor(user: User, today: string, writer: DigestWriter) {
  if (!(await claim(user.id, "digest", today))) return;
  const data = await collectDigestData(user, today);
  if (isDigestEmpty(data)) return;
  await notify(user.id, async () => ({
    type: "digest",
    title: t("notifications.events.digestTitle", { name: user.firstName }),
    body: await writer(user, today, data),
    link: "/",
  }));
}

// The assignee, and the author while nobody has started it: once per task and due date.
async function dueRemindersFor(user: User, dueDates: string[]) {
  if (dueDates.length === 0) return;
  const tasks = await db.task.findMany({
    where: {
      ...remindersFor(user.id, ["APPROVED", "PENDING_APPROVAL"]),
      dueDate: { in: dueDates.map(fromDateString) },
    },
    select: { id: true, title: true, dueDate: true },
  });
  for (const task of tasks) {
    const dueDate = task.dueDate!.toISOString().slice(0, 10);
    if (!(await claim(user.id, "due_reminder", `${task.id}:${dueDate}`))) continue;
    await notify(user.id, () => ({
      type: "due_reminder",
      title: t("notifications.events.dueReminderTitle"),
      body: t("notifications.events.dueReminderBody", {
        title: task.title,
        date: formatDay(dueDate),
      }),
      link: `/tasks/${task.id}`,
    }));
  }
}

// Overdue: the assignee and (for team tasks) the author; for a task still waiting, the author and
// whoever decides. Every day, but only for people with the morning digest turned off: the digest
// already lists what is overdue.
async function overdueFor(user: User, range: { from: string; to: string }, today: string) {
  const tasks = await db.task.findMany({
    where: {
      ...remindersFor(user.id, [
        "DRAFT",
        "PENDING_APPROVAL",
        "APPROVED",
        "IN_PROGRESS",
        "IN_REVIEW",
      ]),
      dueDate: { gte: fromDateString(range.from), lt: fromDateString(range.to) },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      assignee: { select: { firstName: true, lastName: true } },
    },
  });
  for (const task of tasks) {
    const due = task.dueDate!.toISOString().slice(0, 10);
    if (!(await claim(user.id, "overdue", `${task.id}:${due}:${today}`))) continue;
    await notify(user.id, () => ({
      type: "overdue",
      title: t("notifications.events.overdueTitle"),
      body: t("notifications.events.overdueBody", {
        title: task.title,
        date: formatDay(due),
        name: displayName(task.assignee),
      }),
      link: `/tasks/${task.id}`,
    }));
  }
}

async function weeklyFor(user: User & { access: Access }, weekStart: string, today: string) {
  // The owner and every manager who sees team tasks get the summary of their own zone.
  const seesTeam =
    user.role === "OWNER" || (user.role === "MANAGER" && user.access.taskScope !== "own");
  if (!seesTeam || !(await claim(user.id, "weekly_summary", weekStart))) return;
  await notify(user.id, async () => ({
    type: "weekly_summary",
    title: t("notifications.events.weeklyTitle"),
    body: await weeklySummaryText(weekStart, today, user),
    link: "/tasks?scope=team",
  }));
}

// Waiting for a decision (routing v2): after one working day whoever decides or accepts hears it;
// after three the owner and the author do. Counted in the default time zone, from 09:00.
async function decisionReminders(now: Date) {
  const tz = getEnv().DEFAULT_TIMEZONE;
  const clock = localClock(now, tz);
  if (clock.minutes < OVERDUE_TIME) return;
  const waiting = await db.task.findMany({
    where: { isPersonal: false, status: { in: ["PENDING_APPROVAL", "IN_REVIEW"] } },
  });
  if (waiting.length === 0) return;
  const owners = (await db.user.findMany({ where: { role: "OWNER" }, select: { id: true } })).map(
    (u) => u.id,
  );
  const names = new Map(
    (await db.user.findMany({ select: { id: true, firstName: true, lastName: true } })).map((u) => [
      u.id,
      displayName(u),
    ]),
  );
  for (const task of waiting) {
    const days = workdaysBetween(todayInTimezone(tz, task.statusChangedAt), clock.date);
    const deciders =
      task.status === "PENDING_APPROVAL" ? task.deciderIds : [reviewerOf(task)].filter(isId);
    const key = `${task.id}:${task.statusChangedAt.toISOString()}`;
    if (days >= 1)
      for (const userId of deciders) {
        if (!(await claim(userId, "task_waiting", `${key}:1`))) continue;
        await notify(userId, () => ({
          type: "task_waiting",
          title: t("notifications.events.taskWaitingTitle"),
          body: t("notifications.events.taskBody", {
            title: task.title,
            name: names.get(task.creatorId) ?? "",
          }),
          link: `/tasks/${task.id}`,
        }));
      }
    if (days >= 3)
      for (const userId of new Set([...owners, task.creatorId])) {
        if (!(await claim(userId, "task_waiting", `${key}:3`))) continue;
        await notify(userId, () => ({
          type: "task_waiting",
          title: t("notifications.events.taskEscalationTitle"),
          body: t("notifications.events.taskEscalationBody", {
            title: task.title,
            name: deciders.map((id) => names.get(id) ?? "?").join(", "),
          }),
          link: `/tasks/${task.id}`,
        }));
      }
  }
}

const isId = (id: string | null): id is string => id !== null;

export const MEETING_REMINDER_MINUTES = 15;

// Participants get a reminder once, when the meeting starts within the next 15 minutes.
async function meetingReminders(now: Date) {
  const meetings = await db.meeting.findMany({
    where: {
      startsAt: { gt: now, lte: new Date(now.getTime() + MEETING_REMINDER_MINUTES * 60_000) },
    },
    include: { participants: true },
  });
  for (const meeting of meetings) {
    for (const { userId } of meeting.participants) {
      // Keyed by the start time too: a meeting moved after its reminder gets a new one.
      const key = `${meeting.id}:${meeting.startsAt.toISOString()}`;
      if (!(await claim(userId, "meeting_reminder", key))) continue;
      const { timezone } = await getSettings(userId);
      await notify(userId, () => ({
        type: "meeting_reminder",
        title: t("notifications.events.meetingReminderTitle"),
        body: [
          t("notifications.events.meetingReminderBody", {
            title: meeting.title,
            time: formatTime(meeting.startsAt, timezone),
          }),
          meeting.link,
        ]
          .filter(Boolean)
          .join("\n"),
        link: `/meetings/${meeting.id}`,
      }));
    }
  }
}

export type TickDeps = { writeDigest?: DigestWriter };

// One scheduler pass. Safe to run every minute: everything sent is claimed first.
export async function runSchedulerTick(now = new Date(), deps: TickDeps = {}) {
  const writer = deps.writeDigest ?? defaultDigestWriter;
  const config = await getRoleConfig();
  const users = await db.user.findMany();
  for (const plain of users) {
    // Digests and summaries follow the role settings, like the site.
    const user = await withAccess(plain, config);
    try {
      const settings = await getSettings(user.id);
      const clock = localClock(now, settings.timezone);
      if (isDigestTime(clock, settings.digestTime)) await digestFor(user, clock.date, writer);
      await dueRemindersFor(user, dueReminderDates(clock));
      const overdue = overdueRange(clock);
      if (overdue && settings.disabledTypes.includes("digest"))
        await overdueFor(user, overdue, clock.date);
      const week = weeklySummaryWeek(clock);
      if (week) await weeklyFor(user, week, clock.date);
    } catch (error) {
      // One user's problem must not stop reminders for everyone else.
      console.error(`Scheduler failed for user ${user.id}`, error);
    }
  }
  await meetingReminders(now);
  try {
    await migrateToRoutingV2(now);
    await decisionReminders(now);
    await purgeDeletedTasks(now);
  } catch (error) {
    console.error("Task routing reminders failed", error);
  }
  try {
    await createRepeatCopies(now);
  } catch (error) {
    console.error("Repeating tasks failed", error);
  }
  try {
    await tagPendingContent();
  } catch (error) {
    console.error("Content tagging failed", error);
  }
  await deliverDeferredNotifications(now);
  await db.systemState.upsert({
    where: { key: LAST_TICK_KEY },
    create: { key: LAST_TICK_KEY, value: now.toISOString() },
    update: { value: now.toISOString() },
  });
}
