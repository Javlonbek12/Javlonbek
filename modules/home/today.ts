import { addDays, fromDateString } from "@/lib/dates";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";
import { CLOSED_STATUSES, doerWhere, oversight, visibleTasksWhere } from "@/modules/tasks/access";
import { toTaskView, type TaskView } from "@/modules/tasks/service";

// What «Сегодня» shows: the person's day (overdue, due today, in progress), the next two days,
// and for whoever oversees a team — how the team is doing today.

// The same shape as the task lists use, so rows look the same everywhere.
const include = {
  assignee: { select: { id: true, firstName: true, lastName: true } },
  creator: { select: { id: true, firstName: true, lastName: true } },
  blockedBy: { select: { blocker: { select: { status: true } } } },
  steps: { select: { doneAt: true } },
} satisfies Prisma.TaskInclude;

export type DayTask = TaskView & { when: "overdue" | "today" | "inProgress" };

const UPCOMING_DAYS = 2;
const UPCOMING_SHOWN = 5;

export function planDay(tasks: TaskView[], today: string) {
  // Handed in: nothing left to do until it's accepted or returned.
  const open = tasks.filter((task) => task.status !== "IN_REVIEW");
  const day: DayTask[] = [];
  for (const task of open) {
    if (task.dueDate && task.dueDate < today) day.push({ ...task, when: "overdue" });
    else if (task.dueDate === today) day.push({ ...task, when: "today" });
    else if (task.status === "IN_PROGRESS") day.push({ ...task, when: "inProgress" });
  }
  const order = { overdue: 0, today: 1, inProgress: 2 };
  day.sort(
    (a, b) =>
      order[a.when] - order[b.when] ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
      a.title.localeCompare(b.title),
  );
  const inDay = new Set(day.map((task) => task.id));
  const horizon = addDays(today, UPCOMING_DAYS);
  const upcoming = open
    .filter(
      (task) =>
        !inDay.has(task.id) && task.dueDate && task.dueDate > today && task.dueDate <= horizon,
    )
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
    .slice(0, UPCOMING_SHOWN);
  return {
    day,
    upcoming,
    handedIn: tasks.filter((task) => task.status === "IN_REVIEW").length,
  };
}

export async function getMyDay(actor: Actor, today: string) {
  const tasks = await db.task.findMany({
    where: {
      AND: [
        visibleTasksWhere(actor),
        doerWhere(actor.id),
        { status: { notIn: CLOSED_STATUSES } },
        {
          OR: [
            { dueDate: { lte: fromDateString(addDays(today, UPCOMING_DAYS)) } },
            { status: { in: ["IN_PROGRESS", "IN_REVIEW"] } },
          ],
        },
      ],
    },
    include,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
  });
  return planDay(tasks.map(toTaskView), today);
}

export type TeamRow = {
  id: string;
  name: string;
  open: number;
  inProgress: number;
  overdue: number;
  inReview: number;
};

const TEAM_SHOWN = 8;

export function summarizeTeam(
  people: { id: string; name: string }[],
  tasks: { assigneeId: string; status: string; dueDate: Date | null }[],
  today: string,
) {
  const rows: TeamRow[] = people.map((person) => {
    const own = tasks.filter((task) => task.assigneeId === person.id);
    return {
      ...person,
      open: own.length,
      inProgress: own.filter((task) => task.status === "IN_PROGRESS").length,
      overdue: own.filter(
        (task) =>
          task.status !== "IN_REVIEW" &&
          task.dueDate !== null &&
          task.dueDate.toISOString().slice(0, 10) < today,
      ).length,
      inReview: own.filter((task) => task.status === "IN_REVIEW").length,
    };
  });
  const busy = rows
    .filter((row) => row.open > 0)
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name));
  return {
    rows: busy.slice(0, TEAM_SHOWN),
    more: Math.max(0, busy.length - TEAM_SHOWN),
    idle: rows.length - busy.length,
    overdue: rows.reduce((sum, row) => sum + row.overdue, 0),
  };
}

// The team the actor oversees (the owner: everyone; a manager: their people per the role
// settings); null for those who oversee nobody.
export async function getTeamToday(actor: Actor, today: string) {
  const scope = oversight(actor);
  if (scope === "none") return null;
  const people = await db.user.findMany({
    where: scope === "all" ? { NOT: { id: actor.id } } : { id: { in: scope, not: actor.id } },
    select: { id: true, firstName: true, lastName: true },
  });
  if (people.length === 0) return null;
  const tasks = await db.task.findMany({
    where: {
      isPersonal: false,
      approvedAt: { not: null },
      assigneeId: { in: people.map((p) => p.id) },
      status: { notIn: CLOSED_STATUSES },
    },
    select: { assigneeId: true, status: true, dueDate: true },
  });
  return summarizeTeam(
    people.map((p) => ({ id: p.id, name: displayName(p) })),
    tasks,
    today,
  );
}
