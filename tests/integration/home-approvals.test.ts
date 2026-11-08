import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { listOtherApprovals } from "@/modules/home/approvals";
import { createTestUser, resetDb } from "@/tests/helpers/db";

// «Ждут вашего решения» on «Сегодня»: planograms sent for approval and posts sent for review, to
// whoever their section tells — and never one's own work.

async function planogram(createdById: string, status: "DRAFT" | "PENDING_APPROVAL") {
  const equipment = await db.equipment.upsert({
    where: { code: "TEST-EQ" },
    create: { code: "TEST-EQ", name: "Тестовая стойка", channel: "Тест", geometry: {} },
    update: {},
  });
  return db.planogram.create({
    data: {
      title: `Тестовая планограмма ${status}`,
      equipmentId: equipment.id,
      channel: "Тест",
      status,
      createdById,
    },
  });
}

describe("other approvals on «Сегодня»", () => {
  beforeEach(resetDb);

  it("a planogram goes to the sender's manager; the sender never sees their own", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const manager = await withAccess(await createTestUser("MANAGER"));
    const worker = await withAccess(await createTestUser("MEMBER"));
    await db.user.update({ where: { id: worker.id }, data: { managerId: manager.id } });
    const sent = await planogram(worker.id, "PENDING_APPROVAL");
    await planogram(worker.id, "DRAFT");
    const ownSent = await planogram(manager.id, "PENDING_APPROVAL");

    const forManager = await listOtherApprovals(manager);
    expect(forManager.map((a) => a.id)).toEqual([sent.id]);
    expect(forManager[0]).toMatchObject({
      kind: "planogram",
      href: `/planograms/${sent.id}`,
      image: `/api/planograms/${sent.id}/export?format=png`,
    });
    // The manager's own planogram goes to the owner (no manager above), not back to them.
    expect((await listOtherApprovals(owner)).map((a) => a.id)).toEqual([ownSent.id]);
    // A member can't approve planograms.
    expect(await listOtherApprovals(worker)).toEqual([]);
  });

  it("a post goes to the planner who planned it; the author never reviews their own", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const planner = await withAccess(await createTestUser("MANAGER"));
    const author = await withAccess(await createTestUser("MEMBER"));
    const base = { publishDate: new Date("2026-11-20T00:00:00Z"), status: "REVIEW" as const };
    const planned = await db.contentPost.create({
      data: { ...base, title: "Тестовый пост", authorId: author.id, createdById: planner.id },
    });
    // An employee's own post: the owner and the managers review it.
    const ownIdea = await db.contentPost.create({
      data: { ...base, title: "Тестовый свой пост", authorId: author.id, createdById: author.id },
    });

    const forPlanner = await listOtherApprovals(planner);
    expect(forPlanner.map((a) => a.id).sort()).toEqual([planned.id, ownIdea.id].sort());
    expect((await listOtherApprovals(owner)).map((a) => a.id)).toEqual([ownIdea.id]);
    expect(await listOtherApprovals(author)).toEqual([]);
  });
});
