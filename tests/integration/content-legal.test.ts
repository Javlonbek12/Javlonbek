import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { saveRoleConfig } from "@/modules/core/access/config";
import { addPostFile, removePostFile } from "@/modules/content/files";
import {
  approvePost,
  cancelPost,
  ContentError,
  getPost,
  legalApprove,
  movePost,
  restorePost,
  returnWithFeedback,
  saveContent,
  savePlanItem,
  submitForReview,
  withdrawPost,
} from "@/modules/content/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const status = async (id: string) =>
  (await db.contentPost.findUniqueOrThrow({ where: { id } })).status;

describe("content: lawyer, withdrawing, moving", () => {
  beforeEach(resetDb);

  async function setup() {
    const owner = await withAccess(await createTestUser("OWNER"));
    const author = await withAccess(await createTestUser("MEMBER"));
    const lawyer = await withAccess(await createTestUser("LAWYER"));
    const post = await savePlanItem(owner, null, {
      title: "Тестовый пост",
      channels: ["PARTNER"],
      publishDate: "2026-10-10",
      authorId: author.id,
    });
    await saveContent(author, post.id, { textRu: "Тестовый текст" });
    return { owner, author, lawyer, post };
  }

  it("after the planner the lawyer checks: returns, then approves", async () => {
    const { owner, author, lawyer, post } = await setup();
    await submitForReview(author, post.id);
    // The lawyer can't approve before the planner.
    await expect(legalApprove(lawyer, post.id)).rejects.toBeInstanceOf(ContentError);
    await approvePost(owner, post.id);
    expect(await status(post.id)).toBe("LEGAL_REVIEW");
    expect(
      await db.notification.count({ where: { userId: lawyer.id, type: "content_legal" } }),
    ).toBe(1);
    // The planner can't skip the lawyer.
    await expect(approvePost(owner, post.id)).rejects.toBeInstanceOf(ContentError);

    await returnWithFeedback(lawyer, post.id, "Тестовое замечание юриста");
    expect(await status(post.id)).toBe("CHANGES");
    await submitForReview(author, post.id);
    await approvePost(owner, post.id);
    await legalApprove(lawyer, post.id);
    expect(await status(post.id)).toBe("APPROVED");
    // The owner learns it can be sent; the author that it is approved.
    expect(
      await db.notification.count({ where: { userId: owner.id, type: "content_approved" } }),
    ).toBe(1);
    expect(
      await db.notification.count({ where: { userId: author.id, type: "content_approved" } }),
    ).toBe(1);
  });

  it("without a lawyer the planner's approval is final", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const post = await savePlanItem(owner, null, {
      title: "Тестовый пост",
      channels: ["PARTNER"],
      publishDate: "2026-10-10",
    });
    await saveContent(owner, post.id, { textRu: "Тест" });
    await approvePost(owner, post.id);
    expect(await status(post.id)).toBe("APPROVED");
  });

  it("the lawyer always has the content plan, with every right in it", async () => {
    const { owner, lawyer, post } = await setup();
    await saveRoleConfig(owner, {
      MANAGER: { modules: ["content"], taskScope: "team" },
      MEMBER: { modules: [], taskScope: "own" },
      LAWYER: { modules: [], taskScope: "all" },
    });
    const fresh = await withAccess(await db.user.findUniqueOrThrow({ where: { id: lawyer.id } }));
    expect(fresh.access.modules).toContain("content");
    expect(fresh.access.taskScope).toBe("own");
    expect((await getPost(fresh, post.id))?.rights).toMatchObject({
      view: true,
      planner: true,
      editPlan: true,
    });
  });

  it("the author takes the post back from review and from the lawyer", async () => {
    const { owner, author, lawyer, post } = await setup();
    await submitForReview(author, post.id);
    await withdrawPost(author, post.id);
    expect(await status(post.id)).toBe("DRAFT");
    await saveContent(author, post.id, { textRu: "Исправленный тестовый текст" });
    await submitForReview(author, post.id);
    await approvePost(owner, post.id);
    // Somebody else can't take it back.
    await expect(withdrawPost(lawyer, post.id)).rejects.toBeInstanceOf(ContentError);
    await withdrawPost(author, post.id);
    expect(await status(post.id)).toBe("DRAFT");
    await expect(withdrawPost(author, post.id)).rejects.toBeInstanceOf(ContentError);
    expect(
      await db.notification.count({ where: { userId: author.id, title: "Пост снят с проверки" } }),
    ).toBe(0);

    // Whoever added the post takes it back: the author hears it.
    await submitForReview(author, post.id);
    await withdrawPost(owner, post.id);
    expect(await status(post.id)).toBe("DRAFT");
    expect(
      await db.notification.count({ where: { userId: author.id, title: "Пост снят с проверки" } }),
    ).toBe(1);
  });

  it("a change of text or files of an approved post (or one with the lawyer) sends it back to review", async () => {
    const { owner, author, lawyer, post } = await setup();
    await submitForReview(author, post.id);
    await approvePost(owner, post.id);
    expect(await status(post.id)).toBe("LEGAL_REVIEW");

    // Saving the same text changes nothing.
    await saveContent(owner, post.id, { textRu: "Тестовый текст" });
    expect(await status(post.id)).toBe("LEGAL_REVIEW");

    // With the lawyer: a new text goes back to the planner's review; the planner who added the
    // post hears it unless they changed it themselves.
    await saveContent(lawyer, post.id, { textRu: "Новый текст" });
    expect(await status(post.id)).toBe("REVIEW");
    const changed = { title: "Утверждённый пост изменили — снова на проверку" };
    expect(await db.notification.count({ where: { userId: owner.id, ...changed } })).toBe(1);

    await approvePost(owner, post.id);
    await legalApprove(lawyer, post.id);
    expect(await status(post.id)).toBe("APPROVED");

    // Approved: a new file sends it back too, and the approval is gone.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const file = await addPostFile(owner, post.id, "RU", new File([png], "visual.png"));
    const after = await db.contentPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe("REVIEW");
    expect(after.approvedAt).toBeNull();
    expect(await db.notification.count({ where: { userId: lawyer.id, ...changed } })).toBe(0);

    // Removing a file of a post under review leaves it there.
    await removePostFile(owner, file.id);
    expect(await status(post.id)).toBe("REVIEW");
  });

  it("a cancelled post can be put back into the plan", async () => {
    const { owner, post } = await setup();
    await cancelPost(owner, post.id);
    expect(await status(post.id)).toBe("CANCELLED");
    await restorePost(owner, post.id);
    // It already had a text: back as a draft.
    expect(await status(post.id)).toBe("DRAFT");
    await expect(restorePost(owner, post.id)).rejects.toBeInstanceOf(ContentError);
  });

  it("moves a post to another day: everyone with the section", async () => {
    const { owner, author, post } = await setup();
    // Assigned by the owner: the author moves it all the same.
    await movePost(author, post.id, "2026-10-11");
    await movePost(owner, post.id, "2026-10-12");
    const moved = await db.contentPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(moved.publishDate.toISOString().slice(0, 10)).toBe("2026-10-12");
    await expect(movePost(owner, post.id, "12.10.2026")).rejects.toMatchObject({
      code: "invalid",
    });
  });
});
