// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { slotKey } from "@/modules/planograms/geometry";
import { insertSkuEverywhere, replaceSkuEverywhere } from "@/modules/planograms/mass";
import { applyPriceList, createPriceList, draftsOnOlderLists } from "@/modules/planograms/pricing";
import { loadPlanogram } from "@/modules/planograms/repository";
import { seedPlanogramLibrary } from "@/modules/planograms/seed-library";
import {
  approvePlanogram,
  copyPlanogram,
  createPlanogram,
  saveLayout,
  staleBase,
  submitForApproval,
} from "@/modules/planograms/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";

// Versions made in parallel: approving one that was not made from the version in force needs a
// confirmation, and applying a price list moves drafts to the new prices.

const meta = {
  channel: "POSI",
  project: "Тестовый проект",
  validFrom: null,
  validTo: null,
  priceListId: null,
  notes: null,
};
const equipment = (code: string) => db.equipment.findUniqueOrThrow({ where: { code } });
const skuByCode = (code: string) => db.sku.findUniqueOrThrow({ where: { code } });
const statusOf = async (id: string) =>
  (await db.planogram.findUniqueOrThrow({ where: { id } })).status;

async function approvedPlanogram(title = "POG") {
  await seedPlanogramLibrary();
  const owner = await createTestUser("OWNER");
  const member = await createTestUser("MEMBER");
  const pog = await createPlanogram(owner, {
    ...meta,
    title,
    equipmentId: (await equipment("POG_MINI")).id,
    fill: "auto",
  });
  await approvePlanogram(owner, pog.id);
  return { owner, member, pog };
}

describe("versions made from an older one", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a draft from v1 after a mass replacement was approved: warns, approves only with force", async () => {
    const { owner, member, pog } = await approvedPlanogram();
    // A member starts v2 from v1, then a mass replacement makes v3 from v1 and it is approved.
    const draft = await copyPlanogram(member, pog.id);
    const [from, to] = [await skuByCode("SKU-TEST-003"), await skuByCode("SKU-TEST-005")];
    const [replaced] = await replaceSkuEverywhere(owner, from.id, to.id);
    expect(await staleBase((await loadPlanogram(replaced))!)).toBeNull();
    await approvePlanogram(owner, replaced);

    const stale = await staleBase((await loadPlanogram(draft.id))!);
    expect(stale).toMatchObject({
      current: { id: replaced, version: 3 },
      base: { id: pog.id, version: 1 },
      header: false,
      shelftalkers: false,
      priceList: null,
    });
    expect(stale!.changes.map((c) => c.id)).toEqual(expect.arrayContaining([from.id, to.id]));

    await submitForApproval(member, draft.id);
    await expect(approvePlanogram(owner, draft.id)).rejects.toMatchObject({ code: "stale" });
    expect(await statusOf(draft.id)).toBe("PENDING_APPROVAL");
    await approvePlanogram(owner, draft.id, { force: true });
    expect(await statusOf(draft.id)).toBe("APPROVED");
    expect(await statusOf(replaced)).toBe("ARCHIVED");
  }, 60_000);

  it("two mass operations from the same version: the second one is not approved without force", async () => {
    const { owner, pog } = await approvedPlanogram();
    const [from, to] = [await skuByCode("SKU-TEST-003"), await skuByCode("SKU-TEST-005")];
    const [replaced] = await replaceSkuEverywhere(owner, from.id, to.id);
    const { created } = await insertSkuEverywhere(
      owner,
      (await equipment("POG_MINI")).id,
      (await skuByCode("SKU-TEST-001")).id,
      0,
      0,
    );
    expect(created).toHaveLength(1);
    // Both are copies of v1; once one is approved, the other would drop its change.
    await approvePlanogram(owner, replaced);
    await expect(approvePlanogram(owner, created[0])).rejects.toMatchObject({ code: "stale" });
    expect(await statusOf(replaced)).toBe("APPROVED");
    expect(await statusOf(pog.id)).toBe("ARCHIVED");
  }, 60_000);

  it("nothing is lost: a version from the one in force, or one that only lacks nothing", async () => {
    const { owner, pog } = await approvedPlanogram();
    const v2 = await copyPlanogram(owner, pog.id);
    expect(await staleBase((await loadPlanogram(v2.id))!)).toBeNull();
    // v3 from v1 approved with the same layout: v2 is not from it, but nothing would be lost.
    const v3 = await copyPlanogram(owner, pog.id);
    await approvePlanogram(owner, v3.id);
    expect(await staleBase((await loadPlanogram(v2.id))!)).toBeNull();
    await approvePlanogram(owner, v2.id);
    expect(await statusOf(v2.id)).toBe("APPROVED");
  }, 60_000);

  it("a changed layout in the version in force is listed", async () => {
    const { owner, pog } = await approvedPlanogram();
    const v2 = await copyPlanogram(owner, pog.id);
    const v3 = await copyPlanogram(owner, pog.id);
    const loaded = (await loadPlanogram(v3.id))!;
    // Swap the first two different SKUs on the top shelf: they move, nothing goes missing.
    const skuAt = (p: number) => {
      const c = loaded.layout[slotKey(0, p)];
      return c?.kind === "SKU" ? c.skuId : null;
    };
    const second = [1, 2, 3, 4, 5, 6].find((p) => skuAt(p) && skuAt(p) !== skuAt(0))!;
    expect(second).toBeDefined();
    await saveLayout(
      owner,
      v3.id,
      {
        ...loaded.layout,
        [slotKey(0, 0)]: loaded.layout[slotKey(0, second)],
        [slotKey(0, second)]: loaded.layout[slotKey(0, 0)],
      },
      loaded.record.headerPosmId,
    );
    await approvePlanogram(owner, v3.id);
    const stale = await staleBase((await loadPlanogram(v2.id))!);
    expect(stale?.current.version).toBe(3);
    expect(stale?.changes.length).toBeGreaterThan(0);
  }, 60_000);
});

describe("applying a price list", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("moves drafts and versions waiting for approval on older lists; templates and approved stay", async () => {
    const { owner, member, pog } = await approvedPlanogram("A");
    const oldList = (await db.planogram.findUniqueOrThrow({ where: { id: pog.id } })).priceListId;
    expect(oldList).not.toBeNull();
    const draft = await copyPlanogram(member, pog.id);
    const waiting = await createPlanogram(member, {
      ...meta,
      title: "B",
      equipmentId: (await equipment("DISPLAY_L")).id,
      fill: "auto",
    });
    await submitForApproval(member, waiting.id);
    const template = await copyPlanogram(owner, pog.id, {
      asNew: true,
      isTemplate: true,
      title: "A (шаблон)",
    });

    const { list } = await createPriceList(
      owner,
      { name: "Повышение (тест)", effectiveFrom: "2099-01-01" },
      [{ code: "SKU-TEST-001", price: 33000 }],
    );
    expect((await draftsOnOlderLists(list.id)).map((p) => p.id).sort()).toEqual(
      [draft.id, waiting.id].sort(),
    );

    const { created, moved } = await applyPriceList(owner, list.id);
    expect(created).toHaveLength(1);
    expect(moved.sort()).toEqual([draft.id, waiting.id].sort());
    const priceListOf = async (id: string) =>
      (await db.planogram.findUniqueOrThrow({ where: { id } })).priceListId;
    expect(await priceListOf(draft.id)).toBe(list.id);
    expect(await priceListOf(waiting.id)).toBe(list.id);
    expect(await statusOf(waiting.id)).toBe("PENDING_APPROVAL");
    expect(await priceListOf(template.id)).toBe(oldList);
    expect(await priceListOf(pog.id)).toBe(oldList);
    // The draft now has the new prices, so approving it later brings no old prices back.
    const sku1 = await skuByCode("SKU-TEST-001");
    expect((await loadPlanogram(draft.id))!.prices.get(sku1.id)).toBe(33000);
    expect(await staleBase((await loadPlanogram(draft.id))!)).toBeNull();
    expect(await draftsOnOlderLists(list.id)).toEqual([]);
  }, 60_000);

  it("a draft left on old prices shows the newer list as lost", async () => {
    const { owner, member, pog } = await approvedPlanogram("A");
    const draft = await copyPlanogram(member, pog.id);
    const { list } = await createPriceList(
      owner,
      { name: "Повышение (тест)", effectiveFrom: "2099-01-01" },
      [{ code: "SKU-TEST-001", price: 33000 }],
    );
    await applyPriceList(owner, list.id);
    // Someone puts the draft back on the old list on purpose.
    await db.planogram.update({
      where: { id: draft.id },
      data: {
        priceListId: (await db.planogram.findUniqueOrThrow({ where: { id: pog.id } })).priceListId,
      },
    });
    expect(await staleBase((await loadPlanogram(draft.id))!)).toMatchObject({
      base: { id: pog.id },
      priceList: "Повышение (тест)",
    });
  }, 60_000);
});
