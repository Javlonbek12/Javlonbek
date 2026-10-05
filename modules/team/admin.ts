import { z } from "zod";

import { db } from "@/lib/db";
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
  roles: z.array(z.object({ user: z.string(), role: z.enum(["MANAGER", "MEMBER"]) })).default([]),
  // A place by the person written on it (or its job title) → an app user.
  places: z.array(z.object({ place: z.string(), user: z.string() })).default([]),
  leads: z
    .array(
      z.object({ project: z.string(), user: z.string(), moveTasks: z.boolean().default(true) }),
    )
    .default([]),
});

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
  for (const { place, user } of fix.places) {
    const userId = find(user);
    const nodes = await db.orgNode.findMany({ where: { kind: "POSITION" } });
    const matches = nodes.filter(
      (n) =>
        (n.personName && normName(n.personName) === normName(place)) ||
        (n.title && normName(n.title) === normName(place)),
    );
    if (matches.length !== 1) throw new Error(`No single place "${place}" in the org chart.`);
    await db.$transaction([
      db.orgNode.updateMany({ where: { userId }, data: { userId: null } }),
      db.orgNode.update({ where: { id: matches[0].id }, data: { userId, personName: null } }),
    ]);
    log.push(`place: ${place} → ${user}`);
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
