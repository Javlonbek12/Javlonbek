// @vitest-environment node
import { rm } from "node:fs/promises";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET as download } from "@/app/api/attachments/[id]/route";
import { POST as upload } from "@/app/api/tasks/[id]/attachments/route";
import { db } from "@/lib/db";
import { createSessionToken, SESSION_COOKIE } from "@/modules/core/auth/session";
import { addLinkAttachment, removeAttachment } from "@/modules/tasks/attachment-service";
import { createTask } from "@/modules/tasks/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";

const SECRET = "test-session-secret-test-session-secret";

function authed(url: string, userId: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: { cookie: `${SESSION_COOKIE}=${createSessionToken(userId, SECRET)}` },
  });
}

describe("attachments API", () => {
  beforeEach(resetDb);
  afterAll(() => rm(".test-uploads", { recursive: true, force: true }));

  it("uploads a file and lets only people who see the task download it", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const outsider = await createTestUser("MEMBER");
    const task = await createTask(owner, taskInput({ assigneeId: member.id }), "approve");

    const form = new FormData();
    form.set("file", new File(["план продаж"], "Отчёт Q4.txt", { type: "text/plain" }));
    const response = await upload(
      authed(`http://localhost:3000/api/tasks/${task.id}/attachments`, owner.id, {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ id: task.id }) },
    );
    expect(response.status).toBe(303);
    const attachment = await db.taskAttachment.findFirstOrThrow({ where: { taskId: task.id } });
    expect(attachment).toMatchObject({ kind: "FILE", title: "Отчёт_Q4.txt", sizeBytes: 21 });

    const ctx = { params: Promise.resolve({ id: attachment.id }) };
    const ok = await download(
      authed(`http://localhost:3000/api/attachments/${attachment.id}`, member.id),
      ctx,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(await ok.text()).toBe("план продаж");

    const denied = await download(
      authed(`http://localhost:3000/api/attachments/${attachment.id}`, outsider.id),
      {
        params: Promise.resolve({ id: attachment.id }),
      },
    );
    expect(denied.status).toBe(404);

    const anonymous = await download(
      new Request(`http://localhost:3000/api/attachments/${attachment.id}`),
      {
        params: Promise.resolve({ id: attachment.id }),
      },
    );
    expect(anonymous.status).toBe(401);

    await removeAttachment(owner, attachment.id);
    expect(await db.taskAttachment.count()).toBe(0);
  });

  it("an outsider cannot upload to someone else's task", async () => {
    const owner = await createTestUser("OWNER");
    const outsider = await createTestUser("MEMBER");
    const task = await createTask(owner, taskInput({ assigneeId: owner.id }));
    const form = new FormData();
    form.set("file", new File(["x"], "x.txt"));
    const response = await upload(
      authed(`http://localhost:3000/api/tasks/${task.id}/attachments`, outsider.id, {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ id: task.id }) },
    );
    expect(response.status).toBe(403);
  });

  it("accepts only http(s) links", async () => {
    const owner = await createTestUser("OWNER");
    const task = await createTask(owner, taskInput({ assigneeId: owner.id }));
    await expect(
      addLinkAttachment(owner, task.id, "", "javascript:alert(1)"),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      addLinkAttachment(owner, task.id, "Диск", "https://example.com/file"),
    ).resolves.toMatchObject({
      kind: "LINK",
    });
  });
});
