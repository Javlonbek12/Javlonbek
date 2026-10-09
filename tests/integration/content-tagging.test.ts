import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import {
  getContentTargets,
  saveContentTargets,
  DEFAULT_TARGETS,
} from "@/modules/content/analytics";
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
    expect(await getContentTargets()).toEqual(DEFAULT_TARGETS);
    const mix = { ...DEFAULT_TARGETS, PRICES: 25, TRAINING: 10 };
    await saveContentTargets(owner, mix);
    expect(await getContentTargets()).toEqual(mix);
    await expect(saveContentTargets(owner, { ...mix, PRICES: 50 })).rejects.toBeInstanceOf(
      ContentError,
    );
    await expect(saveContentTargets(member, mix)).rejects.toBeInstanceOf(ContentError);
  });
});
