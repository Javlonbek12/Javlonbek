import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { deleteOrgNode, getOrgTree, orgPathOf, saveOrgNode } from "@/modules/org/service";
import { teamProfiles } from "@/modules/team/profile";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const unit = (name: string, parentId: string | null = null, title: string | null = null) => ({
  kind: "UNIT" as const,
  name,
  title,
  parentId,
});
const position = (title: string, extra: Record<string, string | null> = {}) => ({
  kind: "POSITION" as const,
  title,
  ...extra,
});

describe("org structure", () => {
  beforeEach(resetDb);

  it("builds a tree with people, outside people and vacancies; syncs title and manager", async () => {
    const owner = await createTestUser("OWNER", { firstName: "Тестовый директор" });
    const lead = await createTestUser("MANAGER", { firstName: "Тестовый руководитель" });
    const member = await createTestUser("MEMBER", { firstName: "Тестовый сотрудник 1" });

    const dept = await saveOrgNode(owner, null, unit("Тестовый отдел"));
    const director = await saveOrgNode(
      owner,
      null,
      position("Тестовый директор отдела", { userId: owner.id, parentId: dept.id }),
    );
    const leadNode = await saveOrgNode(
      owner,
      null,
      position("Тестовый лидер команды", {
        userId: lead.id,
        parentId: director.id,
        label: "Тестовая команда",
      }),
    );
    await saveOrgNode(
      owner,
      null,
      position("Тестовый координатор", { userId: member.id, parentId: leadNode.id }),
    );
    await saveOrgNode(
      owner,
      null,
      position("Тестовый ассистент", {
        personName: "Тестовый внешний человек",
        parentId: leadNode.id,
      }),
    );
    const project = await saveOrgNode(
      owner,
      null,
      unit("Тестовая проектная команда", leadNode.id, "Project Team"),
    );
    await saveOrgNode(
      owner,
      null,
      position("Тестовый младший ассистент", { parentId: project.id }),
    );

    const [root] = await getOrgTree();
    expect(root.name).toBe("Тестовый отдел");
    const leadTree = root.children[0].children[0];
    expect(leadTree.children.map((c) => c.user?.name ?? c.personName ?? c.name)).toEqual([
      "Тестовый сотрудник 1",
      "Тестовый внешний человек",
      "Тестовая проектная команда",
    ]);
    expect(leadTree.children[2].children[0]).toMatchObject({
      user: null,
      personName: null,
      title: "Тестовый младший ассистент",
    });

    // Title and manager go to the employee card.
    expect(await db.user.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({
      position: "Тестовый координатор",
      managerId: lead.id,
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: lead.id } })).managerId).toBe(owner.id);
    expect(await orgPathOf(member.id)).toEqual(["Тестовый отдел", "Тестовая команда"]);

    // Deleting the lead moves the people under them one level up.
    await deleteOrgNode(owner, leadNode.id);
    const [after] = await getOrgTree();
    expect(after.children[0].children.length).toBe(3);
  });

  it("refuses cycles, a person twice and edits by non-owners", async () => {
    const owner = await createTestUser("OWNER");
    const manager = await createTestUser("MANAGER");
    const a = await saveOrgNode(owner, null, position("A", { userId: manager.id }));
    const b = await saveOrgNode(owner, null, position("B", { parentId: a.id }));
    await expect(saveOrgNode(owner, a.id, position("A", { parentId: b.id }))).rejects.toMatchObject(
      { code: "cycle" },
    );
    await expect(
      saveOrgNode(owner, null, position("C", { userId: manager.id })),
    ).rejects.toMatchObject({ code: "userTaken" });
    await expect(saveOrgNode(manager, null, unit("X"))).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(saveOrgNode(owner, null, { kind: "POSITION" })).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("counts returns from review in the profile", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const now = new Date("2026-10-05T06:00:00Z");
    const done = (title: string) =>
      db.task.create({
        data: {
          title,
          creatorId: owner.id,
          assigneeId: member.id,
          status: "DONE",
          approvedAt: new Date("2026-09-20T06:00:00Z"),
          completedAt: new Date("2026-09-25T06:00:00Z"),
          dueDate: new Date("2026-09-30"),
        },
      });
    const returned = await done("Возвращалась");
    await done("Сразу");
    await db.activityLog.create({
      data: {
        actorId: owner.id,
        action: "task.status_changed",
        entityType: "Task",
        entityId: returned.id,
        details: { from: "IN_REVIEW", to: "IN_PROGRESS" },
      },
    });
    const { scores } = await teamProfiles("Asia/Tashkent", now);
    expect(scores.get(member.id)).toMatchObject({ onTime: 100, firstTime: 50, output: 100 });
  });
});
