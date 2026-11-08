import { db } from "@/lib/db";
import { addDays, daysBetween, todayInTimezone, toDateString } from "@/lib/dates";
import type { TaskStatus } from "@/lib/generated/prisma/enums";
import { isLateWork } from "@/modules/tasks/today";

// The employee's profile for the radar ("pentagon") chart: five scores from 0 to 100,
// higher is better, over the last 90 days of team tasks, next to the team average.
export const PROFILE_AXES = ["onTime", "output", "noOverdue", "speed", "firstTime"] as const;
export type ProfileAxis = (typeof PROFILE_AXES)[number];
export type Scores = Record<ProfileAxis, number | null>;

export const PROFILE_DAYS = 90;
const OPEN: TaskStatus[] = ["APPROVED", "IN_PROGRESS", "IN_REVIEW"];

type Facts = {
  completed: number;
  completedWithDue: number;
  completedOnTime: number;
  averageDays: number | null;
  active: number;
  overdue: number;
  // Completed tasks that had been sent back from review at least once.
  returned: number;
};

// Pure scoring, so it can be tested without a database.
export function scoreTeam(facts: Map<string, Facts>): Map<string, Scores> {
  const all = [...facts.values()];
  const maxCompleted = Math.max(0, ...all.map((f) => f.completed));
  const fastest = Math.min(
    Infinity,
    ...all.filter((f) => f.averageDays !== null).map((f) => Math.max(0.5, f.averageDays!)),
  );
  const result = new Map<string, Scores>();
  for (const [id, f] of facts) {
    result.set(id, {
      onTime: f.completedWithDue
        ? Math.round((f.completedOnTime / f.completedWithDue) * 100)
        : null,
      // Relative to the most productive person in the team.
      output: maxCompleted ? Math.round((f.completed / maxCompleted) * 100) : null,
      noOverdue: f.active ? Math.round((1 - f.overdue / f.active) * 100) : f.completed ? 100 : null,
      // Relative to the fastest average in the team.
      speed:
        f.averageDays === null ? null : Math.round((fastest / Math.max(0.5, f.averageDays)) * 100),
      firstTime: f.completed ? Math.round(((f.completed - f.returned) / f.completed) * 100) : null,
    });
  }
  return result;
}

export function averageScores(scores: Scores[]): Scores {
  const avg = (axis: ProfileAxis) => {
    const values = scores.map((s) => s[axis]).filter((v): v is number => v !== null);
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  };
  return Object.fromEntries(PROFILE_AXES.map((a) => [a, avg(a)])) as Scores;
}

export async function teamProfiles(timezone: string, now = new Date()) {
  const today = todayInTimezone(timezone, now);
  const from = addDays(today, -PROFILE_DAYS);
  const local = (d: Date) => todayInTimezone(timezone, d);
  const tasks = await db.task.findMany({
    where: { isPersonal: false, status: { notIn: ["DRAFT", "PENDING_APPROVAL", "CANCELLED"] } },
    select: {
      id: true,
      assigneeId: true,
      status: true,
      dueDate: true,
      approvedAt: true,
      completedAt: true,
    },
  });
  const returns = await db.activityLog.findMany({
    where: {
      action: "task.status_changed",
      entityType: "Task",
      createdAt: { gte: new Date(Date.now() - (PROFILE_DAYS + 30) * 86_400_000) },
    },
    select: { entityId: true, details: true },
  });
  const returnedIds = new Set(
    returns
      .filter((r) => {
        const d = r.details as { from?: string; to?: string } | null;
        return d?.from === "IN_REVIEW" && d?.to === "IN_PROGRESS";
      })
      .map((r) => r.entityId),
  );
  const facts = new Map<string, Facts>();
  const durations = new Map<string, number[]>();
  for (const t of tasks) {
    const f = facts.get(t.assigneeId) ?? {
      completed: 0,
      completedWithDue: 0,
      completedOnTime: 0,
      averageDays: null,
      active: 0,
      overdue: 0,
      returned: 0,
    };
    facts.set(t.assigneeId, f);
    if (OPEN.includes(t.status)) {
      f.active += 1;
      const due = t.dueDate ? toDateString(t.dueDate) : null;
      if (isLateWork({ status: t.status, dueDate: due }, today)) f.overdue += 1;
    }
    if (t.status !== "DONE" || !t.completedAt || local(t.completedAt) <= from) continue;
    const done = local(t.completedAt);
    f.completed += 1;
    if (t.dueDate) {
      f.completedWithDue += 1;
      if (done <= toDateString(t.dueDate)) f.completedOnTime += 1;
    }
    if (t.approvedAt)
      durations.set(t.assigneeId, [
        ...(durations.get(t.assigneeId) ?? []),
        Math.max(0, daysBetween(local(t.approvedAt), done)),
      ]);
    if (returnedIds.has(t.id)) f.returned += 1;
  }
  for (const [id, list] of durations)
    facts.get(id)!.averageDays = list.reduce((a, b) => a + b, 0) / list.length;
  const scores = scoreTeam(facts);
  return { scores, team: averageScores([...scores.values()]) };
}
