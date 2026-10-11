import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import {
  getContentTargets,
  saveContentTargets,
  DEFAULT_TARGETS,
} from "@/modules/content/analytics";
import {
  deleteSection,
  listSections,
  retagContent,
  saveSection,
  setSectionArchived,
} from "@/modules/content/sections";
import { ContentError, saveContent, savePlanItem, setContentTags } from "@/modules/content/service";
import { tagPendingContent } from "@/modules/content/tagging";
import { createTestUser, resetDb } from "@/tests/helpers/db";

describe("content tagging", () => {
  beforeEach(resetDb);

  it("tags new and changed posts by AI, keeps a hand-set tag, falls back to keywords", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const a = await savePlanItem(owner, null, {
      title: "Тестовое обучение по Simple",
      channels: ["CONNECT"],
      publishDate: "2026-10-10",
    });
    const b = await savePlanItem(owner, null, {
      title: "Тестовые цены ESSE",
      channels: ["PARTNER"],
      publishDate: "2026-10-11",
    });
    // AI answers TRAINING / SIMPLE for every post.
    const call = async () => ({
      output: { topic: "TRAINING", brand: "SIMPLE" },
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(await tagPendingContent(10, call)).toBe(2);
    expect(await db.contentPost.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      topic: "TRAINING",
      brand: "SIMPLE",
      tagSource: "ai",
      tagPending: false,
    });
    expect(await tagPendingContent(10, call)).toBe(0);

    // Set by hand: kept even after the text changes.
    await setContentTags(owner, b.id, { topic: "PRICES", brand: "ESSE" });
    await saveContent(owner, b.id, { textRu: "Тестовый текст" });
    await tagPendingContent(10, call);
    expect(await db.contentPost.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({
      topic: "PRICES",
      brand: "ESSE",
      tagSource: "manual",
    });

    // Without AI: keywords.
    await saveContent(owner, a.id, { textRu: "Тестовый текст" });
    await tagPendingContent(10);
    expect(await db.contentPost.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      topic: "TRAINING",
      brand: "SIMPLE",
      tagSource: "keywords",
    });
  });

  it("only planners set the wanted mix, which must add up to 100%", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const member = await withAccess(await createTestUser("MEMBER"));
    const ids = Object.keys(DEFAULT_TARGETS);
    expect(await getContentTargets(ids)).toEqual(DEFAULT_TARGETS);
    const mix = { ...DEFAULT_TARGETS, PRICES: 25, TRAINING: 10 };
    await saveContentTargets(owner, mix, ids);
    expect(await getContentTargets(ids)).toEqual(mix);
    // A new section starts at 0.
    expect(await getContentTargets([...ids, "own"])).toEqual({ ...mix, own: 0 });
    await expect(saveContentTargets(owner, { ...mix, PRICES: 50 }, ids)).rejects.toBeInstanceOf(
      ContentError,
    );
    await expect(saveContentTargets(member, mix, ids)).rejects.toBeInstanceOf(ContentError);
  });

  it("planners add their own sections; AI gets them; archived ones are not offered", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const member = await withAccess(await createTestUser("MEMBER"));
    await expect(
      saveSection(member, null, { name: "Тестовый раздел", description: "", sortOrder: 8 }),
    ).rejects.toBeInstanceOf(ContentError);
    const id = await saveSection(owner, null, {
      name: "Тестовый раздел",
      description: "О тестовом",
      sortOrder: 8,
    });
    // The same name twice is refused (any case).
    await expect(
      saveSection(owner, null, { name: "тестовый РАЗДЕЛ", description: "", sortOrder: 9 }),
    ).rejects.toBeInstanceOf(ContentError);

    const post = await savePlanItem(owner, null, {
      title: "Тестовый пост",
      channels: ["PARTNER"],
      publishDate: "2026-10-10",
    });
    let prompt = "";
    const call = async (request: { system: string }) => {
      prompt = request.system;
      return { output: { topic: id, brand: "GENERAL" }, inputTokens: 1, outputTokens: 1 };
    };
    expect(await tagPendingContent(10, call as never)).toBe(1);
    expect(prompt).toContain(`${id}: Тестовый раздел — О тестовом`);
    expect(await db.contentPost.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({
      topic: id,
    });

    // A section with posts can't be deleted, only archived; an archived one can't be set by hand.
    await expect(deleteSection(owner, id)).rejects.toBeInstanceOf(ContentError);
    await setSectionArchived(owner, id, true);
    await expect(
      setContentTags(owner, post.id, { topic: id, brand: "GENERAL" }),
    ).rejects.toBeInstanceOf(ContentError);
    await tagPendingContent(10, call as never);
    expect((await listSections()).find((s) => s.id === id)).toMatchObject({
      archived: true,
      posts: 1,
    });

    // Re-tagging sends posts back to AI, but not the hand-set ones.
    await setContentTags(owner, post.id, { topic: "PRICES", brand: "ESSE" });
    const other = await savePlanItem(owner, null, {
      title: "Тестовый пост 2",
      channels: ["PARTNER"],
      publishDate: "2026-10-12",
    });
    await tagPendingContent(10, call as never).catch(() => 0);
    expect(await retagContent(owner, "2026-10-01", "2026-10-31")).toBe(1);
    expect(await db.contentPost.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({
      tagPending: true,
    });

    const empty = await saveSection(owner, null, {
      name: "Пустой тестовый",
      description: "",
      sortOrder: 9,
    });
    await deleteSection(owner, empty);
    expect((await listSections()).some((s) => s.id === empty)).toBe(false);
  });
});
