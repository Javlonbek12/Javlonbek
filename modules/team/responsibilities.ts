import { z } from "zod";

import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import type { Prisma, Responsibility as DutyRow } from "@/lib/generated/prisma/client";
import type { ResponsibilityStatus } from "@/lib/generated/prisma/enums";
import { logActivity } from "@/modules/core/activity/service";
import { canUseModule } from "@/modules/core/access/actor";
import type { Actor } from "@/modules/core/permissions";
import { MODULES } from "@/modules/core/registry";
import { displayName } from "@/modules/core/users/display-name";
import { teamsOfPeople } from "@/modules/org/service";

import {
  canEditDutiesOf,
  dutiesTeam,
  subjectOfPlace,
  type ChartPlace,
} from "./responsibility-access";

// «Команда» → «Обязанности»: who is responsible for what. An item written for a person who holds
// an org chart position follows the position (see the Responsibility model); the rights are in
// responsibility-access.ts.

// The sections an item can link to: every menu section but «Сегодня», «Уведомления», «Настройки».
const NOT_SECTIONS = ["home", "notifications", "settings"];
export const DUTY_SECTIONS = MODULES.filter((m) => !NOT_SECTIONS.includes(m.id)).map((m) => m.id);
export const isDutySection = (id: string) => DUTY_SECTIONS.includes(id);

// The form's «responsible» value that keeps an item on its place nobody in the app holds.
export const KEEP_PLACE = "place";

export class DutyError extends Error {
  constructor(public readonly code: "forbidden" | "invalid" | "notFound") {
    super(code);
    this.name = "DutyError";
  }
}

export type DutyPerson = {
  id: string;
  name: string;
  position: string | null;
  deactivated: boolean;
};

// Who is responsible now: a person, a place in the chart that no app user holds (a vacancy or
// someone not in the app), or nobody (the person and the place are gone).
export type DutyOwner =
  | { kind: "person"; person: DutyPerson }
  | { kind: "place"; placeId: string; title: string | null; personName: string | null }
  | { kind: "none" };

export type Duty = {
  id: string;
  title: string;
  description: string | null;
  module: string | null;
  status: ResponsibilityStatus;
  source: string | null;
  owner: DutyOwner;
  deputy: DutyPerson | null;
  canEdit: boolean;
};

const personSelect = {
  id: true,
  firstName: true,
  lastName: true,
  position: true,
  role: true,
  managerId: true,
  deactivatedAt: true,
} satisfies Prisma.UserSelect;
type PersonRow = Prisma.UserGetPayload<{ select: typeof personSelect }>;

const toPerson = (user: PersonRow): DutyPerson => ({
  id: user.id,
  name: displayName(user),
  position: user.position,
  deactivated: user.deactivatedAt !== null,
});

// Everything the rights and the names need, read once per request.
async function dutyContext(viewer: Actor) {
  const [users, nodes] = await Promise.all([
    db.user.findMany({ select: personSelect }),
    db.orgNode.findMany({
      select: { id: true, kind: true, parentId: true, title: true, userId: true, personName: true },
    }),
  ]);
  const people = new Map(users.map((u) => [u.id, u]));
  const positions = nodes.filter((n) => n.kind === "POSITION");
  const places = new Map(positions.map((n) => [n.id, n]));
  // Units sit between positions too: the walk up the chart needs every node.
  const chart = new Map<string, ChartPlace>(
    nodes.map((n) => [
      n.id,
      { id: n.id, parentId: n.parentId, user: n.userId ? (people.get(n.userId) ?? null) : null },
    ]),
  );
  const placeOf = new Map(positions.filter((n) => n.userId).map((n) => [n.userId!, n.id]));
  return { people, places, chart, placeOf, team: dutiesTeam(viewer, users), viewer };
}
type Context = Awaited<ReturnType<typeof dutyContext>>;

// The responsible now, and whose item it is for the rights (for a place: its manager).
function ownerOf(row: DutyRow, ctx: Context): { owner: DutyOwner; subject: string | null } {
  const place = row.positionId ? ctx.places.get(row.positionId) : undefined;
  if (place) {
    const holder = place.userId ? ctx.people.get(place.userId) : undefined;
    if (holder) return { owner: { kind: "person", person: toPerson(holder) }, subject: holder.id };
    return {
      owner: { kind: "place", placeId: place.id, title: place.title, personName: place.personName },
      subject: subjectOfPlace(place.id, ctx.chart),
    };
  }
  const user = row.userId ? ctx.people.get(row.userId) : undefined;
  if (user) return { owner: { kind: "person", person: toPerson(user) }, subject: user.id };
  return { owner: { kind: "none" }, subject: null };
}

function toDuty(row: DutyRow, ctx: Context): Duty {
  const { owner, subject } = ownerOf(row, ctx);
  const deputy = row.deputyId ? ctx.people.get(row.deputyId) : undefined;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    module: row.module,
    status: row.status,
    source: row.source,
    owner,
    deputy: deputy ? toPerson(deputy) : null,
    canEdit: canEditDutiesOf(ctx.viewer, subject, ctx.team),
  };
}

// The items this person sees: every confirmed one, and the suggestions they may confirm.
async function visibleDuties(viewer: Actor, where: Prisma.ResponsibilityWhereInput = {}) {
  const ctx = await dutyContext(viewer);
  const rows = await db.responsibility.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const duties = rows
    .map((row) => toDuty(row, ctx))
    .filter((duty) => duty.status === "CONFIRMED" || duty.canEdit);
  return { duties, ctx };
}

// Who may add items at all: the owner and the managers (for themselves and their team).
export const canAddDuties = (viewer: Actor) => viewer.role === "OWNER" || viewer.role === "MANAGER";

const normalize = (text: string) => text.toLowerCase().replaceAll("ё", "е");

// For sorting and searching: the person's name, or the name and title of the place.
export function ownerLabel(owner: DutyOwner): string {
  if (owner.kind === "person") return owner.person.name;
  if (owner.kind === "place") return [owner.personName, owner.title].filter(Boolean).join(" ");
  return "";
}

// For the screen: «Имя», «Имя · не в приложении», «Вакансия · Должность», «Не назначено».
export function ownerText(owner: DutyOwner): string {
  if (owner.kind === "person") return owner.person.name;
  if (owner.kind === "none") return t("team.duties.nobody");
  if (owner.personName) return `${owner.personName} · ${t("team.duties.notInApp")}`;
  return [t("team.duties.vacancy"), owner.title].filter(Boolean).join(" · ");
}

// Every word of the query is somewhere in the title, the description, the responsible or the
// deputy.
function matches(duty: Duty, query: string) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = normalize(
    [duty.title, duty.description, ownerLabel(duty.owner), duty.deputy?.name]
      .filter(Boolean)
      .join(" "),
  );
  return words.every((word) => text.includes(word));
}

export type DutyGroup = {
  key: string;
  owner: DutyOwner;
  // The person's team in the org chart (as in the team list).
  team: string | null;
  duties: Duty[];
};

// The «Обязанности» view: items grouped by the responsible — people by name, then places nobody
// in the app holds, then items with nobody. `sections`: the sections the items link to (the
// filter offers only those).
export async function listDuties(viewer: Actor, filter: { q?: string; section?: string } = {}) {
  const [{ duties }, teams] = await Promise.all([visibleDuties(viewer), teamsOfPeople()]);
  const sections = DUTY_SECTIONS.filter((id) => duties.some((d) => d.module === id));
  const found = duties.filter(
    (duty) => (!filter.section || duty.module === filter.section) && matches(duty, filter.q ?? ""),
  );
  const groups = new Map<string, DutyGroup>();
  for (const duty of found) {
    const { owner } = duty;
    const key =
      owner.kind === "person"
        ? `person:${owner.person.id}`
        : owner.kind === "place"
          ? `place:${owner.placeId}`
          : "none";
    const team = owner.kind === "person" ? (teams.get(owner.person.id) ?? null) : null;
    const group = groups.get(key) ?? { key, owner, team, duties: [] };
    group.duties.push(duty);
    groups.set(key, group);
  }
  const rank = (owner: DutyOwner) => ["person", "place", "none"].indexOf(owner.kind);
  return {
    groups: [...groups.values()].sort(
      (a, b) =>
        rank(a.owner) - rank(b.owner) ||
        ownerLabel(a.owner).localeCompare(ownerLabel(b.owner), "ru"),
    ),
    sections,
  };
}

// The employee card's block: the person's items, the ones they stand in for, and whether the
// viewer may add one for them.
export async function dutiesOfPerson(viewer: Actor, userId: string) {
  const place = await db.orgNode.findUnique({ where: { userId }, select: { id: true } });
  const { duties, ctx } = await visibleDuties(viewer, {
    OR: [{ userId }, { deputyId: userId }, ...(place ? [{ positionId: place.id }] : [])],
  });
  const isOwn = (duty: Duty) => duty.owner.kind === "person" && duty.owner.person.id === userId;
  return {
    own: duties.filter(isOwn),
    deputyFor: duties.filter((duty) => !isOwn(duty) && duty.deputy?.id === userId),
    canAdd: canEditDutiesOf(viewer, userId, ctx.team),
  };
}

// The top bar's search: by title or description, within the «Команда» section.
export async function searchDuties(viewer: Actor, query: string, limit: number) {
  if (!canUseModule(viewer, "team")) return [];
  const contains = { contains: query, mode: "insensitive" as const };
  const { duties } = await visibleDuties(viewer, {
    OR: [{ title: contains }, { description: contains }],
  });
  return duties.slice(0, limit);
}

// For the AI help: the confirmed items the person may see, «title → who». With «Команда» —
// everyone's; without it, only their own (as on their own card).
export async function dutiesForHelp(viewer: Actor, max = 100): Promise<string[]> {
  const { duties } = await visibleDuties(viewer, { status: "CONFIRMED" });
  const mine = (duty: Duty) =>
    (duty.owner.kind === "person" && duty.owner.person.id === viewer.id) ||
    duty.deputy?.id === viewer.id;
  return duties
    .filter((duty) => canUseModule(viewer, "team") || mine(duty))
    .slice(0, max)
    .map((duty) => {
      const { owner } = duty;
      const who =
        owner.kind === "person"
          ? `${owner.person.name}${owner.person.position ? ` (${owner.person.position})` : ""}`
          : owner.kind === "place"
            ? `${owner.personName ? `${owner.personName}, not in the app` : "vacancy"} (${owner.title ?? "-"})`
            : "nobody";
      const deputy = duty.deputy ? `; deputy: ${duty.deputy.name}` : "";
      return `- ${duty.title.slice(0, 150)} → ${who}${deputy}`;
    });
}

// The item for the edit form, if the viewer may change it.
export async function getDutyForEdit(viewer: Actor, id: string) {
  const row = await db.responsibility.findUnique({ where: { id } });
  if (!row) return null;
  const ctx = await dutyContext(viewer);
  const duty = toDuty(row, ctx);
  return duty.canEdit ? { duty, row } : null;
}

// Whom the viewer may make responsible (the owner: anyone; a manager: themselves and their team)
// and who may stand in (anyone). `keep`: people already on the item, kept even if switched off.
export async function dutyFormPeople(viewer: Actor, keep: (string | null)[] = []) {
  const ctx = await dutyContext(viewer);
  const kept = new Set(keep.filter(Boolean));
  const people = [...ctx.people.values()]
    .filter((u) => !u.deactivatedAt || kept.has(u.id))
    .sort((a, b) => displayName(a).localeCompare(displayName(b), "ru"));
  const option = (u: PersonRow) => ({
    id: u.id,
    name: displayName(u),
    position: u.position,
    deactivated: u.deactivatedAt !== null,
  });
  return {
    responsible: people.filter((u) => canEditDutiesOf(viewer, u.id, ctx.team)).map(option),
    deputies: people.map(option),
  };
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const dutySchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: optional(2000),
  // A person's id, or KEEP_PLACE.
  responsible: z.string().trim().min(1).max(64),
  deputyId: optional(64),
  module: optional(40).refine((v) => !v || isDutySection(v)),
});
export type DutyInput = z.input<typeof dutySchema>;

// Adds or changes an item. Written for a person who holds a position, it is tied to that position.
// Saving a suggestion confirms it: whoever corrected it has looked at it.
export async function saveDuty(viewer: Actor, id: string | null, input: DutyInput) {
  const parsed = dutySchema.safeParse(input);
  if (!parsed.success) throw new DutyError("invalid");
  const values = parsed.data;
  const ctx = await dutyContext(viewer);
  const existing = id ? await db.responsibility.findUnique({ where: { id } }) : null;
  if (id && !existing) throw new DutyError("notFound");
  if (existing && !toDuty(existing, ctx).canEdit) throw new DutyError("forbidden");

  let link: { userId: string | null; positionId: string | null };
  let responsibleId: string | null;
  if (values.responsible === KEEP_PLACE) {
    // Stays on its place, which no app user holds.
    if (!existing || ownerOf(existing, ctx).owner.kind !== "place") throw new DutyError("invalid");
    link = { userId: existing.userId, positionId: existing.positionId };
    responsibleId = null;
  } else {
    const person = ctx.people.get(values.responsible);
    const current = existing ? ownerOf(existing, ctx).owner : null;
    const keeps = current?.kind === "person" && current.person.id === person?.id;
    if (!person || (person.deactivatedAt && !keeps)) throw new DutyError("invalid");
    if (!canEditDutiesOf(viewer, person.id, ctx.team)) throw new DutyError("forbidden");
    link = { userId: person.id, positionId: ctx.placeOf.get(person.id) ?? null };
    responsibleId = person.id;
  }
  if (values.deputyId) {
    const deputy = ctx.people.get(values.deputyId);
    const keeps = existing?.deputyId === values.deputyId;
    if (!deputy || (deputy.deactivatedAt && !keeps) || deputy.id === responsibleId)
      throw new DutyError("invalid");
  }

  const data = {
    title: values.title,
    description: values.description,
    module: values.module,
    deputyId: values.deputyId,
    ...link,
  };
  const saved = existing
    ? await db.responsibility.update({
        where: { id: existing.id },
        data: { ...data, status: "CONFIRMED" },
      })
    : await db.responsibility.create({
        data: {
          ...data,
          createdById: viewer.id,
          sortOrder: await db.responsibility.count({
            where: link.positionId ? { positionId: link.positionId } : { userId: link.userId },
          }),
        },
      });
  await logActivity({
    actorId: viewer.id,
    action: existing ? "responsibility.updated" : "responsibility.created",
    entityType: "Responsibility",
    entityId: saved.id,
    details: existing?.status === "SUGGESTED" ? { confirmed: true } : undefined,
  });
  return { duty: toDuty(saved, ctx), personId: responsibleId };
}

async function editable(viewer: Actor, id: string) {
  const found = await getDutyForEdit(viewer, id);
  if (!found) {
    const exists = await db.responsibility.count({ where: { id } });
    throw new DutyError(exists ? "forbidden" : "notFound");
  }
  return found;
}

// «Подтвердить» a suggestion: it becomes a normal item everyone with «Команда» sees.
export async function confirmDuty(viewer: Actor, id: string) {
  const { row, duty } = await editable(viewer, id);
  if (row.status !== "SUGGESTED") return duty;
  await db.responsibility.update({ where: { id }, data: { status: "CONFIRMED" } });
  await logActivity({
    actorId: viewer.id,
    action: "responsibility.confirmed",
    entityType: "Responsibility",
    entityId: id,
  });
  return { ...duty, status: "CONFIRMED" as const };
}

export async function deleteDuty(viewer: Actor, id: string) {
  const { row, duty } = await editable(viewer, id);
  await db.responsibility.delete({ where: { id } });
  await logActivity({
    actorId: viewer.id,
    action: "responsibility.deleted",
    entityType: "Responsibility",
    entityId: id,
    details: { title: row.title, status: row.status },
  });
  return duty;
}
