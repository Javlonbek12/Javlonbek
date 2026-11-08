// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { ModelCall } from "@/modules/ai/run";
import { suggestLayout } from "@/modules/planograms/ai-layout";
import type { Layout } from "@/modules/planograms/layout";
import { seedPlanogramLibrary } from "@/modules/planograms/seed-library";
import { createPlanogram } from "@/modules/planograms/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const meta = {
  channel: "POSI",
  project: "Проект (тест)",
  validFrom: null,
  validTo: null,
  priceListId: null,
  notes: null,
};

async function setUp() {
  await resetDb();
  const owner = await createTestUser("OWNER");
  await seedPlanogramLibrary();
  const equipment = await db.equipment.findUniqueOrThrow({ where: { code: "DISPLAY_M" } });
  const pog = await createPlanogram(owner, {
    ...meta,
    title: "POG (тест)",
    equipmentId: equipment.id,
    fill: "empty",
  });
  return { owner, pog };
}

describe("«Предложить раскладку ИИ»", () => {
  beforeEach(resetDb);

  it("puts the model's SKUs into the free places of each shelf; POSM stays, the rest is reported", async () => {
    const { owner, pog } = await setUp();
    const sticker = await db.posm.findFirstOrThrow({ where: { name: "ENDI 1MG" } });
    const esse = await db.sku.findUniqueOrThrow({ where: { code: "SKU-TEST-001" } });
    // In the editor now: a sticker over places 1–2 of the top shelf, one pack with a hand-set mark.
    const current: Layout = {
      "0:0": { kind: "POSM", posmId: sticker.id, span: 2, rows: 1 },
      "1:0": { kind: "SKU", skuId: esse.id, badges: ["2mg"] },
    };
    let prompt = "";
    const call: ModelCall = async (request) => {
      prompt = request.prompt;
      return {
        output: {
          shelves: [
            {
              shelf: 1,
              items: [
                { code: "SKU-TEST-001", facings: 2 },
                { code: "NO-SUCH-CODE", facings: 1 },
                { code: "sku-test-002", facings: 1 },
              ],
            },
            // Shelf 2 has 6 places: the second item doesn't fit.
            {
              shelf: 2,
              items: [
                { code: "SKU-TEST-003", facings: 5 },
                { code: "SKU-TEST-001", facings: 3 },
              ],
            },
          ],
          note: "ESSE наверху.",
        },
        inputTokens: 900,
        outputTokens: 120,
      };
    };

    const result = await suggestLayout(
      owner,
      pog.id,
      current,
      "ESSE наверх, новинки рядом",
      "2026-11-08",
      call,
    );

    expect(prompt).toContain("Shelf 1: 4 free places (2 taken by POSM: ENDI 1MG)");
    expect(prompt).toContain("Shelf 2: SKU-TEST-001 ×1");
    expect(prompt).toContain("SKU-TEST-001 | ESSE | ESSE Special Gold (тест) | mandatory");
    expect(prompt).toContain("ESSE наверх, новинки рядом");

    const { layout } = result;
    expect(layout["0:0"]).toEqual(current["0:0"]);
    expect(layout["0:1"]).toBeUndefined(); // under the sticker
    // The pack keeps its hand-set mark; a new one gets YANGI and its own defaults.
    expect(layout["0:2"]).toEqual({ kind: "SKU", skuId: esse.id, badges: ["2mg"] });
    expect(layout["0:3"]).toMatchObject({ kind: "SKU", skuId: esse.id });
    expect(layout["0:4"]).toMatchObject({ kind: "SKU", badges: ["YANGI", "1mg"] });
    expect(Object.values(layout).filter((c) => c.kind === "SKU")).toHaveLength(3 + 6);
    // Places the answer leaves over stay undecided, so the rule check shows the gap.
    expect(layout["0:5"]).toBeUndefined();
    for (let p = 0; p < 6; p++) expect(layout[`3:${p}`]).toBeUndefined();
    expect(result.unknown).toEqual(["NO-SUCH-CODE"]);
    expect(result.overflow).toEqual(["ESSE Special Gold (тест)"]);
    expect(result.note).toBe("ESSE наверху.");
    expect(await db.aiUsage.findFirst()).toMatchObject({
      function: "suggestLayout",
      userId: owner.id,
      ok: true,
    });
  });

  it("«only the free places» keeps what is placed and fills the rest", async () => {
    const { owner, pog } = await setUp();
    const esse = await db.sku.findUniqueOrThrow({ where: { code: "SKU-TEST-001" } });
    const current: Layout = {
      "0:0": { kind: "SKU", skuId: esse.id, badges: ["2mg"] },
      "0:1": { kind: "EMPTY" },
    };
    let prompt = "";
    const call: ModelCall = async (request) => {
      prompt = request.prompt;
      return {
        output: {
          shelves: [{ shelf: 1, items: [{ code: "SKU-TEST-002", facings: 2 }] }],
          note: "Готово.",
        },
        inputTokens: 1,
        outputTokens: 1,
      };
    };
    const { layout } = await suggestLayout(
      owner,
      pog.id,
      current,
      "заполни пустое",
      "2026-11-08",
      call,
      "free",
    );
    expect(prompt).toContain("Mode: fill only the free places");
    expect(prompt).toContain("Shelf 1: 4 free places");
    // The pack and the «пусто» mark stay; the answer goes into the next free places.
    expect(layout["0:0"]).toEqual(current["0:0"]);
    expect(layout["0:1"]).toEqual({ kind: "EMPTY" });
    expect(layout["0:2"]).toMatchObject({ kind: "SKU" });
    expect(layout["0:3"]).toMatchObject({ kind: "SKU" });
    expect(layout["0:4"]).toBeUndefined();
  });

  it("works on a draft and needs a request", async () => {
    const { owner, pog } = await setUp();
    const call: ModelCall = async () => ({
      output: { shelves: [], note: "" },
      inputTokens: 1,
      outputTokens: 1,
    });
    await expect(suggestLayout(owner, pog.id, {}, "   ", "2026-11-08", call)).rejects.toMatchObject(
      { code: "invalid" },
    );
    await db.planogram.update({ where: { id: pog.id }, data: { status: "APPROVED" } });
    await expect(
      suggestLayout(owner, pog.id, {}, "любой текст", "2026-11-08", call),
    ).rejects.toMatchObject({ code: "notDraft" });
    expect(await db.aiUsage.count()).toBe(0);
  });
});
