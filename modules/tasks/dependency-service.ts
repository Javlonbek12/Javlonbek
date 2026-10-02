import { db } from "@/lib/db";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { canEditTask, canViewTask, visibleTasksWhere } from "./access";
import { dependencyChain, wouldCreateCycle } from "./dependencies";
import { TaskError } from "./errors";

async function loadEditable(actor: Actor, blockedId: string, blockerId: string) {
  const [blocked, blocker] = await Promise.all([
    db.task.findUnique({ where: { id: blockedId } }),
    db.task.findUnique({ where: { id: blockerId } }),
  ]);
  if (!blocked || !blocker || !canEditTask(actor, blocked) || !canViewTask(actor, blocker)) {
    throw new TaskError("forbidden");
  }
  // Personal and team tasks are not linked, so nobody learns about others' personal tasks.
  if (blocked.isPersonal !== blocker.isPersonal) throw new TaskError("forbidden");
  return { blocked, blocker };
}

// "blocker blocks blocked": blocked can't be DONE until blocker is closed.
export async function addDependency(actor: Actor, blockedId: string, blockerId: string) {
  await loadEditable(actor, blockedId, blockerId);
  const edges = await db.taskDependency.findMany({ select: { blockerId: true, blockedId: true } });
  if (wouldCreateCycle(edges, blockerId, blockedId)) throw new TaskError("cycle");

  await db.taskDependency.upsert({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    create: { blockerId, blockedId },
    update: {},
  });
  await logActivity({
    actorId: actor.id,
    action: "task.dependency_added",
    entityType: "Task",
    entityId: blockedId,
    details: { blockerId },
  });
}

export async function removeDependency(actor: Actor, blockedId: string, blockerId: string) {
  await loadEditable(actor, blockedId, blockerId);
  await db.taskDependency.deleteMany({ where: { blockerId, blockedId } });
  await logActivity({
    actorId: actor.id,
    action: "task.dependency_removed",
    entityType: "Task",
    entityId: blockedId,
    details: { blockerId },
  });
}

const chainSelect = { id: true, title: true, status: true } as const;

// Direct links plus the whole chain, limited to tasks the actor can see.
export async function getDependencies(actor: Actor, taskId: string) {
  const edges = await db.taskDependency.findMany({ select: { blockerId: true, blockedId: true } });
  const { upstream, downstream } = dependencyChain(edges, taskId);
  const ids = [...upstream, ...downstream];
  const tasks = await db.task.findMany({
    where: { AND: [visibleTasksWhere(actor), { id: { in: ids } }] },
    select: chainSelect,
  });
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const pick = (list: string[]) => list.map((id) => byId.get(id)).filter((t) => t !== undefined);

  return {
    blockedBy: pick(edges.filter((e) => e.blockedId === taskId).map((e) => e.blockerId)),
    blocks: pick(edges.filter((e) => e.blockerId === taskId).map((e) => e.blockedId)),
    upstream: pick([...upstream]),
    downstream: pick([...downstream]),
  };
}

// Candidates for "add a blocking task": visible, same kind, open, not already linked.
export async function listBlockerCandidates(actor: Actor, taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) return [];
  return db.task.findMany({
    where: {
      AND: [
        visibleTasksWhere(actor),
        {
          id: { not: taskId },
          isPersonal: task.isPersonal,
          status: { notIn: ["DONE", "CANCELLED"] },
          blocks: { none: { blockedId: taskId } },
        },
      ],
    },
    select: chainSelect,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
