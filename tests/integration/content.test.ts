import { access } from "node:fs/promises";

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { saveRoleConfig } from "@/modules/core/access/config";
import {
  approvePost,
  ContentError,
  deleteContentPost,
  contentAttention,
  getContentImage,
  getPost,
  listPostsBetween,
  markSent,
  returnWithFeedback,
  saveContent,
  savePlanItem,
  submitForReview,
} from "@/modules/content/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("content plan", () => {
  beforeEach(resetDb);

  async function setup() {
    const owner = await withAccess(await createTestUser("OWNER"));
    const author = await withAccess(await createTestUser("MEMBER"));
    const other = await withAccess(await createTestUser("MEMBER"));
    const post = await savePlanItem(owner, null, {
      title: "Тестовые новые цены",
      brief: "Тестовое задание",
      channels: ["PARTNER", "CONNECT"],
      publishDate: "2026-10-10",
      publishTime: "10:00",
      authorId: author.id,
    });
    return { owner, author, other, post };
  }

  it("goes plan → materials → review → feedback → approval → sent to each bot", async () => {
    const { owner, author, post } = await setup();
    expect(post.status).toBe("PLANNED");
    expect(await db.notification.findFirst({ where: { userId: author.id } })).toMatchObject({
      type: "content_assigned",
      link: `/content/${post.id}`,
    });

    await expect(submitForReview(author, post.id)).rejects.toBeInstanceOf(ContentError);
    await saveContent(
      author,
      post.id,
      { textRu: "Тестовый текст", textUz: "Test matn" },
      new File([PNG], "тест.png", { type: "image/png" }),
    );
    const draft = await db.contentPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(draft).toMatchObject({ status: "DRAFT", textUz: "Test matn", imageName: "тест.png" });
    expect((await getContentImage(author, post.id))?.absolutePath).toMatch(/content/);

    await submitForReview(author, post.id);
    expect(await db.notification.findFirst({ where: { userId: owner.id } })).toMatchObject({
      type: "content_review",
    });
    // The author can't approve or change it while it is reviewed.
    await expect(approvePost(author, post.id)).rejects.toBeInstanceOf(ContentError);
    await expect(saveContent(author, post.id, { textRu: "x" })).rejects.toBeInstanceOf(
      ContentError,
    );

    await returnWithFeedback(owner, post.id, "Тестовое замечание: поменять заголовок");
    expect((await db.contentPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe(
      "CHANGES",
    );
    expect(await db.contentComment.findFirst()).toMatchObject({ isFeedback: true });
    await saveContent(author, post.id, { textRu: "Тестовый текст 2", textUz: "Test matn 2" });
    await submitForReview(author, post.id);
    await approvePost(owner, post.id);
    expect(
      await db.notification.count({ where: { userId: author.id, type: "content_approved" } }),
    ).toBe(1);

    await expect(markSent(owner, post.id, "RESEARCH")).rejects.toBeInstanceOf(ContentError);
    await markSent(owner, post.id, "PARTNER");
    expect((await db.contentPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe(
      "APPROVED",
    );
    await markSent(owner, post.id, "CONNECT");
    expect(await db.contentPost.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({
      status: "SENT",
      sentChannels: ["PARTNER", "CONNECT"],
    });
  });

  it("only images are accepted as the visual", async () => {
    const { author, post } = await setup();
    await expect(
      saveContent(author, post.id, {}, new File(["<html>"], "x.png", { type: "image/png" })),
    ).rejects.toMatchObject({ code: "image" });
  });

  it("everyone with the section sees the whole plan; without it — only their own posts", async () => {
    const { owner, author, other, post } = await setup();
    expect(await getPost(author, post.id)).not.toBeNull();
    // Another employee sees the post but can't change it.
    const seen = await getPost(other, post.id);
    expect(seen?.rights).toMatchObject({
      view: true,
      editContent: false,
      editPlan: false,
      remove: false,
    });
    expect(await listPostsBetween(other, "2026-10-01", "2026-10-31")).toHaveLength(1);
    // With the section switched off for employees: nothing.
    await saveRoleConfig(owner, {
      MANAGER: { modules: ["content"], taskScope: "team" },
      MEMBER: { modules: [], taskScope: "own" },
    });
    expect(await getPost(await withAccess(other), post.id)).toBeNull();
    expect(await listPostsBetween(owner, "2026-10-01", "2026-10-31", "PARTNER")).toHaveLength(1);
    expect(await listPostsBetween(owner, "2026-10-01", "2026-10-31", "RESEARCH")).toHaveLength(0);
    await expect(
      savePlanItem(owner, null, { title: "x", channels: [], publishDate: "2026-10-11" }),
    ).rejects.toBeInstanceOf(ContentError);
    const attention = await contentAttention(author, "2026-10-12");
    expect(attention.prepare).toHaveLength(1);
    expect(attention.lateCount).toBe(1);
  });

  it("an employee adds a post for themselves; planners get it for review", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const member = await withAccess(await createTestUser("MEMBER"));
    const other = await withAccess(await createTestUser("MEMBER"));
    const post = await savePlanItem(member, null, {
      title: "Тестовая идея сотрудника",
      channels: ["CONNECT"],
      publishDate: "2026-10-12",
      authorId: other.id, // ignored: the employee is the author
    });
    expect(post).toMatchObject({ authorId: member.id, createdById: member.id });
    expect((await getPost(other, post.id))?.rights.editPlan).toBe(false);
    expect(await listPostsBetween(owner, "2026-10-01", "2026-10-31")).toHaveLength(1);

    // Until review the employee may change the plan of their post.
    await savePlanItem(member, post.id, {
      title: "Тестовая идея (исправлено)",
      channels: ["CONNECT", "PARTNER"],
      publishDate: "2026-10-13",
    });
    await saveContent(member, post.id, { textRu: "Тест", textUz: "Test" });
    await submitForReview(member, post.id);
    expect(
      await db.notification.findFirst({ where: { userId: owner.id, type: "content_review" } }),
    ).not.toBeNull();
    await expect(
      savePlanItem(member, post.id, {
        title: "x",
        channels: ["CONNECT"],
        publishDate: "2026-10-13",
      }),
    ).rejects.toBeInstanceOf(ContentError);
    await expect(approvePost(member, post.id)).rejects.toBeInstanceOf(ContentError);
    await approvePost(owner, post.id);
  });

  it("deletes: planners any post, an employee only their own until review", async () => {
    const { owner, author, other, post } = await setup();
    // The author was assigned the post by the owner: not theirs to delete.
    await expect(deleteContentPost(author, post.id)).rejects.toBeInstanceOf(ContentError);
    const own = await savePlanItem(other, null, {
      title: "Тестовый свой пост",
      channels: ["PARTNER"],
      publishDate: "2026-10-11",
    });
    await saveContent(other, own.id, { textRu: "Тест" }, new File([PNG], "v.png"));
    const image = await getContentImage(other, own.id);
    await deleteContentPost(other, own.id);
    expect(await db.contentPost.findUnique({ where: { id: own.id } })).toBeNull();
    await expect(access(image!.absolutePath)).rejects.toThrow();

    await deleteContentPost(owner, post.id);
    expect(await db.contentPost.count()).toBe(0);
  });
});
