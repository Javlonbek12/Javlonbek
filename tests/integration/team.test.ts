import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { saveOrgNode } from "@/modules/org/service";
import {
  addEmployeeNote,
  deleteEmployeeNote,
  getEmployeeCard,
  listTeam,
  listTeamCards,
  updateOwnContacts,
  updateProfile,
} from "@/modules/team/service";
import { changeStatus, createTask } from "@/modules/tasks/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";

async function team() {
  const owner = await createTestUser("OWNER");
  const boss = await createTestUser("MANAGER");
  const otherBoss = await createTestUser("MANAGER");
  const employee = await createTestUser("MEMBER");
  const colleague = await createTestUser("MEMBER");
  await updateProfile(owner, employee.id, profile({ managerId: boss.id }));
  return { owner, boss, otherBoss, employee, colleague };
}

const profile = (overrides: Partial<Parameters<typeof updateProfile>[2]> = {}) => ({
  position: null,
  responsibility: null,
  phone: null,
  email: null,
  startedAt: null,
  managerId: null,
  ...overrides,
});

describe("private notes are seen only by the OWNER and the direct manager", () => {
  beforeEach(resetDb);

  it("enforces who can read and write", async () => {
    const { owner, boss, otherBoss, employee, colleague } = await team();
    await addEmployeeNote(boss, employee.id, "STRENGTH", "Отлично работает с дистрибьюторами");
    await addEmployeeNote(owner, employee.id, "GROWTH", "Сроки по отчётам");

    expect((await getEmployeeCard(boss, employee.id))!.notes).toHaveLength(2);
    expect((await getEmployeeCard(owner, employee.id))!.notes).toHaveLength(2);
    // The employee, a colleague and another manager get no notes at all.
    expect((await getEmployeeCard(employee, employee.id))!.notes).toBeNull();
    expect((await getEmployeeCard(colleague, employee.id))!.notes).toBeNull();
    expect((await getEmployeeCard(otherBoss, employee.id))!.notes).toBeNull();

    await expect(
      addEmployeeNote(employee, employee.id, "STRENGTH", "Я молодец"),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(addEmployeeNote(otherBoss, employee.id, "GOAL", "x")).rejects.toMatchObject({
      code: "forbidden",
    });
    // The activity log never contains the note text.
    const logs = await db.activityLog.findMany({ where: { action: "user.note_added" } });
    expect(JSON.stringify(logs)).not.toContain("дистрибьюторами");
  });

  it("a manager loses access when the employee moves to another manager", async () => {
    const { owner, boss, otherBoss, employee } = await team();
    const note = await addEmployeeNote(boss, employee.id, "ONE_ON_ONE", "1:1 от 1 октября");
    await updateProfile(owner, employee.id, profile({ managerId: otherBoss.id }));
    expect((await getEmployeeCard(boss, employee.id))!.notes).toBeNull();
    expect((await getEmployeeCard(otherBoss, employee.id))!.notes).toHaveLength(1);
    await expect(deleteEmployeeNote(boss, note.id)).rejects.toMatchObject({ code: "forbidden" });
    await deleteEmployeeNote(owner, note.id);
  });
});

describe("profile", () => {
  beforeEach(resetDb);

  it("each role changes only its fields", async () => {
    const { owner, boss, employee, colleague } = await team();
    await updateProfile(
      employee,
      employee.id,
      profile({ phone: "+998 90 000 00 00", position: "Директор" }),
    );
    await updateProfile(boss, employee.id, profile({ position: "Тестовая должность" }));
    const user = await db.user.findUniqueOrThrow({ where: { id: employee.id } });
    // The employee changed only the phone (not the position); the boss only the position.
    expect(user).toMatchObject({
      phone: "+998 90 000 00 00",
      position: "Тестовая должность",
      managerId: boss.id,
    });
    await expect(
      updateProfile(colleague, employee.id, profile({ phone: "1" })),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      updateProfile(owner, boss.id, profile({ managerId: employee.id })),
    ).rejects.toMatchObject({ code: "manager" });
  });
});

describe("statistics from real tasks", () => {
  beforeEach(resetDb);

  it("counts active, overdue and on-time work", async () => {
    const { owner, employee, colleague } = await team();
    const late = await createTask(
      owner,
      taskInput({ assigneeId: employee.id, dueDate: "2020-01-01" }),
      "create",
    );
    const done = await createTask(
      owner,
      taskInput({ assigneeId: employee.id, dueDate: "2099-01-01" }),
      "create",
    );
    await changeStatus(employee, done.id, "IN_PROGRESS");
    await changeStatus(employee, done.id, "IN_REVIEW");
    await changeStatus(owner, done.id, "DONE");
    // Personal tasks are private and not counted.
    await createTask(employee, taskInput({ isPersonal: true, dueDate: "2020-01-01" }));

    const card = await getEmployeeCard(owner, employee.id);
    expect(card!.stats).toMatchObject({
      active: 1,
      overdue: 1,
      onTime30: { onTime: 1, total: 1, percent: 100 },
    });
    expect(late.status).toBe("APPROVED");

    // Colleagues don't see each other's statistics.
    expect((await getEmployeeCard(colleague, employee.id))!.stats).toBeNull();
    const grid = await listTeamCards(owner, "overdue");
    expect(grid.map((c) => c.user.id)).toEqual([employee.id]);
  });

  it("«my team» filter shows direct reports", async () => {
    const { boss, employee } = await team();
    expect((await listTeamCards(boss, "mine")).map((c) => c.user.id)).toEqual([employee.id]);
  });

  it("work handed in for review is not overdue (the same as in Tasks)", async () => {
    const { owner, employee } = await team();
    const task = await createTask(
      owner,
      taskInput({ assigneeId: employee.id, dueDate: "2020-01-01" }),
      "create",
    );
    await changeStatus(employee, task.id, "IN_PROGRESS");
    await changeStatus(employee, task.id, "IN_REVIEW");
    expect((await getEmployeeCard(owner, employee.id))!.stats).toMatchObject({
      active: 1,
      overdue: 0,
    });
    expect(await listTeamCards(owner, "overdue")).toEqual([]);
  });

  it("filter chips count people; «Бот не подключён»; teams come from the org chart", async () => {
    const { owner, employee, colleague } = await team();
    await db.user.update({ where: { id: colleague.id }, data: { botChatId: null } });
    await saveOrgNode(owner, null, { kind: "UNIT", name: "Тестовый отдел" }).then((unit) =>
      saveOrgNode(owner, null, {
        kind: "POSITION",
        title: "Тест",
        userId: employee.id,
        parentId: unit.id,
      }),
    );
    const { cards, counts, hasChart } = await listTeam(owner, "nobot");
    expect(cards.map((c) => c.user.id)).toEqual([colleague.id]);
    expect(counts).toMatchObject({ all: 5, nobot: 1, deactivated: 0 });
    expect(hasChart).toBe(true);
    const all = (await listTeam(owner)).cards;
    expect(all.find((c) => c.user.id === employee.id)!.team).toBe("Тестовый отдел");
    expect(all.find((c) => c.user.id === colleague.id)!.team).toBeNull();
  });

  it("everyone keeps their own phone and email; nothing else changes", async () => {
    const { employee } = await team();
    await updateOwnContacts(employee, { phone: "+998 00 000-00-00", email: "test@example.test" });
    const saved = await db.user.findUniqueOrThrow({ where: { id: employee.id } });
    expect(saved).toMatchObject({ phone: "+998 00 000-00-00", email: "test@example.test" });
    expect(saved.managerId).not.toBeNull();
    await expect(updateOwnContacts(employee, { phone: "", email: "не почта" })).rejects.toThrow();
  });
});
