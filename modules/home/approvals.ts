import { db } from "@/lib/db";
import { canUseModule, withAccess } from "@/modules/core/access/actor";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";
import { canPlanContent } from "@/modules/content/service";
import { canApprovePlanograms } from "@/modules/planograms/access";
import { loadRouting, nearestManager, type Person } from "@/modules/tasks/routing";

// «Ждут вашего решения» on «Сегодня» lists every approval, not only tasks: planograms sent for
// approval and content posts sent for review. Read-only here; the decision itself is made on the
// planogram's or the post's page, by the rules of those sections. Each item goes to the same
// people its section notifies, and nobody is asked to approve their own work (owner's decision).

export type OtherApproval = {
  kind: "planogram" | "post";
  id: string;
  title: string;
  // Who sent it.
  from: string;
  href: string;
  // A small picture of the planogram (its PNG export).
  image: string | null;
  // «Проверка юриста» for a post waiting for the lawyer.
  legal?: boolean;
};

// Who hears about a planogram sent for approval: the sender's nearest manager when they may
// approve planograms, otherwise the owners (as modules/planograms/service.ts tells them).
function planogramApprovers(people: Person[], senderId: string) {
  const managerId = nearestManager(people, senderId);
  const manager = people.find((p) => p.id === managerId);
  if (manager && manager.id !== senderId && canApprovePlanograms(manager.role)) return [manager.id];
  return people
    .filter((p) => p.role === "OWNER" && !p.deactivated && p.id !== senderId)
    .map((p) => p.id);
}

async function pendingPlanograms(actor: Actor): Promise<OtherApproval[]> {
  if (!canUseModule(actor, "planograms") || !canApprovePlanograms(actor.role)) return [];
  const pending = await db.planogram.findMany({
    where: { status: "PENDING_APPROVAL", isTemplate: false },
    select: { id: true, title: true, version: true, createdById: true },
    orderBy: { updatedAt: "asc" },
  });
  if (pending.length === 0) return [];
  // The sender: whoever sent it for approval last (the author by default).
  const sends = await db.activityLog.findMany({
    where: {
      entityType: "Planogram",
      action: "planogram.submitted",
      entityId: { in: pending.map((p) => p.id) },
    },
    select: { entityId: true, actorId: true },
    orderBy: { createdAt: "desc" },
  });
  const senderOf = (p: (typeof pending)[number]) =>
    sends.find((s) => s.entityId === p.id)?.actorId ?? p.createdById;
  const { people } = await loadRouting();
  const mine = pending.filter((p) => {
    const sender = senderOf(p);
    return sender !== actor.id && planogramApprovers(people, sender).includes(actor.id);
  });
  const senders = await db.user.findMany({
    where: { id: { in: mine.map(senderOf) } },
    select: { id: true, firstName: true, lastName: true },
  });
  return mine.map((p) => {
    const sender = senders.find((s) => s.id === senderOf(p));
    return {
      kind: "planogram",
      id: p.id,
      title: p.version > 1 ? `${p.title} · v${p.version}` : p.title,
      from: sender ? displayName(sender) : "",
      href: `/planograms/${p.id}`,
      image: `/api/planograms/${p.id}/export?format=png`,
    };
  });
}

// Who reviews a post (as modules/content/service.ts tells them): the planner who put it in the
// plan; for a post an employee added themselves — the owner and the managers with the section.
// The lawyer checks posts a planner approved.
async function postsToReview(actor: Actor): Promise<OtherApproval[]> {
  if (!canPlanContent(actor) && actor.role !== "LAWYER") return [];
  const lawyer = actor.role === "LAWYER";
  const posts = await db.contentPost.findMany({
    where: {
      status: lawyer ? "LEGAL_REVIEW" : "REVIEW",
      // Never one's own post (without an author: the one who added it).
      OR: [{ authorId: { not: actor.id } }, { authorId: null, createdById: { not: actor.id } }],
    },
    include: { author: { select: { firstName: true, lastName: true } }, createdBy: true },
    orderBy: { publishDate: "asc" },
  });
  const result: OtherApproval[] = [];
  for (const post of posts) {
    if (!lawyer) {
      const creator = post.createdBy;
      const authorIsCreator = post.authorId === creator.id;
      const creatorReviews =
        !creator.deactivatedAt && !authorIsCreator && canPlanContent(await withAccess(creator));
      const reviewer = creatorReviews
        ? creator.id === actor.id
        : actor.role === "OWNER" || actor.role === "MANAGER";
      if (!reviewer) continue;
    }
    result.push({
      kind: "post",
      id: post.id,
      title: post.title,
      from: post.author ? displayName(post.author) : "",
      href: `/content/${post.id}`,
      image: null,
      legal: lawyer,
    });
  }
  return result;
}

export async function listOtherApprovals(actor: Actor): Promise<OtherApproval[]> {
  const [planograms, posts] = await Promise.all([pendingPlanograms(actor), postsToReview(actor)]);
  return [...planograms, ...posts];
}
