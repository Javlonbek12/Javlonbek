import { z } from "zod";

import { db } from "@/lib/db";
import { fromDateString, isDateString, todayInTimezone, toDateString } from "@/lib/dates";
import { EmployeeNoteKind } from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";
import { activeOr } from "@/modules/core/users/active";
import { teamsOfPeople } from "@/modules/org/service";

import {
  canSeePrivateNotes,
  canSeeStats,
  editableProfileFields,
  isValidManager,
  type ProfileField,
} from "./access";
import { employeeStats, type StatTask } from "./stats";

export type TeamErrorCode =
  | "forbidden"
  | "invalid"
  | "manager"
  // Deactivation (deactivation.ts): oneself, the last owner, a deactivated heir, already done.
  | "self"
  | "lastOwner"
  | "handOver"
  | "state";

export class TeamError extends Error {
  constructor(public readonly code: TeamErrorCode) {
    super(code);
    this.name = "TeamError";
  }
}

const userSelect = {
  id: true,
  firstName: true,
  lastName: true,
  telegramUsername: true,
  role: true,
  position: true,
  responsibility: true,
  phone: true,
  email: true,
  startedAt: true,
  managerId: true,
  botChatId: true,
  createdAt: true,
  deactivatedAt: true,
} satisfies Prisma.UserSelect;

// Team tasks of the employee (personal tasks stay private), as statistic inputs.
async function statTasks(employeeIds: string[], timezone: string) {
  const tasks = await db.task.findMany({
    where: { assigneeId: { in: employeeIds }, isPersonal: false, approvedAt: { not: null } },
    select: {
      assigneeId: true,
      status: true,
      dueDate: true,
      approvedAt: true,
      completedAt: true,
      estimateMinutes: true,
    },
  });
  const local = (date: Date) => todayInTimezone(timezone, date);
  const byUser = new Map<string, StatTask[]>();
  for (const t of tasks) {
    const list = byUser.get(t.assigneeId) ?? [];
    list.push({
      status: t.status,
      dueDate: t.dueDate ? toDateString(t.dueDate) : null,
      assignedAt: local(t.approvedAt!),
      completedAt: t.completedAt ? local(t.completedAt) : null,
      estimateMinutes: t.estimateMinutes,
    });
    byUser.set(t.assigneeId, list);
  }
  return byUser;
}

// «nobot»: people who haven't connected the Telegram bot — they get no tasks or reminders there.
export const TEAM_FILTERS = ["all", "mine", "overdue", "nobot", "deactivated"] as const;
export type TeamFilter = (typeof TEAM_FILTERS)[number];

type TeamCard = {
  user: Prisma.UserGetPayload<{ select: typeof userSelect }>;
  stats: ReturnType<typeof employeeStats> | null;
  manager: Prisma.UserGetPayload<{ select: typeof userSelect }> | null;
  // Their team in the org chart ("" — placed under no unit); null — not in the chart.
  team: string | null;
};

function passes(filter: TeamFilter, card: TeamCard, viewer: Actor) {
  const { user, stats } = card;
  if (filter === "deactivated") return user.deactivatedAt !== null;
  if (user.deactivatedAt) return false;
  if (filter === "mine") return user.managerId === viewer.id;
  if (filter === "overdue") return !!stats && stats.overdue > 0;
  if (filter === "nobot") return user.botChatId === null;
  return true;
}

// The team list: everyone sees names and roles; statistics only where allowed. Deactivated people
// show only under their own filter («Отключённые»). `counts`: how many people each filter would
// show with the same search, for the filter chips.
export async function listTeam(viewer: Actor, filter: TeamFilter = "all", search = "") {
  const { timezone } = await getSettings(viewer.id);
  const today = todayInTimezone(timezone);
  const [users, teams] = await Promise.all([
    db.user.findMany({ select: userSelect, orderBy: [{ firstName: "asc" }] }),
    teamsOfPeople(),
  ]);
  const tasks = await statTasks(
    users.map((u) => u.id),
    timezone,
  );
  const query = search.trim().toLowerCase();
  const found = users
    .filter(
      (user) =>
        !query ||
        [user.firstName, user.lastName, user.position, user.responsibility]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query)),
    )
    .map((user): TeamCard => ({
      user,
      stats: canSeeStats(viewer, user) ? employeeStats(tasks.get(user.id) ?? [], today) : null,
      manager: users.find((u) => u.id === user.managerId) ?? null,
      team: teams.get(user.id) ?? null,
    }));
  return {
    cards: found.filter((card) => passes(filter, card, viewer)),
    counts: Object.fromEntries(
      TEAM_FILTERS.map((f) => [f, found.filter((card) => passes(f, card, viewer)).length]),
    ) as Record<TeamFilter, number>,
    // The chart has places: the list can be grouped by team.
    hasChart: teams.size > 0,
  };
}

export async function listTeamCards(viewer: Actor, filter: TeamFilter = "all", search = "") {
  return (await listTeam(viewer, filter, search)).cards;
}

// Open tasks still on the person (not done, not cancelled): said before switching them off.
export const countOpenTasks = (userId: string) =>
  db.task.count({ where: { assigneeId: userId, status: { notIn: ["DONE", "CANCELLED"] } } });

export async function getEmployeeCard(viewer: Actor, employeeId: string) {
  const user = await db.user.findUnique({ where: { id: employeeId }, select: userSelect });
  if (!user) return null;
  const { timezone } = await getSettings(viewer.id);
  const today = todayInTimezone(timezone);
  const person = { id: true, firstName: true, lastName: true, deactivatedAt: true } as const;
  const [manager, reports, tasks] = await Promise.all([
    user.managerId ? db.user.findUnique({ where: { id: user.managerId }, select: person }) : null,
    db.user.findMany({ where: { managerId: user.id }, select: person }),
    statTasks([user.id], timezone),
  ]);
  const seeNotes = canSeePrivateNotes(viewer, user);
  const notes = seeNotes
    ? await db.employeeNote.findMany({
        where: { employeeId },
        include: { author: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const inChart = await isInChart(user.id);
  return {
    user,
    manager,
    reports,
    stats: canSeeStats(viewer, user) ? employeeStats(tasks.get(user.id) ?? [], today) : null,
    notes,
    inChart,
    editable: cardFields(editableProfileFields(viewer, user), inChart),
  };
}

const profileSchema = z.object({
  position: z.string().trim().max(100).nullable(),
  responsibility: z.string().trim().max(300).nullable(),
  phone: z.string().trim().max(40).nullable(),
  email: z.union([z.email().max(200), z.literal("")]).nullable(),
  startedAt: z
    .string()
    .nullable()
    .refine((v) => !v || isDateString(v)),
  managerId: z.string().max(64).nullable(),
});

export type ProfileInput = z.input<typeof profileSchema>;

// A person placed in the org chart gets the job title and the manager from it (syncPeople), so the
// card doesn't offer them: an edit there would be undone by the next chart change.
const isInChart = async (userId: string) =>
  (await db.orgNode.count({ where: { userId, kind: "POSITION" } })) > 0;
const FROM_CHART: ProfileField[] = ["position", "managerId"];
const cardFields = (fields: ProfileField[], inChart: boolean) =>
  inChart ? fields.filter((f) => !FROM_CHART.includes(f)) : fields;

// Saves only the fields this viewer may change; others are ignored.
export async function updateProfile(viewer: Actor, employeeId: string, input: ProfileInput) {
  const employee = await db.user.findUnique({ where: { id: employeeId } });
  if (!employee) throw new TeamError("forbidden");
  const allowed = cardFields(editableProfileFields(viewer, employee), await isInChart(employeeId));
  if (allowed.length === 0) throw new TeamError("forbidden");
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) throw new TeamError("invalid");
  const values = parsed.data;

  const data: Prisma.UserUncheckedUpdateInput = {};
  const set = (field: ProfileField, value: unknown) => {
    if (allowed.includes(field)) (data as Record<string, unknown>)[field] = value;
  };
  set("position", values.position || null);
  set("responsibility", values.responsibility || null);
  set("phone", values.phone || null);
  set("email", values.email || null);
  set("startedAt", values.startedAt ? fromDateString(values.startedAt) : null);

  if (allowed.includes("managerId") && values.managerId !== employee.managerId) {
    const manager = values.managerId
      ? await db.user.findUnique({ where: { id: values.managerId } })
      : null;
    if (values.managerId && (!manager || manager.deactivatedAt)) throw new TeamError("manager");
    const all = await db.user.findMany({ select: { id: true, managerId: true } });
    const managerOf = new Map(all.map((u) => [u.id, u.managerId]));
    if (!isValidManager(employeeId, manager, managerOf)) throw new TeamError("manager");
    data.managerId = manager?.id ?? null;
  }

  await db.user.update({ where: { id: employeeId }, data });
  await logActivity({
    actorId: viewer.id,
    action: "user.profile_updated",
    entityType: "User",
    entityId: employeeId,
    details: { fields: Object.keys(data) },
  });
}

// Settings → Профиль: everyone keeps their own phone and email up to date (the same right as on
// their card), without touching the fields the owner or the manager sets.
export async function updateOwnContacts(user: Actor, input: { phone: string; email: string }) {
  const parsed = profileSchema.pick({ phone: true, email: true }).safeParse(input);
  if (!parsed.success) throw new TeamError("invalid");
  await db.user.update({
    where: { id: user.id },
    data: { phone: parsed.data.phone || null, email: parsed.data.email || null },
  });
  await logActivity({
    actorId: user.id,
    action: "user.profile_updated",
    entityType: "User",
    entityId: user.id,
    details: { fields: ["phone", "email"] },
  });
}

const noteSchema = z.object({
  kind: z.enum(EmployeeNoteKind),
  text: z.string().trim().min(1).max(5000),
});

export async function addEmployeeNote(
  viewer: Actor,
  employeeId: string,
  kind: string,
  text: string,
) {
  const employee = await db.user.findUnique({ where: { id: employeeId } });
  if (!employee || !canSeePrivateNotes(viewer, employee)) throw new TeamError("forbidden");
  const parsed = noteSchema.safeParse({ kind, text });
  if (!parsed.success) throw new TeamError("invalid");
  // The note text is private, so the activity log only records that a note was added.
  const note = await db.employeeNote.create({
    data: { employeeId, authorId: viewer.id, ...parsed.data },
  });
  await logActivity({
    actorId: viewer.id,
    action: "user.note_added",
    entityType: "User",
    entityId: employeeId,
  });
  return note;
}

// The author or the OWNER removes a note, while they can still see the employee's notes.
export async function deleteEmployeeNote(viewer: Actor, noteId: string) {
  const note = await db.employeeNote.findUnique({
    where: { id: noteId },
    include: { employee: true },
  });
  if (
    !note ||
    !canSeePrivateNotes(viewer, note.employee) ||
    (note.authorId !== viewer.id && viewer.role !== "OWNER")
  ) {
    throw new TeamError("forbidden");
  }
  await db.employeeNote.delete({ where: { id: noteId } });
  await logActivity({
    actorId: viewer.id,
    action: "user.note_deleted",
    entityType: "User",
    entityId: note.employeeId,
  });
}

// Active owners and managers; `keep`: the current manager, shown even if deactivated so the form
// keeps them.
export async function listManagerCandidates(keep: string | null = null) {
  return db.user.findMany({
    where: { role: { in: ["OWNER", "MANAGER"] }, ...activeOr([keep]) },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });
}
