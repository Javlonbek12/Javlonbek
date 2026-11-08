import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { createProject } from "@/modules/projects/service";
import { getTaskFormOptions } from "@/modules/tasks/form-options";
import { createTask, updateTask } from "@/modules/tasks/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";

// The task form: the project is chosen from the list with its phase; a phase from another project
// is never kept.

describe("task form: project and phase", () => {
  beforeEach(resetDb);

  it("a task gets the phase of its project; a foreign phase is dropped", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    await createProject(owner, { name: "Тестовый проект А" });
    await createProject(owner, { name: "Тестовый проект Б" });
    const [a, b] = await db.project.findMany({ orderBy: { name: "asc" } });
    const phaseA = await db.projectPhase.create({ data: { projectId: a!.id, title: "Фаза А" } });
    const phaseB = await db.projectPhase.create({ data: { projectId: b!.id, title: "Фаза Б" } });

    const options = await getTaskFormOptions(owner);
    expect(options.projects.find((p) => p.name === a!.name)?.phases).toEqual([
      { id: phaseA.id, title: "Фаза А" },
    ]);

    const task = await createTask(
      owner,
      taskInput({ assigneeId: owner.id, project: a!.name, phaseId: phaseA.id }),
      "create",
      { extra: { labels: ["тест"] } },
    );
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      phaseId: phaseA.id,
      labels: ["тест"],
    });
    const foreign = await createTask(
      owner,
      taskInput({ assigneeId: owner.id, project: a!.name, phaseId: phaseB.id }),
      "create",
    );
    expect((await db.task.findUniqueOrThrow({ where: { id: foreign.id } })).phaseId).toBeNull();

    // Moved to another project: the old phase doesn't come along.
    await updateTask(owner, task.id, taskInput({ assigneeId: owner.id, project: b!.name }));
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).phaseId).toBeNull();
    await updateTask(
      owner,
      task.id,
      taskInput({ assigneeId: owner.id, project: b!.name, phaseId: phaseB.id }),
    );
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).phaseId).toBe(phaseB.id);
  });
});
