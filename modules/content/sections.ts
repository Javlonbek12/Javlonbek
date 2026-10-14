import { z } from "zod";

import { db } from "@/lib/db";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { canPlanContent, ContentError } from "./service";
import { retagPosts } from "./tagging";

// Sections (topics) of content analytics. Planners add, rename, reorder and archive them;
// AI tags posts with the active ones.

export async function listSections() {
  const rows = await db.contentSection.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { posts: true } } },
  });
  return rows.map(({ _count, ...s }) => ({ ...s, posts: _count.posts }));
}

const sectionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  nameEn: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => v || null),
  description: z
    .string()
    .trim()
    .max(300)
    .transform((v) => v || null),
  sortOrder: z.coerce.number().int().min(0).max(999),
});

const log = (actor: Actor, action: string, id: string, details?: Record<string, string>) =>
  logActivity({ actorId: actor.id, action, entityType: "ContentSection", entityId: id, details });

function guard(actor: Actor) {
  if (!canPlanContent(actor)) throw new ContentError("forbidden");
}

// Creates (id = null) or updates a section. Names are unique among sections.
export async function saveSection(
  actor: Actor,
  id: string | null,
  input: z.input<typeof sectionSchema>,
) {
  guard(actor);
  const parsed = sectionSchema.safeParse(input);
  if (!parsed.success) throw new ContentError("invalid");
  const twin = await db.contentSection.findFirst({
    where: {
      name: { equals: parsed.data.name, mode: "insensitive" },
      ...(id ? { NOT: { id } } : {}),
    },
  });
  if (twin) throw new ContentError("invalid");
  if (id) {
    const found = await db.contentSection.findUnique({ where: { id } });
    if (!found) throw new ContentError("notFound");
    await db.contentSection.update({ where: { id }, data: parsed.data });
    await log(actor, "content.section_saved", id, { name: parsed.data.name });
    return id;
  }
  const created = await db.contentSection.create({ data: parsed.data });
  await log(actor, "content.section_created", created.id, { name: created.name });
  return created.id;
}

// An archived section is no longer offered to AI or in the forms; its posts keep the tag.
export async function setSectionArchived(actor: Actor, id: string, archived: boolean) {
  guard(actor);
  const found = await db.contentSection.findUnique({ where: { id } });
  if (!found) throw new ContentError("notFound");
  await db.contentSection.update({ where: { id }, data: { archived } });
  await log(actor, archived ? "content.section_archived" : "content.section_restored", id);
}

// Only a section without posts can be deleted (otherwise archive it).
export async function deleteSection(actor: Actor, id: string) {
  guard(actor);
  const found = await db.contentSection.findUnique({
    where: { id },
    include: { _count: { select: { posts: true } } },
  });
  if (!found) throw new ContentError("notFound");
  if (found._count.posts > 0) throw new ContentError("state");
  await db.contentSection.delete({ where: { id } });
  await log(actor, "content.section_deleted", id, { name: found.name });
}

// Sends the posts of the period (or all) to AI again, e.g. after new sections were added.
export async function retagContent(actor: Actor, from?: string, to?: string) {
  guard(actor);
  const count = await retagPosts(from, to);
  await logActivity({
    actorId: actor.id,
    action: "content.retagged",
    entityType: "ContentPost",
    entityId: "all",
    details: { count, ...(from && to ? { from, to } : {}) },
  });
  return count;
}
