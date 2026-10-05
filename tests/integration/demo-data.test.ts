import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { addDemoData, DEMO_PROJECT, removeDemoData } from "@/modules/tasks/demo";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { telegramMock } from "@/tests/helpers/telegram";

describe("demo data", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("needs an owner", async () => {
    await expect(addDemoData()).rejects.toThrow("OWNER");
  });

  it("adds test tasks once, sends nothing to Telegram, and removes only its own data", async () => {
    const owner = await createTestUser("OWNER");
    const real = await createTestUser("MEMBER");
    const realTask = await db.task.create({
      data: {
        title: "Настоящая задача",
        creatorId: owner.id,
        assigneeId: real.id,
        status: "APPROVED",
      },
    });

    const first = await addDemoData(new Date("2026-10-05T06:00:00Z"));
    expect(first.tasks).toBeGreaterThan(15);
    expect((await addDemoData()).tasks).toBe(0); // second run adds nothing
    expect(await db.task.count({ where: { project: DEMO_PROJECT } })).toBe(first.tasks);
    expect(
      await db.user.count({ where: { firstName: { startsWith: "Тестовый" } } }),
    ).toBeGreaterThanOrEqual(4);
    expect(telegramMock).not.toHaveBeenCalled();

    // The owner has overdue tasks, tasks waiting for approval and for acceptance.
    expect(
      await db.task.count({ where: { project: DEMO_PROJECT, status: "PENDING_APPROVAL" } }),
    ).toBeGreaterThan(0);
    expect(
      await db.task.count({
        where: { project: DEMO_PROJECT, status: "IN_REVIEW", creatorId: owner.id },
      }),
    ).toBeGreaterThan(0);
    // "Тестовый сотрудник 1" of the demo data (test helpers use the same names).
    const employee = await db.user.findUniqueOrThrow({ where: { telegramId: 9_000_000_002n } });
    const overdue = await db.task.count({
      where: {
        assigneeId: employee.id,
        status: "IN_PROGRESS",
        dueDate: { lt: new Date("2026-10-05") },
      },
    });
    expect(overdue).toBeGreaterThan(0);

    const removed = await removeDemoData();
    expect(removed.tasks).toBe(first.tasks);
    expect(await db.task.count({ where: { project: DEMO_PROJECT } })).toBe(0);
    expect(
      await db.user.count({ where: { firstName: { startsWith: "Тестовый руководитель" } } }),
    ).toBe(0);
    // Real data stays.
    expect(await db.task.findUnique({ where: { id: realTask.id } })).not.toBeNull();
    expect(await db.user.findUnique({ where: { id: real.id } })).not.toBeNull();
  });
});
