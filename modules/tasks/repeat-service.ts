import { db } from "@/lib/db";
import { daysBetween, fromDateString, toDateString, todayInTimezone } from "@/lib/dates";
import type { TaskSeries } from "@/lib/generated/prisma/client";
import { getSettings } from "@/modules/core/settings/service";

import { TaskError } from "./errors";
import {
  copyDay,
  nextOccurrence,
  repeatInputSchema,
  type RepeatInput,
  type RepeatRule,
} from "./repeat";

// At most this many copies of one series per scheduler pass (after a long pause, it catches up
// over the next minutes instead of flooding at once).
const COPIES_PER_PASS = 10;

function parseRepeat(input: RepeatInput) {
  const parsed = repeatInputSchema.safeParse(input);
  if (!parsed.success) throw new TaskError("invalid");
  return parsed.data;
}

export function ruleOf(series: TaskSeries): RepeatRule {
  return {
    frequency: series.frequency,
    interval: series.interval,
    weekdays: series.weekdays,
    monthDay: series.monthDay,
    until: series.until ? toDateString(series.until) : null,
    anchor: toDateString(series.anchor),
  };
}

// The task becomes the first of a new series; its due date is where the counting starts.
export async function startSeries(
  creatorId: string,
  taskId: string,
  dueDate: string | null,
  input: RepeatInput,
) {
  if (!dueDate) throw new TaskError("repeatDate");
  const data = parseRepeat(input);
  const next = nextOccurrence({ ...data, anchor: dueDate }, dueDate);
  const series = await db.taskSeries.create({
    data: {
      frequency: data.frequency,
      interval: data.interval,
      weekdays: data.weekdays,
      monthDay: data.monthDay,
      until: data.until ? fromDateString(data.until) : null,
      anchor: fromDateString(dueDate),
      nextDate: next ? fromDateString(next) : null,
      creatorId,
    },
  });
  await db.task.update({ where: { id: taskId }, data: { seriesId: series.id } });
  return series;
}

// Changes how an edited task repeats: null stops the series (the copies made stay).
export async function setRepeat(
  creatorId: string,
  task: { id: string; seriesId: string | null; dueDate: Date | null },
  input: RepeatInput | null,
) {
  const series = task.seriesId
    ? await db.taskSeries.findUnique({ where: { id: task.seriesId } })
    : null;
  if (!input) {
    if (series?.nextDate)
      await db.taskSeries.update({ where: { id: series.id }, data: { nextDate: null } });
    return;
  }
  if (!series) {
    await startSeries(creatorId, task.id, task.dueDate ? toDateString(task.dueDate) : null, input);
    return;
  }
  const data = parseRepeat(input);
  // The next copy comes after the latest one made (or the edited task, if it is later).
  const latest = await db.task.findFirst({
    where: { seriesId: series.id, dueDate: { not: null } },
    orderBy: { dueDate: "desc" },
    select: { dueDate: true },
  });
  const last = [latest?.dueDate, task.dueDate, series.anchor]
    .filter((d): d is Date => d !== null && d !== undefined)
    .map(toDateString)
    .sort()
    .at(-1)!;
  const next = nextOccurrence({ ...data, anchor: toDateString(series.anchor) }, last);
  await db.taskSeries.update({
    where: { id: series.id },
    data: {
      frequency: data.frequency,
      interval: data.interval,
      weekdays: data.weekdays,
      monthDay: data.monthDay,
      until: data.until ? fromDateString(data.until) : null,
      nextDate: next ? fromDateString(next) : null,
    },
  });
}

type CreateCopy = (
  creatorId: string,
  copy: {
    title: string;
    description: string | null;
    isPersonal: boolean;
    assigneeId: string;
    startDate: string | null;
    dueDate: string;
    priority: string;
    project: string | null;
    estimateMinutes: number | null;
  },
  seriesId: string,
  // The latest task of the series is still open: the copy says so, and its author hears it once.
  previousOpenId: string | null,
) => Promise<unknown>;

// Makes the copies whose day has come (in the series creator's time zone). Each copy repeats the
// latest task of the series: title, description, assignee, priority, project, estimate, and the
// same distance between start and due dates. Comments, files and links stay with the original.
export async function createDueCopies(now: Date, createCopy: CreateCopy) {
  const series = await db.taskSeries.findMany({ where: { nextDate: { not: null } } });
  let made = 0;
  for (const s of series) {
    try {
      const { timezone } = await getSettings(s.creatorId);
      const today = todayInTimezone(timezone, now);
      const latest = await db.task.findFirst({
        where: { seriesId: s.id },
        orderBy: [{ dueDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      });
      // Every task of the series was deleted: nothing to copy, the series ends.
      if (!latest) {
        await db.taskSeries.update({ where: { id: s.id }, data: { nextDate: null } });
        continue;
      }
      const span =
        latest.startDate && latest.dueDate
          ? daysBetween(toDateString(latest.startDate), toDateString(latest.dueDate))
          : 0;
      let due: string | null = toDateString(s.nextDate!);
      for (let i = 0; due && copyDay(due, span) <= today && i < COPIES_PER_PASS; i++) {
        const following = nextOccurrence(ruleOf(s), due);
        // Claim this copy: of two passes running at once, only one moves nextDate on.
        const { count } = await db.taskSeries.updateMany({
          where: { id: s.id, nextDate: fromDateString(due) },
          data: { nextDate: following ? fromDateString(following) : null },
        });
        if (count === 0) break;
        await createCopy(
          s.creatorId,
          {
            title: latest.title,
            description: latest.description,
            isPersonal: latest.isPersonal,
            assigneeId: latest.assigneeId,
            startDate: span ? copyDay(due, span) : null,
            dueDate: due,
            priority: latest.priority,
            project: latest.project,
            estimateMinutes: latest.estimateMinutes,
          },
          s.id,
          i === 0 && !["DONE", "CANCELLED"].includes(latest.status) ? latest.id : null,
        );
        made++;
        due = following;
      }
    } catch (error) {
      // One broken series must not stop the others.
      console.error(`Repeating task series ${s.id} failed`, error);
    }
  }
  return made;
}

// How a copy enters the workflow: a personal task as a draft (to do); a team task along its route,
// worked out on the day of the copy by the reporting lines of that day (routing v2).
export function copyMode(copy: { isPersonal: boolean }): "draft" | "create" {
  return copy.isPersonal ? "draft" : "create";
}
