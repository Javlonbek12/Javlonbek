import { access } from "node:fs/promises";

import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { saveRoleConfig } from "@/modules/core/access/config";
import {
  approvePost,
  ContentError,
  deleteContentPost,
  contentAttention,
  getPost,
  isLatePost,
  listPostsBetween,
  markSent,
  postsAwaitingDecision,
  returnWithFeedback,
  saveContent,
  savePlanItem,
  submitForReview,
} from "@/modules/content/service";
import { addPostFile, getPostFile } from "@/modules/content/files";
import { createSessionToken, SESSION_COOKIE } from "@/modules/core/auth/session";
import { GET as getContentFile } from "@/app/api/content/files/[id]/route";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const SECRET = "test-session-secret-test-session-secret";
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
    await saveContent(author, post.id, { textRu: "Тестовый текст", textUz: "Test matn" });
    const file = await addPostFile(author, post.id, "RU", new File([PNG], "тест.png"));
    const draft = await db.contentPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(draft).toMatchObject({ status: "DRAFT", textUz: "Test matn" });
    expect(file).toMatchObject({ kind: "PHOTO", name: "тест.png", lang: "RU" });
    expect((await getPostFile(author, file.id))?.absolutePath).toMatch(/content/);

    await submitForReview(author, post.id);
    expect(await db.notification.findFirst({ where: { userId: owner.id } })).toMatchObject({
      type: "content_review",
    });

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

  it("files: the kind comes from the bytes, up to 10 per language", async () => {
    const { author, post } = await setup();
    // Named .png but not a picture: stored as a plain file (downloaded, never shown inline).
    expect(
      await addPostFile(
        author,
        post.id,
        "UZ",
        new File(["<html>"], "x.png", { type: "image/png" }),
      ),
    ).toMatchObject({ kind: "FILE", mime: "application/octet-stream" });
    const mp4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    expect(await addPostFile(author, post.id, "UZ", new File([mp4], "v.mp4"))).toMatchObject({
      kind: "VIDEO",
      mime: "video/mp4",
    });
    for (let i = 0; i < 8; i++)
      await addPostFile(author, post.id, "UZ", new File([PNG], `p${i}.png`));
    await expect(
      addPostFile(author, post.id, "UZ", new File([PNG], "11.png")),
    ).rejects.toMatchObject({ code: "tooMany" });
    // Russian has its own ten.
    await addPostFile(author, post.id, "RU", new File([PNG], "ru.png"));
  });

  it("everyone with the section sees the whole plan; without it — only their own posts", async () => {
    const { owner, author, other, post } = await setup();
    expect(await getPost(author, post.id)).not.toBeNull();
    // Every right in the plan is open to everyone with the section.
    const seen = await getPost(other, post.id);
    expect(seen?.rights).toMatchObject({
      view: true,
      planner: true,
      editContent: true,
      editPlan: true,
      remove: true,
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

  it("an employee adds a post and picks its author; the owner and managers get it for review", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const member = await withAccess(await createTestUser("MEMBER"));
    const other = await withAccess(await createTestUser("MEMBER"));
    const post = await savePlanItem(member, null, {
      title: "Тестовая идея сотрудника",
      channels: ["CONNECT"],
      publishDate: "2026-10-12",
      authorId: member.id,
    });
    expect(post).toMatchObject({ authorId: member.id, createdById: member.id });
    expect((await getPost(other, post.id))?.rights.editPlan).toBe(true);
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
    // The author never approves their own post (owner's decision); anybody else with the section does.
    await expect(approvePost(member, post.id)).rejects.toMatchObject({ code: "ownPost" });
    await approvePost(other, post.id);
    expect((await db.contentPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe(
      "APPROVED",
    );
  });

  it("nobody approves or returns their own post, the owner included", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const manager = await withAccess(await createTestUser("MANAGER"));
    // The owner's own post, without an author set.
    const post = await savePlanItem(owner, null, {
      title: "Тестовый пост владельца",
      channels: ["PARTNER"],
      publishDate: "2026-10-10",
    });
    await saveContent(owner, post.id, { textRu: "Тест" });
    // A draft is not approved at all: it goes for review first.
    await expect(approvePost(manager, post.id)).rejects.toMatchObject({ code: "state" });
    await submitForReview(owner, post.id);
    // Sending it made the owner its author; the manager is asked to check it.
    expect(await db.contentPost.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({
      status: "REVIEW",
      authorId: owner.id,
    });
    expect(
      await db.notification.count({ where: { userId: manager.id, type: "content_review" } }),
    ).toBe(1);
    expect((await getPost(owner, post.id))?.rights).toMatchObject({
      review: false,
      waitsForOthers: true,
    });
    await expect(approvePost(owner, post.id)).rejects.toMatchObject({ code: "ownPost" });
    await expect(returnWithFeedback(owner, post.id, "Тест")).rejects.toMatchObject({
      code: "ownPost",
    });
    expect((await getPost(manager, post.id))?.rights.review).toBe(true);
    await approvePost(manager, post.id);
    expect((await db.contentPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe(
      "APPROVED",
    );
  });

  it("sending for review saves the texts typed in the form first", async () => {
    const { owner, author, post } = await setup();
    // Nothing saved yet: the post is only planned. The text typed before pressing «send» goes along.
    await submitForReview(author, post.id, { textRu: "Тестовый текст из формы", textUz: "" });
    expect(await db.contentPost.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({
      status: "REVIEW",
      textRu: "Тестовый текст из формы",
      textUz: null,
    });
    await returnWithFeedback(owner, post.id, "Тестовое замечание");
    await submitForReview(author, post.id, { textRu: "Исправлено", textUz: "Tuzatildi" });
    expect(await db.contentPost.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({
      status: "REVIEW",
      textRu: "Исправлено",
      textUz: "Tuzatildi",
    });
    // Empty form, nothing uploaded: refused, the post stays as it was.
    const empty = await savePlanItem(owner, null, {
      title: "Тестовый пустой пост",
      channels: ["PARTNER"],
      publishDate: "2026-10-11",
      authorId: author.id,
    });
    await expect(
      submitForReview(author, empty.id, { textRu: " ", textUz: "" }),
    ).rejects.toMatchObject({ code: "empty" });
  });

  it("lists posts awaiting a decision: not the person's own, `asked` for their reviewers", async () => {
    const { owner, author, other, post } = await setup();
    await saveContent(author, post.id, { textRu: "Тест" });
    await submitForReview(author, post.id);
    expect(await postsAwaitingDecision(author)).toHaveLength(0);
    // The owner put it in the plan: they are asked; the colleague may decide too, unasked.
    expect(await postsAwaitingDecision(owner)).toMatchObject([{ id: post.id, asked: true }]);
    expect(await postsAwaitingDecision(other)).toMatchObject([{ id: post.id, asked: false }]);
    const attention = await contentAttention(other, "2026-10-01");
    expect(attention.review.map((p) => p.id)).toEqual([post.id]);
    expect(attention.mine.size).toBe(0);
    expect((await contentAttention(owner, "2026-10-01")).mine.has(post.id)).toBe(true);
  });

  it("shows late posts, and to the owner the posts returned to their authors", async () => {
    const { owner, author, post } = await setup();
    await saveContent(author, post.id, { textRu: "Тест" });
    await submitForReview(author, post.id);
    await returnWithFeedback(owner, post.id, "Тестовое замечание");
    const before = await contentAttention(owner, "2026-10-09");
    expect(before.late).toHaveLength(0);
    expect(before.changes.map((p) => p.id)).toEqual([post.id]);
    // The day has passed and the post wasn't sent.
    const after = await contentAttention(owner, "2026-10-11");
    expect(after.late.map((p) => p.id)).toEqual([post.id]);
    expect(isLatePost(after.late[0]!, "2026-10-11")).toBe(true);
    expect(isLatePost({ status: "SENT", publishDate: post.publishDate }, "2026-10-11")).toBe(false);
  });

  it("deletes: everyone with the section, any post", async () => {
    const { owner, other, post } = await setup();
    const own = await savePlanItem(other, null, {
      title: "Тестовый свой пост",
      channels: ["PARTNER"],
      publishDate: "2026-10-11",
    });
    await saveContent(other, own.id, { textRu: "Тест" });
    const file = await addPostFile(other, own.id, "RU", new File([PNG], "v.png"));
    const image = await getPostFile(other, file.id);
    await deleteContentPost(other, own.id);
    expect(await db.contentPost.findUnique({ where: { id: own.id } })).toBeNull();
    await expect(access(image!.absolutePath)).rejects.toThrow();

    await deleteContentPost(owner, post.id);
    expect(await db.contentPost.count()).toBe(0);
  });

  it("serves a photo as a small WebP copy with ?w=, and the original without it", async () => {
    const { author, post } = await setup();
    const png = await sharp({
      create: { width: 1600, height: 800, channels: 3, background: "#cc3366" },
    })
      .png()
      .toBuffer();
    const file = await addPostFile(author, post.id, "RU", new File([png], "фото.png"));
    const ask = (query: string) =>
      getContentFile(
        new Request(`http://localhost:3000/api/content/files/${file.id}${query}`, {
          headers: { cookie: `${SESSION_COOKIE}=${createSessionToken(author.id, SECRET)}` },
        }),
        { params: Promise.resolve({ id: file.id }) },
      );

    const small = await ask("?w=160");
    expect(small.headers.get("content-type")).toBe("image/webp");
    expect(small.headers.get("cache-control")).toContain("immutable");
    const meta = await sharp(Buffer.from(await small.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([160, 80]);

    const original = await ask("");
    expect(original.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await original.arrayBuffer()).equals(png)).toBe(true);
    // A download is always the original.
    expect((await ask("?w=160&download=1")).headers.get("content-type")).toBe("image/png");
  });
});
