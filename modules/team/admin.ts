import { rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { generateInviteCode, INVITE_TTL_DAYS } from "@/modules/core/invites/service";
import { withAccess } from "@/modules/core/access/actor";
import { changeRole } from "@/modules/core/users/service";
import { displayName } from "@/modules/core/users/display-name";
import { matchUser, normName } from "@/modules/org/match";
import { linkPeopleByName, syncPeople } from "@/modules/org/service";
import { updateProject } from "@/modules/projects/service";

// Server maintenance for the owner (workflow Server → team-check / team-fix): who is in the app,
// their roles and places in the org chart; fixes roles, places and project leads by names.

export async function teamReport() {
  const [users, nodes, projects] = await Promise.all([
    db.user.findMany({
      include: { manager: true, orgNode: true },
      orderBy: { createdAt: "asc" },
    }),
    db.orgNode.findMany({ where: { kind: "POSITION" }, include: { user: true } }),
    db.project.findMany({ include: { lead: true } }),
  ]);
  const lines = ["Users:"];
  for (const u of users) {
    lines.push(
      `- ${displayName(u)}${u.telegramUsername ? ` (@${u.telegramUsername})` : ""} — ${u.role}` +
        ` · place: ${u.orgNode?.title ?? "none"} · manager: ${u.manager ? displayName(u.manager) : "none"}`,
    );
  }
  // Task counts per person (no titles): team tasks by status, personal ones only counted.
  const counts = await db.task.groupBy({
    by: ["assigneeId", "isPersonal", "status"],
    _count: { _all: true },
  });
  lines.push("Tasks (as assignee):");
  for (const u of users) {
    const own = counts.filter((c) => c.assigneeId === u.id);
    if (!own.length) {
      lines.push(`- ${displayName(u)}: none`);
      continue;
    }
    const personal = own.filter((c) => c.isPersonal).reduce((s, c) => s + c._count._all, 0);
    const team = own
      .filter((c) => !c.isPersonal)
      .map((c) => `${c.status} ${c._count._all}`)
      .join(", ");
    lines.push(`- ${displayName(u)}: team [${team || "none"}] · personal ${personal}`);
  }
  lines.push("Org chart places:");
  for (const n of nodes) {
    lines.push(
      `- ${n.title}: ${n.user ? `${displayName(n.user)} (in app)` : n.personName ? `${n.personName} (not in app)` : "vacancy"}`,
    );
  }
  lines.push("Projects:");
  for (const p of projects)
    lines.push(`- ${p.name}: lead ${p.lead ? displayName(p.lead) : "none"}`);
  return lines.join("\n");
}

const fixSchema = z.object({
  roles: z
    .array(z.object({ user: z.string(), role: z.enum(["MANAGER", "MEMBER", "LAWYER"]) }))
    .default([]),
  // A place by the person written on it (or its job title) → an app user.
  places: z.array(z.object({ place: z.string(), user: z.string() })).default([]),
  leads: z
    .array(
      z.object({ project: z.string(), user: z.string(), moveTasks: z.boolean().default(true) }),
    )
    .default([]),
  // Removes a user for good with everything they made or were given (see deleteUserCompletely).
  deleteUsers: z.array(z.object({ user: z.string() })).default([]),
  // Puts a place under another place (both by job title or person written on it).
  parents: z.array(z.object({ place: z.string(), parent: z.string() })).default([]),
  // An invite to a place, with any role (OWNER too: a second owner with full rights).
  placeInvites: z
    .array(z.object({ place: z.string(), role: z.enum(["OWNER", "MANAGER", "MEMBER", "LAWYER"]) }))
    .default([]),
});

// A place by its job title or the person written on it; exactly one must match.
async function findPlace(name: string) {
  const nodes = await db.orgNode.findMany({ where: { kind: "POSITION" } });
  const matches = nodes.filter(
    (n) =>
      (n.personName && normName(n.personName) === normName(name)) ||
      (n.title && normName(n.title) === normName(name)),
  );
  if (matches.length !== 1) throw new Error(`No single place "${name}" in the org chart.`);
  return matches[0]!;
}

// Deletes the user and everything that is theirs: tasks they created or were given (with
// comments and files), their comments and files elsewhere, plans, meetings, notes, content posts
// they added. Projects and the POSM distribution records they entered (purchases, orders,
// shipments, campaign files, price quotes) stay and pass to the owner.
export async function deleteUserCompletely(userId: string, ownerId: string) {
  if (userId === ownerId) throw new Error("The owner can't be deleted.");
  const root = path.resolve(getEnv().UPLOAD_DIR);
  const tasks = await db.task.findMany({
    where: { OR: [{ creatorId: userId }, { assigneeId: userId }] },
    select: { id: true },
  });
  const posts = await db.contentPost.findMany({
    where: { createdById: userId },
    select: { id: true },
  });
  const files = await db.taskAttachment.findMany({
    where: { uploadedById: userId, filePath: { not: null } },
    select: { filePath: true },
  });
  const taskIds = tasks.map((t) => t.id);
  const counts = await db.$transaction([
    db.task.deleteMany({ where: { id: { in: taskIds } } }),
    db.comment.deleteMany({ where: { authorId: userId } }),
    db.taskAttachment.deleteMany({ where: { uploadedById: userId } }),
    db.plan.deleteMany({ where: { createdById: userId } }),
    db.meetingNotes.deleteMany({ where: { authorId: userId } }),
    db.meeting.deleteMany({ where: { createdById: userId } }),
    db.employeeNote.deleteMany({ where: { authorId: userId } }),
    db.contentComment.deleteMany({ where: { authorId: userId } }),
    db.contentPost.deleteMany({ where: { createdById: userId } }),
    db.project.updateMany({ where: { createdById: userId }, data: { createdById: ownerId } }),
    db.distPurchase.updateMany({ where: { createdById: userId }, data: { createdById: ownerId } }),
    db.distOrder.updateMany({ where: { createdById: userId }, data: { createdById: ownerId } }),
    db.distShipment.updateMany({ where: { createdById: userId }, data: { createdById: ownerId } }),
    db.distCampaignFile.updateMany({
      where: { createdById: userId },
      data: { createdById: ownerId },
    }),
    db.distPriceQuote.updateMany({
      where: { createdById: userId },
      data: { createdById: ownerId },
    }),
    // Others' tasks lose them as a co-assignee.
    db.$executeRaw`UPDATE "Task" SET "coAssigneeIds" = array_remove("coAssigneeIds", ${userId}) WHERE ${userId} = ANY("coAssigneeIds")`,
    db.user.delete({ where: { id: userId } }),
  ]);
  for (const id of taskIds)
    await rm(path.join(root, "tasks", id), { recursive: true, force: true });
  for (const f of files) await rm(path.join(root, f.filePath!), { force: true });
  for (const p of posts)
    await rm(path.join(root, "content", p.id), { recursive: true, force: true });
  return { tasks: counts[0].count, posts: counts[8].count, meetings: counts[5].count };
}

export async function teamFix(input: unknown) {
  const fix = fixSchema.parse(input);
  const owner = await db.user.findFirst({
    where: { role: "OWNER" },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("No owner yet.");
  const actor = await withAccess(owner);
  const log: string[] = [];
  const users = await db.user.findMany({
    select: { id: true, firstName: true, lastName: true, telegramUsername: true },
  });
  const find = (name: string) => {
    const username = name.startsWith("@") ? name.slice(1).toLowerCase() : null;
    const id = username
      ? users.find((u) => u.telegramUsername?.toLowerCase() === username)?.id
      : matchUser(name, users);
    if (!id) throw new Error(`No single app user named "${name}".`);
    return id;
  };

  for (const { user, role } of fix.roles) {
    await changeRole(actor, find(user), role);
    log.push(`role: ${user} → ${role}`);
  }
  for (const { user } of fix.deleteUsers) {
    const userId = find(user);
    const removed = await deleteUserCompletely(userId, owner.id);
    log.push(
      `deleted: ${user} (tasks ${removed.tasks}, posts ${removed.posts}, meetings ${removed.meetings})`,
    );
  }
  for (const { place, user } of fix.places) {
    const userId = find(user);
    const node = await findPlace(place);
    await db.$transaction([
      db.orgNode.updateMany({ where: { userId }, data: { userId: null } }),
      db.orgNode.update({ where: { id: node.id }, data: { userId, personName: null } }),
    ]);
    log.push(`place: ${place} → ${user}`);
  }
  for (const { place, parent } of fix.parents) {
    const node = await findPlace(place);
    const above = await findPlace(parent);
    if (node.id === above.id) throw new Error(`"${place}" can't be under itself.`);
    // No loops: the new parent must not be below the place.
    for (let p = above.parentId; p;) {
      if (p === node.id) throw new Error(`"${parent}" is below "${place}".`);
      p = (await db.orgNode.findUnique({ where: { id: p } }))?.parentId ?? null;
    }
    await db.orgNode.update({ where: { id: node.id }, data: { parentId: above.id } });
    log.push(`parent: ${place} → under ${parent}`);
  }
  for (const { place, role } of fix.placeInvites) {
    const node = await findPlace(place);
    if (node.userId) throw new Error(`"${place}" is already taken in the app.`);
    await db.invite.updateMany({
      where: { orgNodeId: node.id, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await db.invite.create({
      data: {
        code: generateInviteCode(),
        role,
        createdById: owner.id,
        orgNodeId: node.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    // The link is not printed here: the owner copies it from the org chart page.
    log.push(`invite: ${place} as ${role} (link on the org chart page)`);
  }
  const linked = await linkPeopleByName();
  if (linked) log.push(`linked by name: ${linked}`);
  await syncPeople();
  for (const { project: name, user, moveTasks } of fix.leads) {
    const project = await db.project.findUnique({ where: { name } });
    if (!project) throw new Error(`No project "${name}".`);
    await updateProject(actor, project.id, { ...project, leadId: find(user) }, { moveTasks });
    log.push(`lead: ${name} → ${user}${moveTasks ? " (open tasks moved)" : ""}`);
  }
  return log;
}
