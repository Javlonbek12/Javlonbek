"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/lib/db";
import { createRateLimiter } from "@/lib/rate-limit";
import { requireModule } from "@/modules/core/access/guard";
import { sendTelegramPhoto } from "@/modules/bot/send";
import { getEnv } from "@/lib/env";
import { PlanogramError } from "@/modules/planograms/errors";
import { planogramPng, slideSubtitle, slideTitle } from "@/modules/planograms/export";
import type { Layout } from "@/modules/planograms/layout";
import {
  saveEquipment,
  savePosm,
  saveSku,
  type EquipmentInput,
} from "@/modules/planograms/library";
import {
  adaptPlanogram,
  insertSkuEverywhere,
  replaceSkuEverywhere,
} from "@/modules/planograms/mass";
import { applyPriceList } from "@/modules/planograms/pricing";
import { loadPlanogram } from "@/modules/planograms/repository";
import {
  approvePlanogram,
  archivePlanogram,
  copyPlanogram,
  createPlanogram,
  returnToDraft,
  saveLayout,
  submitForApproval,
  updateMeta,
  updateRules,
} from "@/modules/planograms/service";
import type { Rule } from "@/modules/planograms/validate";

const allowAction = createRateLimiter({ limit: 120, windowMs: 60_000 });

async function actor() {
  const user = await requireModule("planograms");
  if (!allowAction(user.id)) throw new Error("Too many requests");
  return user;
}

const str = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};
const idSchema = z.string().min(1).max(64);

// Runs an action and returns to `back` with ?error=<code> on a planogram error.
async function run(back: string, action: () => Promise<string | void>) {
  let target = back;
  try {
    const next = await action();
    if (next) target = next;
  } catch (error) {
    if (!(error instanceof PlanogramError)) throw error;
    target = `${back}${back.includes("?") ? "&" : "?"}error=${error.code}`;
  }
  revalidatePath("/planograms", "layout");
  redirect(target);
}

const meta = (formData: FormData) => ({
  title: str(formData, "title"),
  channel: str(formData, "channel"),
  project: str(formData, "project"),
  validFrom: str(formData, "validFrom") || null,
  validTo: str(formData, "validTo") || null,
  priceListId: str(formData, "priceListId") || null,
  notes: str(formData, "notes"),
});

export async function createPlanogramAction(formData: FormData) {
  const user = await actor();
  await run("/planograms/new", async () => {
    const created = await createPlanogram(user, {
      ...meta(formData),
      equipmentId: str(formData, "equipmentId"),
      templateId: str(formData, "templateId") || null,
      fill: str(formData, "fill") === "auto" ? "auto" : "empty",
    });
    return `/planograms/${created.id}/edit`;
  });
}

export async function updateMetaAction(formData: FormData) {
  const user = await actor();
  const id = idSchema.parse(str(formData, "planogramId"));
  await run(`/planograms/${id}`, () => updateMeta(user, id, meta(formData)));
}

// Called from the editor with the whole layout as JSON.
export async function saveLayoutAction(
  planogramId: string,
  layoutJson: string,
  headerPosmId: string | null,
) {
  const user = await actor();
  try {
    const layout = JSON.parse(layoutJson) as Layout;
    await saveLayout(user, idSchema.parse(planogramId), layout, headerPosmId);
    revalidatePath(`/planograms/${planogramId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof PlanogramError) return { ok: false, error: error.code };
    if (error instanceof SyntaxError) return { ok: false, error: "layout" };
    throw error;
  }
}

export async function workflowAction(formData: FormData) {
  const user = await actor();
  const id = idSchema.parse(str(formData, "planogramId"));
  const step = str(formData, "step");
  await run(`/planograms/${id}`, async () => {
    if (step === "submit") await submitForApproval(user, id);
    else if (step === "approve") await approvePlanogram(user, id);
    else if (step === "draft") await returnToDraft(user, id);
    else if (step === "archive") await archivePlanogram(user, id);
    else if (step === "version") return `/planograms/${(await copyPlanogram(user, id)).id}/edit`;
    else if (step === "template")
      return `/planograms/${(await copyPlanogram(user, id, { asNew: true, isTemplate: true, title: `${str(formData, "title")} (шаблон)` })).id}`;
    else if (step === "adapt") {
      const { planogram } = await adaptPlanogram(
        user,
        id,
        idSchema.parse(str(formData, "equipmentId")),
      );
      return `/planograms/${planogram.id}/edit`;
    }
  });
}

export async function updateRulesAction(formData: FormData) {
  const user = await actor();
  const id = idSchema.parse(str(formData, "planogramId"));
  const kinds = [
    "MANDATORY_SKUS",
    "FACINGS",
    "BRAND_BLOCKS",
    "BRAND_ORDER",
    "NEW_ITEMS",
    "ALL_SLOTS_DECIDED",
  ] as const;
  const shelves = (value: string) => {
    const list = value
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    return list.length ? list.map((n) => n - 1) : null;
  };
  const rules: Rule[] = kinds.map((kind) => {
    const params: Record<string, unknown> = {};
    if (kind === "MANDATORY_SKUS" || kind === "NEW_ITEMS")
      params.shelves = shelves(str(formData, `${kind}_shelves`));
    if (kind === "NEW_ITEMS") params.badge = "YANGI";
    if (kind === "FACINGS") {
      params.min = Number(str(formData, "FACINGS_min")) || 1;
      params.max = Number(str(formData, "FACINGS_max")) || 4;
    }
    if (kind === "BRAND_ORDER")
      params.order = str(formData, "BRAND_ORDER_order")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return {
      kind,
      severity: formData.get(`${kind}_critical`) === "on" ? "CRITICAL" : "WARNING",
      enabled: formData.get(`${kind}_enabled`) === "on",
      params,
    };
  });
  await run(`/planograms/${id}`, () => updateRules(user, id, rules));
}

// Sends the picture and the public link of an approved planogram to chosen users.
export async function sendToTelegramAction(formData: FormData) {
  const user = await actor();
  const id = idSchema.parse(str(formData, "planogramId"));
  const userIds = formData.getAll("userIds").filter((v): v is string => typeof v === "string");
  await run(`/planograms/${id}`, async () => {
    if (user.role !== "OWNER" && user.role !== "MANAGER") throw new PlanogramError("forbidden");
    const loaded = await loadPlanogram(id);
    if (!loaded || !loaded.record.shareToken) throw new PlanogramError("notFound");
    const png = await planogramPng(loaded);
    const caption = `${slideTitle(loaded)}\n${slideSubtitle(loaded)}\n${getEnv().APP_URL}/p/${loaded.record.shareToken}`;
    const recipients = await db.user.findMany({
      where: { id: { in: userIds }, botChatId: { not: null } },
    });
    let sent = 0;
    for (const r of recipients) if (await sendTelegramPhoto(r.botChatId!, png, caption)) sent += 1;
    return `/planograms/${id}?sent=${sent}`;
  });
}

// ---------- library ----------

export async function saveEquipmentAction(formData: FormData) {
  const user = await actor();
  const id = str(formData, "equipmentId") || null;
  await run(id ? `/planograms/equipment/${id}` : "/planograms/equipment", async () => {
    const geometry = JSON.parse(str(formData, "geometry") || "{}") as EquipmentInput["geometry"];
    const saved = await saveEquipment(user, id, {
      code: str(formData, "code"),
      name: str(formData, "name"),
      channel: str(formData, "channel"),
      geometry,
      distTypes: formData.getAll("distTypes").map(String),
    });
    return `/planograms/equipment/${saved.id}?saved=1`;
  });
}

export async function saveSkuAction(formData: FormData) {
  const user = await actor();
  const id = str(formData, "skuId") || null;
  await run(id ? `/planograms/skus/${id}` : "/planograms/skus/new", async () => {
    const saved = await saveSku(user, id, {
      code: str(formData, "code"),
      brand: str(formData, "brand"),
      name: str(formData, "name"),
      format: str(formData, "format"),
      defaultBadges: str(formData, "defaultBadges")
        .split(",")
        .map((b) => b.trim())
        .filter(Boolean),
      isNew: formData.get("isNew") === "on",
      newSince: str(formData, "newSince") || null,
      isMandatory: formData.get("isMandatory") === "on",
      priceStyle: str(formData, "priceStyle") === "MING" ? "MING" : "NUMBER",
      color: str(formData, "color") || "#64748b",
      archived: formData.get("archived") === "on",
    });
    return `/planograms/skus/${saved.id}?saved=1`;
  });
}

export async function savePosmAction(formData: FormData) {
  const user = await actor();
  const id = str(formData, "posmId") || null;
  await run(id ? `/planograms/posm/${id}` : "/planograms/posm", async () => {
    const saved = await savePosm(user, id, {
      name: str(formData, "name"),
      type: str(formData, "type") as "HEADER" | "BANNER" | "STICKER",
      slotSpan: Number(str(formData, "slotSpan")) || 1,
      shelfSpan: Number(str(formData, "shelfSpan")) || 1,
      color: str(formData, "color") || "#16a34a",
      archived: formData.get("archived") === "on",
    });
    return `/planograms/posm/${saved.id}?saved=1`;
  });
}

export async function applyPriceListAction(formData: FormData) {
  const user = await actor();
  const id = idSchema.parse(str(formData, "priceListId"));
  await run(`/planograms/prices/${id}`, async () => {
    const created = await applyPriceList(user, id);
    return `/planograms/prices/${id}?created=${created.length}`;
  });
}

export async function massReplaceAction(formData: FormData) {
  const user = await actor();
  await run("/planograms/mass", async () => {
    const created = await replaceSkuEverywhere(
      user,
      idSchema.parse(str(formData, "fromSkuId")),
      idSchema.parse(str(formData, "toSkuId")),
    );
    return `/planograms/mass?done=${created.length}`;
  });
}

export async function massInsertAction(formData: FormData) {
  const user = await actor();
  await run("/planograms/mass", async () => {
    const result = await insertSkuEverywhere(
      user,
      idSchema.parse(str(formData, "equipmentId")),
      idSchema.parse(str(formData, "skuId")),
      Number(str(formData, "shelf")) - 1,
      Number(str(formData, "position")) - 1,
    );
    return `/planograms/mass?done=${result.created.length}&skipped=${result.skipped.length}`;
  });
}

export async function approveAllPendingAction() {
  const user = await actor();
  await run("/planograms/mass", async () => {
    const pending = await db.planogram.findMany({
      where: { status: "PENDING_APPROVAL", isTemplate: false },
      select: { id: true },
    });
    let approved = 0;
    for (const p of pending) {
      try {
        await approvePlanogram(user, p.id);
        approved += 1;
      } catch (error) {
        if (!(error instanceof PlanogramError)) throw error;
      }
    }
    return `/planograms/mass?approved=${approved}`;
  });
}
