import { randomBytes } from "node:crypto";

import { z } from "zod";

import { db } from "@/lib/db";
import { fromDateString, isDateString } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import { logActivity } from "@/modules/core/activity/service";
import { notify } from "@/modules/core/notifications/service";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";
import { loadRouting, nearestManager } from "@/modules/tasks/routing";

import { canApprovePlanograms, canManagePlanograms } from "./access";
import { autofill } from "./autofill";
import { diffLayouts, type LayoutChange } from "./diff";
import { PlanogramError } from "./errors";
import { parseGeometry } from "./geometry";
import { layoutProblems, type Layout } from "./layout";
import {
  loadPlanogram,
  loadSkuInfos,
  slotsFromLayout,
  type LoadedPlanogram,
  type Shelftalkers,
} from "./repository";
import { DEFAULT_RULES, hasCritical, validatePlanogram, type Rule } from "./validate";

function requireManager(actor: Actor) {
  if (!canManagePlanograms(actor.role)) throw new PlanogramError("forbidden");
}

function requireApprover(actor: Actor) {
  if (!canApprovePlanograms(actor.role)) throw new PlanogramError("forbidden");
}

const dateOrNull = z
  .string()
  .nullable()
  .transform((v) => v || null)
  .refine((v) => v === null || isDateString(v));

export const planogramMetaSchema = z.object({
  title: z.string().trim().min(1).max(200),
  channel: z.string().trim().min(1).max(40),
  project: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .transform((v) => v || null),
  validFrom: dateOrNull,
  validTo: dateOrNull,
  priceListId: z
    .string()
    .max(64)
    .nullable()
    .transform((v) => v || null),
  notes: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .transform((v) => v || null),
});

export type PlanogramMeta = z.input<typeof planogramMetaSchema>;

function parseMeta(input: PlanogramMeta) {
  const parsed = planogramMetaSchema.safeParse(input);
  if (!parsed.success) throw new PlanogramError("invalid");
  return parsed.data;
}

const metaData = (meta: z.output<typeof planogramMetaSchema>) => ({
  title: meta.title,
  channel: meta.channel,
  project: meta.project,
  validFrom: meta.validFrom ? fromDateString(meta.validFrom) : null,
  validTo: meta.validTo ? fromDateString(meta.validTo) : null,
  priceListId: meta.priceListId,
  notes: meta.notes,
});

async function latestPriceListId() {
  const list = await db.priceList.findFirst({
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  return list?.id ?? null;
}

// Validation of the stored planogram with its own rules and the current SKU catalogue.
export async function validateStored(loaded: LoadedPlanogram) {
  const skus = await loadSkuInfos();
  return validatePlanogram(loaded.layout, loaded.geometry, skus, loaded.rules);
}

export async function createPlanogram(
  actor: Actor,
  input: PlanogramMeta & {
    equipmentId: string;
    templateId?: string | null;
    fill?: "empty" | "auto";
  },
) {
  requireManager(actor);
  const meta = parseMeta(input);
  const equipment = await db.equipment.findUnique({ where: { id: input.equipmentId } });
  if (!equipment) throw new PlanogramError("invalid");
  const geometry = parseGeometry(equipment.geometry);

  let layout: Layout = {};
  let rules: Rule[] = DEFAULT_RULES;
  let headerPosmId: string | null = null;
  let shelftalkers: Prisma.InputJsonValue = {};
  if (input.templateId) {
    const template = await loadPlanogram(input.templateId);
    if (!template || template.record.equipmentId !== equipment.id)
      throw new PlanogramError("invalid");
    layout = template.layout;
    rules = template.rules;
    headerPosmId = template.record.headerPosmId;
    shelftalkers = template.shelftalkers;
  } else if (input.fill === "auto") {
    const skus = (await loadSkuInfos()).filter((s) => !s.archived);
    layout = autofill(geometry, skus).layout;
  }

  const planogram = await db.$transaction(async (tx) => {
    const created = await tx.planogram.create({
      data: {
        ...metaData(meta),
        priceListId: meta.priceListId ?? (await latestPriceListId()),
        equipmentId: equipment.id,
        headerPosmId,
        shelftalkers,
        createdById: actor.id,
        rules: {
          create: rules.map((r) => ({
            kind: r.kind,
            severity: r.severity,
            enabled: r.enabled,
            params: r.params as Prisma.InputJsonValue,
          })),
        },
      },
    });
    await tx.planogram.update({ where: { id: created.id }, data: { rootId: created.id } });
    await tx.planogramSlot.createMany({ data: slotsFromLayout(created.id, layout) });
    return created;
  });
  await logActivity({
    actorId: actor.id,
    action: "planogram.created",
    entityType: "Planogram",
    entityId: planogram.id,
  });
  return planogram;
}

async function loadDraft(actor: Actor, id: string) {
  requireManager(actor);
  const loaded = await loadPlanogram(id);
  if (!loaded) throw new PlanogramError("notFound");
  if (loaded.record.status !== "DRAFT" && loaded.record.status !== "PENDING_APPROVAL")
    throw new PlanogramError("notDraft");
  return loaded;
}

// Saves the editor's layout. Editing a planogram that waits for approval sends it back to draft.
export async function saveLayout(
  actor: Actor,
  id: string,
  layout: Layout,
  headerPosmId: string | null,
  // The shelftalker of each shelf (only shelves of the equipment); undefined keeps them.
  shelftalkers?: Shelftalkers,
) {
  const loaded = await loadDraft(actor, id);
  if (layoutProblems(layout, loaded.geometry).length > 0) throw new PlanogramError("layout");
  const skuIds = new Set((await db.sku.findMany({ select: { id: true } })).map((s) => s.id));
  const posmIds = new Set((await db.posm.findMany({ select: { id: true } })).map((p) => p.id));
  for (const content of Object.values(layout)) {
    if (content.kind === "SKU" && !skuIds.has(content.skuId)) throw new PlanogramError("layout");
    if (content.kind === "POSM" && !posmIds.has(content.posmId)) throw new PlanogramError("layout");
  }
  if (headerPosmId && !posmIds.has(headerPosmId)) throw new PlanogramError("layout");
  if (
    shelftalkers &&
    Object.entries(shelftalkers).some(
      ([shelf, posmId]) => !loaded.geometry.shelves[Number(shelf)] || !posmIds.has(posmId),
    )
  )
    throw new PlanogramError("layout");

  await db.$transaction([
    db.planogramSlot.deleteMany({ where: { planogramId: id } }),
    db.planogramSlot.createMany({ data: slotsFromLayout(id, layout) }),
    db.planogram.update({
      where: { id },
      data: {
        headerPosmId,
        ...(shelftalkers ? { shelftalkers: shelftalkers as Prisma.InputJsonValue } : {}),
        status: "DRAFT",
      },
    }),
  ]);
  await logActivity({
    actorId: actor.id,
    action: "planogram.layout_saved",
    entityType: "Planogram",
    entityId: id,
  });
  const updated = await loadPlanogram(id);
  return validateStored(updated!);
}

export async function updateMeta(actor: Actor, id: string, input: PlanogramMeta) {
  await loadDraft(actor, id);
  await db.planogram.update({
    where: { id },
    data: { ...metaData(parseMeta(input)), status: "DRAFT" },
  });
}

const ruleSchema = z.object({
  kind: z.enum([
    "MANDATORY_SKUS",
    "FACINGS",
    "BRAND_BLOCKS",
    "BRAND_ORDER",
    "NEW_ITEMS",
    "ALL_SLOTS_DECIDED",
  ]),
  severity: z.enum(["CRITICAL", "WARNING"]),
  enabled: z.boolean(),
  params: z.record(z.string(), z.unknown()),
});

export async function updateRules(actor: Actor, id: string, rules: Rule[]) {
  await loadDraft(actor, id);
  const parsed = z.array(ruleSchema).safeParse(rules);
  if (!parsed.success) throw new PlanogramError("invalid");
  await db.$transaction(
    parsed.data.map((r) =>
      db.planogramRule.upsert({
        where: { planogramId_kind: { planogramId: id, kind: r.kind } },
        create: { planogramId: id, ...r, params: r.params as Prisma.InputJsonValue },
        update: {
          severity: r.severity,
          enabled: r.enabled,
          params: r.params as Prisma.InputJsonValue,
        },
      }),
    ),
  );
}

// Who hears about a planogram sent for approval: the sender's nearest manager (the owner when
// there is none or they can't approve planograms), as with tasks (routing v2).
async function approverFor(senderId: string) {
  const { people } = await loadRouting();
  const manager = nearestManager(people, senderId);
  const person = people.find((p) => p.id === manager);
  if (person && person.id !== senderId && canApprovePlanograms(person.role)) return [person.id];
  return people.filter((p) => p.role === "OWNER" && p.id !== senderId).map((p) => p.id);
}

async function notifyPlanogram(userIds: string[], actor: Actor, id: string, title: () => string) {
  const [planogram, author] = await Promise.all([
    db.planogram.findUniqueOrThrow({ where: { id }, select: { title: true } }),
    db.user.findUniqueOrThrow({ where: { id: actor.id } }),
  ]);
  for (const userId of new Set(userIds)) {
    if (userId === actor.id) continue;
    await notify(userId, () => ({
      type: "planogram",
      title: title(),
      body: t("notifications.events.taskBody", {
        title: planogram.title,
        name: displayName(author),
      }),
      link: `/planograms/${id}`,
    }));
  }
}

export async function submitForApproval(actor: Actor, id: string) {
  const loaded = await loadDraft(actor, id);
  if (loaded.record.isTemplate) throw new PlanogramError("invalid");
  await db.planogram.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
  await logActivity({
    actorId: actor.id,
    action: "planogram.submitted",
    entityType: "Planogram",
    entityId: id,
  });
  await notifyPlanogram(await approverFor(actor.id), actor, id, () =>
    t("notifications.events.planogramPendingTitle"),
  );
}

// Approval is blocked while critical rule violations remain. The previously approved
// version of the same planogram is archived; the approved one gets a public link token.
export async function approvePlanogram(actor: Actor, id: string, now = new Date()) {
  requireApprover(actor);
  const loaded = await loadPlanogram(id);
  if (!loaded) throw new PlanogramError("notFound");
  // «На утверждении» means something: someone else's draft is approved only once they send it
  // (an approver's own draft can be approved straight away).
  const ownDraft = loaded.record.status === "DRAFT" && loaded.record.createdById === actor.id;
  if (loaded.record.status !== "PENDING_APPROVAL" && !ownDraft)
    throw new PlanogramError("notDraft");
  if (loaded.record.isTemplate) throw new PlanogramError("invalid");
  if (hasCritical(await validateStored(loaded))) throw new PlanogramError("critical");
  await db.$transaction([
    db.planogram.updateMany({
      where: { rootId: loaded.record.rootId, status: "APPROVED", id: { not: id } },
      data: { status: "ARCHIVED" },
    }),
    db.planogram.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedAt: now,
        approvedById: actor.id,
        shareToken: loaded.record.shareToken ?? randomBytes(18).toString("base64url"),
      },
    }),
  ]);
  await logActivity({
    actorId: actor.id,
    action: "planogram.approved",
    entityType: "Planogram",
    entityId: id,
  });
  await notifyPlanogram([loaded.record.createdById], actor, id, () =>
    t("notifications.events.planogramApprovedTitle"),
  );
}

export async function returnToDraft(actor: Actor, id: string) {
  const loaded = await loadDraft(actor, id);
  await db.planogram.update({ where: { id: loaded.record.id }, data: { status: "DRAFT" } });
  if (loaded.record.status === "PENDING_APPROVAL")
    await notifyPlanogram([loaded.record.createdById], actor, id, () =>
      t("notifications.events.planogramReturnedTitle"),
    );
}

export async function archivePlanogram(actor: Actor, id: string) {
  requireApprover(actor);
  await db.planogram.update({ where: { id }, data: { status: "ARCHIVED" } });
  await logActivity({
    actorId: actor.id,
    action: "planogram.archived",
    entityType: "Planogram",
    entityId: id,
  });
}

// A copy of a planogram as a new version (or a new planogram/template when `asNew` is set).
export async function copyPlanogram(
  actor: Actor,
  id: string,
  options: {
    asNew?: boolean;
    isTemplate?: boolean;
    status?: "DRAFT" | "PENDING_APPROVAL" | "APPROVED";
    layout?: Layout;
    priceListId?: string | null;
    title?: string;
    equipmentId?: string;
  } = {},
) {
  requireManager(actor);
  if (options.status === "APPROVED") requireApprover(actor);
  const loaded = await loadPlanogram(id);
  if (!loaded) throw new PlanogramError("notFound");
  const r = loaded.record;
  const newVersion = !options.asNew;
  const status = options.status ?? "DRAFT";

  return db.$transaction(async (tx) => {
    const created = await tx.planogram.create({
      data: {
        title: options.title ?? r.title,
        equipmentId: options.equipmentId ?? r.equipmentId,
        channel: r.channel,
        project: r.project,
        validFrom: r.validFrom,
        validTo: r.validTo,
        notes: r.notes,
        headerPosmId: options.equipmentId ? null : r.headerPosmId,
        shelftalkers: options.equipmentId ? {} : (r.shelftalkers ?? {}),
        priceListId: options.priceListId === undefined ? r.priceListId : options.priceListId,
        isTemplate: options.isTemplate ?? false,
        status,
        version: newVersion ? r.version + 1 : 1,
        rootId: newVersion ? r.rootId : null,
        previousVersionId: newVersion ? r.id : null,
        createdById: actor.id,
        approvedAt: status === "APPROVED" ? new Date() : null,
        approvedById: status === "APPROVED" ? actor.id : null,
        shareToken: status === "APPROVED" ? randomBytes(18).toString("base64url") : null,
        rules: {
          create: loaded.rules.map((rule) => ({
            kind: rule.kind,
            severity: rule.severity,
            enabled: rule.enabled,
            params: rule.params as Prisma.InputJsonValue,
          })),
        },
      },
    });
    if (!newVersion)
      await tx.planogram.update({ where: { id: created.id }, data: { rootId: created.id } });
    if (status === "APPROVED") {
      await tx.planogram.updateMany({
        where: { rootId: r.rootId, status: "APPROVED", id: { not: created.id } },
        data: { status: "ARCHIVED" },
      });
    }
    await tx.planogramSlot.createMany({
      data: slotsFromLayout(created.id, options.layout ?? loaded.layout),
    });
    await logActivity(
      {
        actorId: actor.id,
        action: newVersion ? "planogram.new_version" : "planogram.copied",
        entityType: "Planogram",
        entityId: created.id,
        details: { from: r.id },
      },
      tx,
    );
    return created;
  });
}

// Changes of this version against the previous one (empty for version 1).
export async function changesVsPrevious(loaded: LoadedPlanogram): Promise<LayoutChange[]> {
  if (!loaded.record.previousVersionId) return [];
  const previous = await loadPlanogram(loaded.record.previousVersionId);
  if (!previous) return [];
  return diffLayouts(
    { layout: previous.layout, geometry: previous.geometry, prices: previous.prices },
    { layout: loaded.layout, geometry: loaded.geometry, prices: loaded.prices },
  );
}

export async function listPlanograms(
  filter: { status?: string; project?: string; templates?: boolean } = {},
) {
  return db.planogram.findMany({
    where: {
      isTemplate: filter.templates ?? false,
      ...(filter.status === "active"
        ? { status: { not: "ARCHIVED" } }
        : filter.status
          ? { status: filter.status as never }
          : {}),
      ...(filter.project ? { project: filter.project } : {}),
    },
    include: { equipment: { select: { name: true, code: true } } },
    orderBy: [{ updatedAt: "desc" }],
    take: 300,
  });
}

export async function versionHistory(rootId: string) {
  return db.planogram.findMany({
    where: { rootId },
    select: {
      id: true,
      version: true,
      status: true,
      createdAt: true,
      approvedAt: true,
      priceList: { select: { name: true } },
    },
    orderBy: { version: "desc" },
  });
}

export async function findByShareToken(token: string) {
  const planogram = await db.planogram.findUnique({ where: { shareToken: token } });
  if (!planogram || (planogram.status !== "APPROVED" && planogram.status !== "ARCHIVED"))
    return null;
  // A link sent earlier always shows the version that is in force now.
  const current = await db.planogram.findFirst({
    where: { rootId: planogram.rootId ?? planogram.id, status: "APPROVED" },
    orderBy: { version: "desc" },
  });
  return loadPlanogram(current?.id ?? planogram.id);
}
