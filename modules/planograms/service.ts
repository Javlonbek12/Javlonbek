import { randomBytes } from "node:crypto";

import { z } from "zod";

import { db } from "@/lib/db";
import { fromDateString, isDateString, todayInTimezone } from "@/lib/dates";
import { getEnv } from "@/lib/env";
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
import {
  DEFAULT_RULES,
  hasCritical,
  validatePlanogram,
  withMandatory,
  type Rule,
} from "./validate";

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

// The prices in force today: the latest applied list that is already effective. A list made for a
// later date (or not applied yet) would put prices on the new planogram that no shop has. Before
// any list was applied (a fresh library), the latest effective one.
export async function currentPriceList(today = todayInTimezone(getEnv().DEFAULT_TIMEZONE)) {
  const effective = { effectiveFrom: { lte: fromDateString(today) } };
  const order = [{ effectiveFrom: "desc" as const }, { createdAt: "desc" as const }];
  const applied = await db.priceList.findFirst({
    where: { ...effective, appliedAt: { not: null } },
    orderBy: order,
  });
  if (applied) return applied;
  if (await db.priceList.count({ where: { appliedAt: { not: null } } })) return null;
  return db.priceList.findFirst({ where: effective, orderBy: order });
}

// Validation of the stored planogram with its own rules, the current SKU catalogue and the
// mandatory SKUs of its equipment model.
export async function validateStored(loaded: LoadedPlanogram) {
  const skus = withMandatory(await loadSkuInfos(), loaded.record.equipment.mandatorySkuIds);
  return validatePlanogram(loaded.layout, loaded.geometry, skus, loaded.rules);
}

export async function createPlanogram(
  actor: Actor,
  input: PlanogramMeta & {
    equipmentId: string;
    templateId?: string | null;
    fill?: "empty" | "auto";
    // false: no price list was chosen on purpose (the form's empty choice).
    defaultPriceList?: boolean;
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
    const skus = withMandatory(
      (await loadSkuInfos()).filter((s) => !s.archived),
      equipment.mandatorySkuIds,
    );
    layout = autofill(geometry, skus).layout;
  }
  const priceListId =
    meta.priceListId ??
    (input.defaultPriceList === false ? null : ((await currentPriceList())?.id ?? null));

  const planogram = await db.$transaction(async (tx) => {
    const created = await tx.planogram.create({
      data: {
        ...metaData(meta),
        priceListId,
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

// Editing a version that waits for approval sends it back to draft: the approver who was told
// about it hears that it is no longer waiting.
async function backToDraftNotice(actor: Actor, loaded: LoadedPlanogram) {
  if (loaded.record.status !== "PENDING_APPROVAL") return;
  const submitted = await db.activityLog.findFirst({
    where: { action: "planogram.submitted", entityType: "Planogram", entityId: loaded.record.id },
    orderBy: { createdAt: "desc" },
    select: { actorId: true },
  });
  const approvers = await approverFor(submitted?.actorId ?? loaded.record.createdById);
  await notifyPlanogram(approvers, actor, loaded.record.id, () =>
    t("planograms.notify.backToDraft"),
  );
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
  await backToDraftNotice(actor, loaded);
  const updated = await loadPlanogram(id);
  return validateStored(updated!);
}

export async function updateMeta(actor: Actor, id: string, input: PlanogramMeta) {
  const loaded = await loadDraft(actor, id);
  await db.planogram.update({
    where: { id },
    data: { ...metaData(parseMeta(input)), status: "DRAFT" },
  });
  await backToDraftNotice(actor, loaded);
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
  // A deactivated owner gets nothing and is not named as told.
  return people
    .filter((p) => p.role === "OWNER" && !p.deactivated && p.id !== senderId)
    .map((p) => p.id);
}

async function notifyPlanogram(
  userIds: string[],
  actor: Actor,
  id: string,
  title: () => string,
  body?: (name: string, title: string) => string,
) {
  const [planogram, author] = await Promise.all([
    db.planogram.findUniqueOrThrow({ where: { id }, select: { title: true } }),
    db.user.findUniqueOrThrow({ where: { id: actor.id } }),
  ]);
  for (const userId of new Set(userIds)) {
    if (userId === actor.id) continue;
    await notify(userId, () => ({
      type: "planogram",
      title: title(),
      body: body
        ? body(displayName(author), planogram.title)
        : t("notifications.events.taskBody", {
            title: planogram.title,
            name: displayName(author),
          }),
      link: `/planograms/${id}`,
    }));
  }
}

// A version with critical violations isn't sent: the approver could only send it back.
export async function submitForApproval(actor: Actor, id: string) {
  const loaded = await loadDraft(actor, id);
  if (loaded.record.isTemplate) throw new PlanogramError("invalid");
  if (hasCritical(await validateStored(loaded))) throw new PlanogramError("critical");
  await db.planogram.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
  await logActivity({
    actorId: actor.id,
    action: "planogram.submitted",
    entityType: "Planogram",
    entityId: id,
  });
  const approvers = await approverFor(actor.id);
  await notifyPlanogram(approvers, actor, id, () =>
    t("notifications.events.planogramPendingTitle"),
  );
  // Who was told, for the page.
  const people = await db.user.findMany({ where: { id: { in: approvers } } });
  return people.map((p) => displayName(p));
}

// A version in the works that was not made from the version in force: since it was copied,
// another version was approved (a mass operation, a price list, a parallel draft), or it was
// copied from an old one. Approving it replaces the version in force, so whatever came into that
// one after the copy would be gone. Returns what would be lost (null when nothing): layout
// changes of the version in force over this one's source, a header or shelftalkers changed there,
// and its newer price list when this version is on another one.
export async function staleBase(loaded: LoadedPlanogram) {
  const r = loaded.record;
  if (r.isTemplate || (r.status !== "DRAFT" && r.status !== "PENDING_APPROVAL")) return null;
  if (!r.previousVersionId) return null;
  const current = await db.planogram.findFirst({
    where: { rootId: r.rootId ?? r.id, status: "APPROVED", id: { not: r.id } },
    orderBy: { version: "desc" },
    select: { id: true },
  });
  if (!current || current.id === r.previousVersionId) return null;
  const [inForce, base] = await Promise.all([
    loadPlanogram(current.id),
    loadPlanogram(r.previousVersionId),
  ]);
  if (!inForce || !base) return null;
  const none = new Map<string, number>();
  const changes = diffLayouts(
    { layout: base.layout, geometry: base.geometry, prices: none },
    { layout: inForce.layout, geometry: inForce.geometry, prices: none },
  );
  const header = inForce.record.headerPosmId !== base.record.headerPosmId;
  const shelftalkers = JSON.stringify(inForce.shelftalkers) !== JSON.stringify(base.shelftalkers);
  const priceList =
    inForce.record.priceListId !== base.record.priceListId &&
    inForce.record.priceListId !== r.priceListId
      ? (inForce.record.priceList?.name ?? "—")
      : null;
  if (changes.length === 0 && !header && !shelftalkers && !priceList) return null;
  return {
    current: { id: inForce.record.id, version: inForce.record.version },
    base: { id: base.record.id, version: base.record.version },
    changes,
    header,
    shelftalkers,
    priceList,
  };
}

// Approval is blocked while critical rule violations remain, and asks for `force` when the
// version was not made from the one in force (see staleBase). The previously approved version of
// the same planogram is archived; the approved one gets a public link token.
export async function approvePlanogram(
  actor: Actor,
  id: string,
  options: { force?: boolean; now?: Date } = {},
) {
  const now = options.now ?? new Date();
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
  if (!options.force && (await staleBase(loaded))) throw new PlanogramError("stale");
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

// A version waiting for approval goes back to draft: its author takes it back («Отозвать»), or an
// approver returns someone else's with the reason, which the author gets (as with tasks).
export async function returnToDraft(actor: Actor, id: string, reason = "") {
  const loaded = await loadDraft(actor, id);
  const own = loaded.record.createdById === actor.id;
  const why = reason.trim().slice(0, 1000);
  if (loaded.record.status === "PENDING_APPROVAL" && !own) {
    requireApprover(actor);
    if (!why) throw new PlanogramError("reason");
  }
  await db.planogram.update({ where: { id: loaded.record.id }, data: { status: "DRAFT" } });
  if (loaded.record.status !== "PENDING_APPROVAL") return;
  await logActivity({
    actorId: actor.id,
    action: own ? "planogram.withdrawn" : "planogram.returned",
    entityType: "Planogram",
    entityId: id,
    ...(why ? { details: { reason: why } } : {}),
  });
  if (!own)
    await notifyPlanogram(
      [loaded.record.createdById],
      actor,
      id,
      () => t("notifications.events.planogramReturnedTitle"),
      (name, title) => t("planograms.notify.returned", { name, title, reason: why }),
    );
}

// Who sent each version for approval and when: the last «sent» in the log, else (a version a
// mass operation or a price list made waiting) its author when it was made.
export async function submissions(
  versions: { id: string; createdAt: Date; createdById: string }[],
) {
  const [logs, authors] = await Promise.all([
    db.activityLog.findMany({
      where: {
        action: "planogram.submitted",
        entityType: "Planogram",
        entityId: { in: versions.map((v) => v.id) },
      },
      orderBy: { createdAt: "desc" },
      include: { actor: true },
    }),
    db.user.findMany({ where: { id: { in: versions.map((v) => v.createdById) } } }),
  ]);
  return new Map(
    versions.map((v) => {
      const log = logs.find((l) => l.entityId === v.id);
      const person = log?.actor ?? authors.find((a) => a.id === v.createdById);
      return [
        v.id,
        { name: person ? displayName(person) : "—", at: log?.createdAt ?? v.createdAt },
      ] as const;
    }),
  );
}

// Planograms waiting for a decision, the oldest first, with who sent them and when. Only those
// who approve planograms decide, so for anyone else the list is empty. Read by «Сегодня» and the
// planograms list.
export async function planogramsAwaitingApproval(actor: Actor) {
  if (!canApprovePlanograms(actor.role)) return [];
  const versions = await db.planogram.findMany({
    where: { status: "PENDING_APPROVAL", isTemplate: false },
    select: {
      id: true,
      title: true,
      version: true,
      createdAt: true,
      createdById: true,
      updatedAt: true,
      equipment: { select: { name: true } },
    },
    orderBy: { updatedAt: "asc" },
  });
  const sent = await submissions(versions);
  return versions.map((v) => ({
    id: v.id,
    title: v.title,
    version: v.version,
    equipment: v.equipment.name,
    submittedBy: sent.get(v.id)!.name,
    submittedAt: sent.get(v.id)!.at,
  }));
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
    // For other equipment: what of the header and shelftalkers fits it (else none).
    headerPosmId?: string | null;
    shelftalkers?: Shelftalkers;
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
    // The next number in the chain: two versions made from the same one don't share a number.
    const top = newVersion
      ? await tx.planogram.aggregate({
          where: { rootId: r.rootId ?? r.id },
          _max: { version: true },
        })
      : null;
    const created = await tx.planogram.create({
      data: {
        title: options.title ?? r.title,
        equipmentId: options.equipmentId ?? r.equipmentId,
        channel: r.channel,
        project: r.project,
        validFrom: r.validFrom,
        validTo: r.validTo,
        notes: r.notes,
        headerPosmId:
          options.headerPosmId !== undefined
            ? options.headerPosmId
            : options.equipmentId
              ? null
              : r.headerPosmId,
        shelftalkers: (options.shelftalkers ??
          (options.equipmentId ? {} : (r.shelftalkers ?? {}))) as Prisma.InputJsonValue,
        priceListId: options.priceListId === undefined ? r.priceListId : options.priceListId,
        isTemplate: options.isTemplate ?? false,
        status,
        version: newVersion ? Math.max(top?._max.version ?? 0, r.version) + 1 : 1,
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

export type PlanogramCard = {
  id: string;
  title: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "ARCHIVED";
  version: number;
  project: string | null;
  channel: string;
  updatedAt: Date;
  equipment: { id: string; name: string };
  // Newer versions in the works besides the one shown: «есть черновик vN», «на утверждении vN».
  working: { id: string; version: number; status: "DRAFT" | "PENDING_APPROVAL" }[];
};

// One card per planogram (not per version): the version in force, else the latest in the works,
// else (with `all`) the latest archived one; with the other versions in the works as markers.
export async function planogramCards(
  filter: { all?: boolean; project?: string; query?: string } = {},
): Promise<PlanogramCard[]> {
  const rows = await db.planogram.findMany({
    where: { isTemplate: false },
    select: {
      id: true,
      rootId: true,
      title: true,
      status: true,
      version: true,
      project: true,
      channel: true,
      updatedAt: true,
      equipment: { select: { id: true, name: true } },
    },
    orderBy: { version: "desc" },
  });
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const root = row.rootId ?? row.id;
    groups.set(root, [...(groups.get(root) ?? []), row]);
  }
  const query = filter.query?.trim().toLowerCase() ?? "";
  const cards: { card: PlanogramCard; touched: number }[] = [];
  for (const versions of groups.values()) {
    const inForce = versions.find((v) => v.status === "APPROVED");
    const working = versions.filter(
      (v): v is (typeof versions)[number] & { status: "DRAFT" | "PENDING_APPROVAL" } =>
        v.status === "DRAFT" || v.status === "PENDING_APPROVAL",
    );
    const main = inForce ?? working[0] ?? versions[0]!;
    if (!filter.all && main.status === "ARCHIVED") continue;
    if (filter.project && main.project !== filter.project) continue;
    if (query && !versions.some((v) => v.title.toLowerCase().includes(query))) continue;
    cards.push({
      card: {
        id: main.id,
        title: main.title,
        status: main.status,
        version: main.version,
        project: main.project,
        channel: main.channel,
        updatedAt: main.updatedAt,
        equipment: main.equipment,
        working: working
          .filter((v) => v.id !== main.id)
          .map((v) => ({ id: v.id, version: v.version, status: v.status })),
      },
      touched: Math.max(...versions.map((v) => v.updatedAt.getTime())),
    });
  }
  return cards.sort((a, b) => b.touched - a.touched).map((c) => c.card);
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

// A link sent earlier always shows the version that is in force now. When none is (the planogram
// went to the archive), the last one it showed comes back with `inForce: false`, so the page says
// it no longer applies instead of looking approved.
export async function findByShareToken(token: string) {
  const planogram = await db.planogram.findUnique({ where: { shareToken: token } });
  if (!planogram || (planogram.status !== "APPROVED" && planogram.status !== "ARCHIVED"))
    return null;
  const current = await db.planogram.findFirst({
    where: { rootId: planogram.rootId ?? planogram.id, status: "APPROVED" },
    orderBy: { version: "desc" },
  });
  const loaded = await loadPlanogram(current?.id ?? planogram.id);
  return loaded ? { ...loaded, inForce: Boolean(current) } : null;
}

// The version in force of the planogram `id` belongs to (null when none is).
export async function inForceVersion(id: string) {
  const planogram = await db.planogram.findUnique({ where: { id }, select: { rootId: true } });
  if (!planogram) return null;
  return db.planogram.findFirst({
    where: { rootId: planogram.rootId ?? id, status: "APPROVED" },
    orderBy: { version: "desc" },
    select: { id: true, shareToken: true },
  });
}
