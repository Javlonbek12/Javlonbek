import { db } from "@/lib/db";
import { type Access, withAccess } from "@/modules/core/access/actor";
import { getRoleConfig } from "@/modules/core/access/config";
import { formatDay, fromDateString } from "@/lib/dates";

import { Prisma, type User } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import { formatTime } from "@/lib/time";
import { deliverDeferredNotifications, notify } from "@/modules/core/notifications/service";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { tagPendingContent } from "@/modules/content/tagging";
import { CLOSED_STATUSES } from "@/modules/tasks/access";
import { createRepeatCopies } from "@/modules/tasks/service";

import { collectDigestData, defaultDigestWriter, isDigestEmpty, type DigestWriter } from "./digest";
import { dueReminderDate, isDigestTime, localClock, overdueRange, weeklySummaryWeek } from "./plan";
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

// Tasks that should produce reminders: personal ones, or team ones after approval.
const remindable: Prisma.TaskWhereInput = {
  status: { notIn: CLOSED_STATUSES },
  OR: [{ isPersonal: true }, { approvedAt: { not: null } }],
};

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

async function dueRemindersFor(user: User, dueDate: string) {
  const tasks = await db.task.findMany({
    where: { ...remindable, assigneeId: user.id, dueDate: fromDateString(dueDate) },
    select: { id: true, title: true },
  });
  for (const task of tasks) {
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

// Overdue: the assignee and (for team tasks) the creator, once per task and due date.
async function overdueFor(user: User, range: { from: string; to: string }) {
  const tasks = await db.task.findMany({
    where: {
      ...remindable,
      dueDate: { gte: fromDateString(range.from), lt: fromDateString(range.to) },
      OR: [{ assigneeId: user.id }, { creatorId: user.id, isPersonal: false }],
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
    if (!(await claim(user.id, "overdue", `${task.id}:${due}`))) continue;
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

async function weeklyFor(user: User, weekStart: string, today: string) {
  // The summary covers the whole team: only for people who see all team tasks.
  const scope = (user as User & { access?: Access }).access?.taskScope ?? "all";
  const seesAll = user.role === "OWNER" || (user.role === "MANAGER" && scope === "all");
  if (!seesAll || !(await claim(user.id, "weekly_summary", weekStart))) return;
  await notify(user.id, async () => ({
    type: "weekly_summary",
    title: t("notifications.events.weeklyTitle"),
    body: await weeklySummaryText(weekStart, today),
    link: "/tasks?scope=team",
  }));
}

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
      if (!(await claim(userId, "meeting_reminder", meeting.id))) continue;
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
      const tomorrow = dueReminderDate(clock);
      if (tomorrow) await dueRemindersFor(user, tomorrow);
      const overdue = overdueRange(clock);
      if (overdue) await overdueFor(user, overdue);
      const week = weeklySummaryWeek(clock);
      if (week) await weeklyFor(user, week, clock.date);
    } catch (error) {
      // One user's problem must not stop reminders for everyone else.
      console.error(`Scheduler failed for user ${user.id}`, error);
    }
  }
  await meetingReminders(now);
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
