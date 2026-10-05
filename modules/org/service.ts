import { z } from "zod";

import { db } from "@/lib/db";
import type { OrgNodeKind } from "@/lib/generated/prisma/enums";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";

// The org chart the owner draws: units (department, team, project team) and positions.
// Positions linked to app users also set their job title and manager in the employee card.

export class OrgError extends Error {
  constructor(public readonly code: "forbidden" | "invalid" | "notFound" | "cycle" | "userTaken") {
    super(code);
    this.name = "OrgError";
  }
}

export const canEditOrg = (actor: Actor) => actor.role === "OWNER";

export type OrgTreeNode = {
  id: string;
  kind: OrgNodeKind;
  name: string | null;
  title: string | null;
  label: string | null;
  personName: string | null;
  user: { id: string; name: string } | null;
  parentId: string | null;
  sortOrder: number;
  children: OrgTreeNode[];
};

export async function getOrgTree(): Promise<OrgTreeNode[]> {
  const rows = await db.orgNode.findMany({
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const nodes = new Map<string, OrgTreeNode>(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        kind: r.kind,
        name: r.name,
        title: r.title,
        label: r.label,
        personName: r.personName,
        user: r.user ? { id: r.user.id, name: displayName(r.user) } : null,
        parentId: r.parentId,
        sortOrder: r.sortOrder,
        children: [],
      },
    ]),
  );
  const roots: OrgTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const nodeSchema = z
  .object({
    kind: z.enum(["UNIT", "POSITION"]),
    name: text(120),
    title: text(120),
    label: text(120),
    userId: text(64),
    personName: text(120),
    parentId: text(64),
    sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  })
  .refine((v) => (v.kind === "UNIT" ? Boolean(v.name) : Boolean(v.title)));

export type OrgNodeInput = z.input<typeof nodeSchema>;

// All ids below the node (to stop a node from being moved under itself).
async function descendantIds(id: string): Promise<Set<string>> {
  const rows = await db.orgNode.findMany({ select: { id: true, parentId: true } });
  const result = new Set<string>();
  const walk = (parent: string) => {
    for (const r of rows) {
      if (r.parentId !== parent || result.has(r.id)) continue;
      result.add(r.id);
      walk(r.id);
    }
  };
  walk(id);
  return result;
}

export async function saveOrgNode(actor: Actor, id: string | null, input: OrgNodeInput) {
  if (!canEditOrg(actor)) throw new OrgError("forbidden");
  const parsed = nodeSchema.safeParse(input);
  if (!parsed.success) throw new OrgError("invalid");
  const data = { ...parsed.data };
  if (data.kind === "UNIT") Object.assign(data, { userId: null, personName: null });
  if (data.userId) data.personName = null;
  if (data.parentId) {
    if (data.parentId === id || (id && (await descendantIds(id)).has(data.parentId)))
      throw new OrgError("cycle");
    if (!(await db.orgNode.findUnique({ where: { id: data.parentId } })))
      throw new OrgError("notFound");
  }
  if (data.userId) {
    const taken = await db.orgNode.findUnique({ where: { userId: data.userId } });
    if (taken && taken.id !== id) throw new OrgError("userTaken");
    if (!(await db.user.findUnique({ where: { id: data.userId } }))) throw new OrgError("notFound");
  }
  const saved = id
    ? await db.orgNode.update({ where: { id }, data })
    : await db.orgNode.create({ data });
  await syncPeople();
  await logActivity({
    actorId: actor.id,
    action: "org.saved",
    entityType: "OrgNode",
    entityId: saved.id,
  });
  return saved;
}

// Deleting a node keeps its children: they move one level up.
export async function deleteOrgNode(actor: Actor, id: string) {
  if (!canEditOrg(actor)) throw new OrgError("forbidden");
  const node = await db.orgNode.findUnique({ where: { id } });
  if (!node) throw new OrgError("notFound");
  await db.$transaction([
    db.orgNode.updateMany({ where: { parentId: id }, data: { parentId: node.parentId } }),
    db.orgNode.delete({ where: { id } }),
  ]);
  await syncPeople();
  await logActivity({
    actorId: actor.id,
    action: "org.deleted",
    entityType: "OrgNode",
    entityId: id,
  });
}

// People placed in the chart get their job title from it, and as manager the nearest person
// above them who can be a manager (OWNER or MANAGER — the same rule as in the employee card).
export async function syncPeople() {
  const rows = await db.orgNode.findMany({
    include: { user: { select: { id: true, role: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const node of rows) {
    if (node.kind !== "POSITION" || !node.user) continue;
    let managerId: string | null = null;
    const seen = new Set<string>();
    for (
      let up = node.parentId ? byId.get(node.parentId) : undefined;
      up && !seen.has(up.id);
      up = up.parentId ? byId.get(up.parentId) : undefined
    ) {
      seen.add(up.id);
      if (
        up.user &&
        up.user.id !== node.user.id &&
        (up.user.role === "OWNER" || up.user.role === "MANAGER")
      ) {
        managerId = up.user.id;
        break;
      }
    }
    await db.user.update({
      where: { id: node.user.id },
      data: { position: node.title, ...(managerId ? { managerId } : {}) },
    });
  }
}

// Where the person sits: the units above their position, nearest last ("Marketing Department › Marketing Team").
export async function orgPathOf(userId: string): Promise<string[] | null> {
  const rows = await db.orgNode.findMany();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const own = rows.find((r) => r.userId === userId);
  if (!own) return null;
  const path: string[] = [];
  if (own.label) path.unshift(own.label);
  const seen = new Set<string>();
  for (
    let up = own.parentId ? byId.get(own.parentId) : undefined;
    up && !seen.has(up.id);
    up = up.parentId ? byId.get(up.parentId) : undefined
  ) {
    seen.add(up.id);
    if (up.kind === "UNIT" && up.name) path.unshift(up.name);
    else if (up.label) path.unshift(up.label);
  }
  return path;
}
