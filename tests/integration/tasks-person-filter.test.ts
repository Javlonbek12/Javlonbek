import { beforeEach, describe, expect, it } from "vitest";

import { parseTaskFilters } from "@/modules/tasks/filters";
import { createTask, listTaskPeople, listTasks } from "@/modules/tasks/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";

const TODAY = "2026-10-19";

describe("employee filter in tasks", () => {
  beforeEach(resetDb);

  it("the owner sees one employee's tasks; an employee can't look into others'", async () => {
    const owner = await createTestUser("OWNER");
    const a = await createTestUser("MEMBER");
    const b = await createTestUser("MEMBER");
    const forA = await createTask(
      owner,
      taskInput({ title: "Тестовая А", assigneeId: a.id }),
      "create",
    );
    await createTask(owner, taskInput({ title: "Тестовая Б", assigneeId: b.id }), "create");

    // Everyone is in the list for the owner, also people with no tasks yet.
    const idle = await createTestUser("MEMBER");
    const people = (await listTaskPeople(owner)).map((p) => p.id).sort();
    expect(people).toEqual([owner.id, a.id, b.id, idle.id].sort());
    const ofA = await listTasks(owner, parseTaskFilters({ person: a.id }), TODAY);
    expect(ofA.map((t) => t.id)).toEqual([forA.id]);

    // An employee only gets what they may see anyway.
    expect(await listTasks(a, parseTaskFilters({ person: b.id }), TODAY)).toEqual([]);
    expect((await listTaskPeople(a)).map((p) => p.id)).toEqual([a.id]);
  });
});
