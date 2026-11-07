import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { deleteTask, getDeleteMode, restoreTask } from "@/modules/tasks/delete-service";
import { getNote, saveNote } from "@/modules/tasks/notes";
import { changeStatus, createTask } from "@/modules/tasks/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";
import { telegramMock } from "@/tests/helpers/telegram";

// The task's shared notes («Заметки», BACKLOG item 24).

describe("task notes", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("everyone who sees the task writes the notes; a save over a newer one is refused", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const stranger = await createTestUser("MEMBER");
    const task = await createTask(
      owner,
      taskInput({ title: "Тестовая задача", assigneeId: member.id }),
      "create",
    );
    expect(await getNote(task.id)).toMatchObject({ text: "", version: 0 });

    const first = await saveNote(owner, task.id, "# План\n- [ ] позвонить", 0);
    expect(first).toMatchObject({ ok: true, version: 1 });
    const second = await saveNote(member, task.id, "# План\n- [x] позвонить", 1);
    expect(second).toMatchObject({ ok: true, version: 2 });
    expect(await getNote(task.id)).toMatchObject({
      text: "# План\n- [x] позвонить",
      version: 2,
    });

    // The owner still has version 1 open: their save doesn't wipe the member's.
    const stale = await saveNote(owner, task.id, "# План\n- [ ] позвонить\n- [ ] написать", 1);
    expect(stale).toEqual({
      ok: false,
      conflict: expect.objectContaining({ text: "# План\n- [x] позвонить", version: 2 }),
    });
    // Nothing changed: no new version.
    expect(await saveNote(member, task.id, "# План\n- [x] позвонить", 2)).toMatchObject({
      ok: true,
      version: 2,
    });

    await expect(saveNote(stranger, task.id, "чужое", 2)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(saveNote(owner, task.id, "x".repeat(20_001), 2)).rejects.toMatchObject({
      code: "noteTooLong",
    });

    // One line in the history per person per stretch of writing.
    await saveNote(member, task.id, "ещё правка", 2);
    expect(
      await db.activityLog.count({ where: { entityId: task.id, action: "task.note_saved" } }),
    ).toBe(2);

    // A closed task: read-only.
    await changeStatus(member, task.id, "IN_PROGRESS");
    await changeStatus(member, task.id, "IN_REVIEW");
    await changeStatus(owner, task.id, "DONE");
    await expect(saveNote(owner, task.id, "после", 3)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("notes changed by someone other than the author are movement; the bin keeps them", async () => {
    const manager = await createTestUser("MANAGER");
    const author = await createTestUser("MEMBER");
    const worker = await createTestUser("MEMBER");
    await db.user.updateMany({
      where: { id: { in: [author.id, worker.id] } },
      data: { managerId: manager.id },
    });
    const task = await createTask(
      author,
      taskInput({ title: "Тестовая задача", assigneeId: worker.id }),
      "create",
    );
    await saveNote(author, task.id, "мои заметки", 0);
    expect(await getDeleteMode(author, task.id)).toBe("direct");
    await saveNote(worker, task.id, "мои заметки\nи исполнителя", 1);
    expect(await getDeleteMode(author, task.id)).toBe("request");

    await deleteTask(manager, task.id, "Тест");
    expect(await db.taskNote.count()).toBe(0);
    const owner = await createTestUser("OWNER");
    await restoreTask(owner, task.id);
    expect(await getNote(task.id)).toMatchObject({
      text: "мои заметки\nи исполнителя",
      version: 2,
    });
  });
});
