import { beforeEach, describe, expect, it } from "vitest";

import {
  addDependency,
  getDependencies,
  removeDependency,
} from "@/modules/tasks/dependency-service";
import { changeStatus, createTask, getTaskDetail } from "@/modules/tasks/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";

describe("dependencies", () => {
  beforeEach(resetDb);

  async function setup() {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const make = (title: string) =>
      createTask(owner, taskInput({ title, assigneeId: member.id }), "create");
    return { owner, member, a: await make("A"), b: await make("B"), c: await make("C") };
  }

  it("a task cannot be closed while a blocking task is open", async () => {
    const { owner, member, a, b } = await setup();
    await addDependency(owner, b.id, a.id); // A blocks B

    await changeStatus(member, b.id, "IN_PROGRESS");
    await changeStatus(member, b.id, "IN_REVIEW");
    await expect(changeStatus(owner, b.id, "DONE")).rejects.toMatchObject({ code: "blocked" });
    expect((await getTaskDetail(owner, b.id))?.task.openBlockers).toBe(1);

    // Once A is closed B can be accepted, but a cancelled A needs a conscious «despite».
    await changeStatus(owner, a.id, "CANCELLED");
    await expect(changeStatus(owner, b.id, "DONE")).rejects.toMatchObject({
      code: "cancelledDependency",
    });
    expect((await getTaskDetail(owner, b.id))?.cancelledBlockers).toBe(1);
    await expect(
      changeStatus(owner, b.id, "DONE", { despiteCancelled: true }),
    ).resolves.toMatchObject({ status: "DONE" });
  });

  it("rejects links that would make a loop", async () => {
    const { owner, a, b, c } = await setup();
    await addDependency(owner, b.id, a.id); // A → B
    await addDependency(owner, c.id, b.id); // B → C
    await expect(addDependency(owner, a.id, c.id)).rejects.toMatchObject({ code: "cycle" });
  });

  it("shows the whole chain and can remove a link", async () => {
    const { owner, a, b, c } = await setup();
    await addDependency(owner, b.id, a.id);
    await addDependency(owner, c.id, b.id);

    const deps = await getDependencies(owner, c.id);
    expect(deps.blockedBy.map((t) => t.title)).toEqual(["B"]);
    expect(deps.upstream.map((t) => t.title).sort()).toEqual(["A", "B"]);

    await removeDependency(owner, c.id, b.id);
    expect((await getDependencies(owner, c.id)).blockedBy).toEqual([]);
  });

  it("the assignee (who cannot edit the task) cannot add links", async () => {
    const { member, a, b } = await setup();
    await expect(addDependency(member, b.id, a.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("does not link a personal task with a team task", async () => {
    const { owner, a } = await setup();
    const personal = await createTask(owner, taskInput({ isPersonal: true }));
    await expect(addDependency(owner, personal.id, a.id)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
