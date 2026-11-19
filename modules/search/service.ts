import { db } from "@/lib/db";
import { formatDay, toDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { canUseModule } from "@/modules/core/access/actor";
import { canOpenPath } from "@/modules/core/access/paths";
import { invitableRoles, type Actor } from "@/modules/core/permissions";
import { modulesForRole } from "@/modules/core/registry";
import { ACTIVE_USER } from "@/modules/core/users/active";
import { displayName } from "@/modules/core/users/display-name";
import { canAddContent } from "@/modules/content/service";
import { visibleMeetingsWhere } from "@/modules/meetings/access";
import { canManagePlanograms } from "@/modules/planograms/access";
import { planogramCards } from "@/modules/planograms/service";
import { visibleProjectsWhere } from "@/modules/projects/service";
import { visibleTasksWhere } from "@/modules/tasks/access";
import { ownerText, searchDuties } from "@/modules/team/responsibilities";

import { MAX_QUERY, MIN_QUERY, SEARCH_GROUPS, type SearchGroup, type SearchHit } from "./types";

// The search in the top bar: sections and actions, people, responsibilities, tasks, meetings,
// projects, content posts and planograms. Each kind is searched with its own module's access rules, so a person only
// finds what they may open.

const LIMIT = 5;

export type Searcher = Actor & { access: NonNullable<Actor["access"]> };

const normalize = (text: string) => text.toLowerCase().replaceAll("ё", "е");
const insensitive = (value: string) => ({ contains: value, mode: "insensitive" as const });

const ACTION_HREF = {
  newTask: "/tasks/new",
  newMeeting: "/meetings/new",
  // The team page opens its invitation form with ?invite=1.
  invite: "/team?invite=1",
  newPost: "/content/new",
  newPlanogram: "/planograms/new",
} as const;

// Sections of the menu the person has, and the actions they may take, matching the query.
function navigation(actor: Searcher, query: string): SearchHit[] {
  const q = normalize(query);
  const sections: SearchHit[] = modulesForRole(actor.role, undefined, actor.access.modules).map(
    (module) => ({
      id: `section:${module.id}`,
      title: t(module.titleKey),
      subtitle: t("shell.find.section"),
      href: module.href,
      kind: "section",
      module: module.id,
    }),
  );
  const actions: [key: keyof typeof ACTION_HREF, allowed: boolean][] = [
    ["newTask", true],
    ["newMeeting", canUseModule(actor, "meetings")],
    ["invite", invitableRoles(actor.role).length > 0 && canOpenPath(actor, "/team")],
    ["newPost", canAddContent(actor)],
    ["newPlanogram", canOpenPath(actor, "/planograms") && canManagePlanograms(actor.role)],
  ];
  const allowed: SearchHit[] = actions
    .filter(([, ok]) => ok)
    .map(([key]) => ({
      id: `action:${key}`,
      title: t(`shell.find.actions.${key}`),
      subtitle: t("shell.find.action"),
      href: ACTION_HREF[key],
      kind: "action",
    }));
  return [...sections, ...allowed].filter((hit) => normalize(hit.title).includes(q));
}

// Active colleagues by name, job title or Telegram username; every word of the query must match.
async function people(actor: Searcher, query: string): Promise<SearchHit[]> {
  // Employee cards (/team/<id>) open with the team list or the org chart.
  if (!canOpenPath(actor, "/team/card")) return [];
  const words = query.split(/\s+/).filter(Boolean);
  const users = await db.user.findMany({
    where: {
      ...ACTIVE_USER,
      AND: words.map((word) => ({
        OR: [
          { firstName: insensitive(word) },
          { lastName: insensitive(word) },
          { position: insensitive(word) },
          { telegramUsername: insensitive(word) },
        ],
      })),
    },
    select: { id: true, firstName: true, lastName: true, position: true, role: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: LIMIT,
  });
  return users.map((user) => ({
    id: `person:${user.id}`,
    title: displayName(user),
    subtitle: user.position || t(`roles.${user.role}`),
    href: `/team/${user.id}`,
    kind: "person",
  }));
}

// Responsibilities («Команда» → «Обязанности») by title or description: a hit opens the
// responsible person's card at its «Обязанности» block (a place nobody holds: the list).
async function responsibilities(actor: Searcher, query: string): Promise<SearchHit[]> {
  const duties = await searchDuties(actor, query, LIMIT);
  return duties.map((duty) => {
    const { owner } = duty;
    return {
      id: `responsibility:${duty.id}`,
      title: duty.title,
      subtitle: ownerText(owner),
      href:
        owner.kind === "person"
          ? `/team/${owner.person.id}?tab=profile#responsibilities`
          : `/team?${new URLSearchParams({ view: "duties", q: duty.title })}`,
      kind: "responsibility",
    };
  });
}

// The tasks the person sees (modules/tasks/access.ts), by title or plan code («T01»).
async function tasks(actor: Searcher, query: string): Promise<SearchHit[]> {
  const rows = await db.task.findMany({
    where: {
      AND: [
        visibleTasksWhere(actor),
        { OR: [{ title: insensitive(query) }, { code: { equals: query, mode: "insensitive" } }] },
      ],
    },
    select: { id: true, title: true, status: true, dueDate: true },
    orderBy: [{ updatedAt: "desc" }],
    take: LIMIT,
  });
  const hits: SearchHit[] = rows.map((task) => ({
    id: `task:${task.id}`,
    title: task.title,
    subtitle: [
      t(`tasks.status.${task.status}`),
      task.dueDate && t("shell.find.due", { date: formatDay(toDateString(task.dueDate)) }),
    ]
      .filter(Boolean)
      .join(" · "),
    href: `/tasks/${task.id}`,
    kind: "task",
  }));
  // There may be more: the task list searches all of them.
  if (rows.length === LIMIT) {
    hits.push({
      id: "task:all",
      title: t("shell.find.allTasks", { q: query }),
      subtitle: null,
      href: `/tasks?${new URLSearchParams({ q: query })}`,
      kind: "task",
      more: true,
    });
  }
  return hits;
}

async function meetings(actor: Searcher, query: string, timezone: string): Promise<SearchHit[]> {
  if (!canUseModule(actor, "meetings")) return [];
  const rows = await db.meeting.findMany({
    where: { AND: [visibleMeetingsWhere(actor), { title: insensitive(query) }] },
    select: { id: true, title: true, startsAt: true },
    orderBy: { startsAt: "desc" },
    take: LIMIT,
  });
  return rows.map((meeting) => ({
    id: `meeting:${meeting.id}`,
    title: meeting.title,
    subtitle: formatDateTime(meeting.startsAt, timezone),
    href: `/meetings/${meeting.id}`,
    kind: "meeting",
  }));
}

// Projects the person can open — the rule of modules/projects/service.ts: the owner all; others
// the ones they lead, and, with the section, the ones they see tasks in.
async function projects(actor: Searcher, query: string): Promise<SearchHit[]> {
  // The projects page's own rule: the owner sees all; others their own and those they have tasks in.
  const visible = await db.project.findMany({
    where: {
      AND: [await visibleProjectsWhere(actor), { archived: false, name: insensitive(query) }],
    },
    select: { id: true, name: true, lead: { select: { firstName: true, lastName: true } } },
    orderBy: { name: "asc" },
    take: LIMIT,
  });
  return visible.map((project) => ({
    id: `project:${project.id}`,
    title: project.name,
    subtitle: project.lead ? displayName(project.lead) : null,
    href: `/projects/${project.id}`,
    kind: "project",
  }));
}

// The content plan is open to everyone with the section (modules/content/service.ts).
async function content(actor: Searcher, query: string): Promise<SearchHit[]> {
  if (!canOpenPath(actor, "/content")) return [];
  const rows = await db.contentPost.findMany({
    where: { title: insensitive(query) },
    select: { id: true, title: true, status: true, publishDate: true },
    orderBy: { publishDate: "desc" },
    take: LIMIT,
  });
  return rows.map((post) => ({
    id: `content:${post.id}`,
    title: post.title,
    subtitle: `${t(`content.status.${post.status}`)} · ${formatDay(toDateString(post.publishDate))}`,
    href: `/content/${post.id}`,
    kind: "content",
  }));
}

// Planograms are open to everyone with the section: one card per planogram, its current version.
async function planograms(actor: Searcher, query: string): Promise<SearchHit[]> {
  if (!canOpenPath(actor, "/planograms")) return [];
  const cards = await planogramCards({ query });
  return cards.slice(0, LIMIT).map((card) => ({
    id: `planogram:${card.id}`,
    title: card.title,
    subtitle: `${t(`planograms.status.${card.status}`)} · ${card.equipment.name}`,
    href: `/planograms/${card.id}`,
    kind: "planogram",
  }));
}

export async function search(
  actor: Searcher,
  rawQuery: string,
  timezone: string,
): Promise<SearchGroup[]> {
  const query = rawQuery.trim().replace(/\s+/g, " ").slice(0, MAX_QUERY);
  if (query.length < MIN_QUERY) return [];
  const found = await Promise.all([
    navigation(actor, query),
    people(actor, query),
    responsibilities(actor, query),
    tasks(actor, query),
    meetings(actor, query, timezone),
    projects(actor, query),
    content(actor, query),
    planograms(actor, query),
  ]);
  return SEARCH_GROUPS.map((key, index) => ({ key, hits: found[index]! })).filter(
    (group) => group.hits.length > 0,
  );
}
