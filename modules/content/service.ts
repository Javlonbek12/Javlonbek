import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { db } from "@/lib/db";
import { formatDay, fromDateString, isDateString, toDateString } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import type { ContentChannel, ContentStatus } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { canUseModule, withAccess } from "@/modules/core/access/actor";
import { logActivity } from "@/modules/core/activity/service";
import { notify } from "@/modules/core/notifications/service";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";
import { safeFileName } from "@/modules/tasks/attachment-service";

// Content plan for the company's Telegram bots. Planners (owner, managers with the section on)
// put topics on dates and choose bots and authors; an author uploads the visual and texts RU / UZ
// and sends for review; a planner returns it with feedback or approves it; then it is sent to
// each bot by hand and marked sent here.

export const CHANNELS = ["PARTNER", "CONNECT", "RESEARCH"] as const satisfies ContentChannel[];
export const MAX_IMAGE_MB = 20;

export class ContentError extends Error {
  constructor(
    public readonly code:
      "forbidden" | "invalid" | "notFound" | "image" | "empty" | "state" | "noBot" | "nothingToday",
  ) {
    super(code);
    this.name = "ContentError";
  }
}

// Anyone with the section can add a post to the plan (they become its author);
// planners also assign authors, review, approve and mark sending.
export const canAddContent = (actor: Actor) => canUseModule(actor, "content");

export const canPlanContent = (actor: Actor) =>
  actor.role === "OWNER" || (actor.role === "MANAGER" && canUseModule(actor, "content"));

const EDITABLE_BY_AUTHOR: ContentStatus[] = ["PLANNED", "DRAFT", "CHANGES"];

type PostRow = { authorId: string | null; createdById: string; status: ContentStatus };

export function contentRights(actor: Actor, post: PostRow) {
  const planner = canPlanContent(actor);
  const author = post.authorId === actor.id;
  const creator = post.createdById === actor.id;
  const closed = post.status === "SENT" || post.status === "CANCELLED";
  return {
    view: planner || author || creator,
    planner,
    // Upload the visual and texts.
    editContent: !closed && (planner || (author && EDITABLE_BY_AUTHOR.includes(post.status))),
    submit: (planner || author) && (post.status === "DRAFT" || post.status === "CHANGES"),
    review: planner && post.status === "REVIEW",
    send: planner && post.status === "APPROVED",
    // Planners always; whoever added the post, until it goes for review.
    editPlan: (planner && !closed) || (creator && EDITABLE_BY_AUTHOR.includes(post.status)),
  };
}

function visibleWhere(actor: Actor) {
  return canPlanContent(actor) ? {} : { OR: [{ authorId: actor.id }, { createdById: actor.id }] };
}

const include = {
  author: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

export async function listPostsBetween(
  actor: Actor,
  from: string,
  to: string,
  channel?: ContentChannel,
) {
  return db.contentPost.findMany({
    where: {
      ...visibleWhere(actor),
      publishDate: { gte: fromDateString(from), lte: fromDateString(to) },
      ...(channel ? { channels: { has: channel } } : {}),
    },
    include,
    orderBy: [{ publishDate: "asc" }, { publishTime: "asc" }, { createdAt: "asc" }],
  });
}

// What needs someone now: to review (planners), to prepare (my posts), to send soon (planners).
export async function contentAttention(actor: Actor, today: string) {
  const planner = canPlanContent(actor);
  const [review, prepare, toSend] = await Promise.all([
    planner
      ? db.contentPost.findMany({
          where: { status: "REVIEW" },
          include,
          orderBy: { publishDate: "asc" },
        })
      : Promise.resolve([]),
    db.contentPost.findMany({
      where: { authorId: actor.id, status: { in: EDITABLE_BY_AUTHOR } },
      include,
      orderBy: { publishDate: "asc" },
    }),
    planner
      ? db.contentPost.findMany({
          where: { status: "APPROVED" },
          include,
          orderBy: { publishDate: "asc" },
        })
      : Promise.resolve([]),
  ]);
  const late = (p: { publishDate: Date }) => toDateString(p.publishDate) < today;
  return { review, prepare, toSend, lateCount: [...prepare, ...review].filter(late).length };
}

export async function getPost(actor: Actor, id: string) {
  const post = await db.contentPost.findUnique({
    where: { id },
    include: {
      ...include,
      comments: {
        include: { author: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!post) return null;
  const rights = contentRights(actor, post);
  return rights.view ? { post, rights } : null;
}

async function load(actor: Actor, id: string) {
  const post = await db.contentPost.findUnique({ where: { id } });
  if (!post) throw new ContentError("notFound");
  const rights = contentRights(actor, post);
  if (!rights.view) throw new ContentError("forbidden");
  return { post, rights };
}

const log = (actor: Actor, action: string, id: string, details?: Record<string, string>) =>
  logActivity({ actorId: actor.id, action, entityType: "ContentPost", entityId: id, details });

const planSchema = z.object({
  title: z.string().trim().min(1).max(200),
  brief: z
    .string()
    .trim()
    .max(4000)
    .nullish()
    .transform((v) => v || null),
  channels: z.array(z.enum(CHANNELS)).min(1),
  publishDate: z.string().refine(isDateString),
  publishTime: z
    .string()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(v)),
  authorId: z
    .string()
    .max(64)
    .nullish()
    .transform((v) => v || null),
});
export type PlanInput = z.input<typeof planSchema>;

const day = (date: Date) => formatDay(toDateString(date));

// A plan item: topic, date, bots, author. Only planners.
export async function savePlanItem(actor: Actor, id: string | null, input: PlanInput) {
  if (!canAddContent(actor)) throw new ContentError("forbidden");
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) throw new ContentError("invalid");
  const { publishDate, ...rest } = parsed.data;
  // An employee's own post: they are the author (a planner may reassign it later).
  if (!canPlanContent(actor)) {
    const existing = id ? await db.contentPost.findUnique({ where: { id } }) : null;
    rest.authorId = existing ? existing.authorId : actor.id;
  }
  if (rest.authorId && !(await db.user.findUnique({ where: { id: rest.authorId } })))
    throw new ContentError("invalid");
  const data = { ...rest, publishDate: fromDateString(publishDate) };
  let post;
  let previousAuthor: string | null = null;
  if (id) {
    const { post: existing, rights } = await load(actor, id);
    if (!rights.editPlan) throw new ContentError("state");
    previousAuthor = existing.authorId;
    post = await db.contentPost.update({ where: { id }, data });
  } else {
    post = await db.contentPost.create({ data: { ...data, createdById: actor.id } });
  }
  await log(actor, id ? "content.updated" : "content.planned", post.id);
  if (post.authorId && post.authorId !== actor.id && post.authorId !== previousAuthor) {
    await notify(post.authorId, {
      type: "content_assigned",
      title: t("notifications.events.contentAssignedTitle"),
      body: t("notifications.events.contentAssignedBody", {
        title: post.title,
        date: day(post.publishDate),
      }),
      link: `/content/${post.id}`,
    });
  }
  return post;
}

const contentSchema = z.object({
  textRu: z
    .string()
    .trim()
    .max(4096)
    .nullish()
    .transform((v) => v || null),
  textUz: z
    .string()
    .trim()
    .max(4096)
    .nullish()
    .transform((v) => v || null),
});

const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/png": {
    ext: "png",
    magic: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  },
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  "image/webp": {
    ext: "webp",
    magic: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
  },
  "image/gif": { ext: "gif", magic: (b) => b.subarray(0, 3).toString() === "GIF" },
};

export function imageType(buffer: Buffer) {
  return Object.entries(IMAGE_TYPES).find(([, type]) => type.magic(buffer))?.[0] ?? null;
}

const uploadRoot = () => path.resolve(getEnv().UPLOAD_DIR);

// The visual and texts. A planned post becomes a draft once something is uploaded.
export async function saveContent(
  actor: Actor,
  id: string,
  input: z.input<typeof contentSchema>,
  image?: File | null,
) {
  const { post, rights } = await load(actor, id);
  if (!rights.editContent) throw new ContentError("forbidden");
  const parsed = contentSchema.safeParse(input);
  if (!parsed.success) throw new ContentError("invalid");
  const data: {
    textRu: string | null;
    textUz: string | null;
    imagePath?: string;
    imageName?: string;
  } = parsed.data;
  if (image && image.size > 0) {
    if (image.size > MAX_IMAGE_MB * 1024 * 1024) throw new ContentError("image");
    const buffer = Buffer.from(await image.arrayBuffer());
    const type = imageType(buffer);
    if (!type) throw new ContentError("image");
    const relative = path.join("content", id, `${randomUUID()}.${IMAGE_TYPES[type].ext}`);
    const absolute = path.join(uploadRoot(), relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, buffer);
    if (post.imagePath) await rm(path.join(uploadRoot(), post.imagePath), { force: true });
    data.imagePath = relative;
    data.imageName = safeFileName(image.name);
  }
  const status: ContentStatus = post.status === "PLANNED" ? "DRAFT" : post.status;
  await db.contentPost.update({ where: { id }, data: { ...data, status } });
  await log(actor, "content.uploaded", id);
}

export async function submitForReview(actor: Actor, id: string) {
  const { post, rights } = await load(actor, id);
  if (!rights.submit) throw new ContentError("state");
  if (!post.imagePath && !post.textRu && !post.textUz) throw new ContentError("empty");
  await db.contentPost.update({ where: { id }, data: { status: "REVIEW" } });
  await log(actor, "content.submitted", id);
  const actorRow = await db.user.findUnique({ where: { id: actor.id } });
  for (const reviewer of await reviewersOf(post, actor)) {
    await notify(reviewer, {
      type: "content_review",
      title: t("notifications.events.contentReviewTitle"),
      body: t("notifications.events.contentReviewBody", {
        name: actorRow ? displayName(actorRow) : "",
        title: post.title,
        date: day(post.publishDate),
      }),
      link: `/content/${id}`,
    });
  }
}

// Who reviews a post: the planner who put it in the plan; for a post an employee added
// themselves — the owner and the managers who have the section.
async function reviewersOf(post: { createdById: string }, actor: Actor) {
  const creator = await db.user.findUnique({ where: { id: post.createdById } });
  if (creator && creator.id !== actor.id && canPlanContent(await withAccess(creator)))
    return [creator.id];
  const candidates = await db.user.findMany({ where: { role: { in: ["OWNER", "MANAGER"] } } });
  const ids: string[] = [];
  for (const user of candidates)
    if (user.id !== actor.id && canPlanContent(await withAccess(user))) ids.push(user.id);
  return ids;
}

export async function returnWithFeedback(actor: Actor, id: string, feedback: string) {
  const { post, rights } = await load(actor, id);
  if (!rights.review) throw new ContentError("state");
  const body = feedback.trim().slice(0, 4000);
  if (!body) throw new ContentError("invalid");
  await db.$transaction([
    db.contentPost.update({ where: { id }, data: { status: "CHANGES" } }),
    db.contentComment.create({ data: { postId: id, authorId: actor.id, body, isFeedback: true } }),
  ]);
  await log(actor, "content.returned", id);
  if (post.authorId && post.authorId !== actor.id) {
    await notify(post.authorId, {
      type: "content_feedback",
      title: t("notifications.events.contentFeedbackTitle"),
      body: t("notifications.events.contentFeedbackBody", {
        title: post.title,
        feedback: body.length > 300 ? `${body.slice(0, 297)}…` : body,
      }),
      link: `/content/${id}`,
    });
  }
}

export async function approvePost(actor: Actor, id: string, now = new Date()) {
  const { post, rights } = await load(actor, id);
  // A planner may also approve a draft they finished themselves.
  if (!rights.planner || !["REVIEW", "DRAFT", "CHANGES"].includes(post.status))
    throw new ContentError("state");
  if (!post.imagePath && !post.textRu && !post.textUz) throw new ContentError("empty");
  await db.contentPost.update({ where: { id }, data: { status: "APPROVED", approvedAt: now } });
  await log(actor, "content.approved", id);
  if (post.authorId && post.authorId !== actor.id) {
    await notify(post.authorId, {
      type: "content_approved",
      title: t("notifications.events.contentApprovedTitle"),
      body: t("notifications.events.contentApprovedBody", {
        title: post.title,
        date: day(post.publishDate),
      }),
      link: `/content/${id}`,
    });
  }
}

// Sent to one bot; when every planned bot got it, the post is sent.
export async function markSent(
  actor: Actor,
  id: string,
  channel: ContentChannel,
  now = new Date(),
) {
  const { post, rights } = await load(actor, id);
  if (!rights.send || !post.channels.includes(channel)) throw new ContentError("state");
  const sent = [...new Set([...post.sentChannels, channel])];
  const done = post.channels.every((c) => sent.includes(c));
  await db.contentPost.update({
    where: { id },
    data: { sentChannels: sent, ...(done ? { status: "SENT", sentAt: now } : {}) },
  });
  await log(actor, "content.sent", id, { channel });
}

export async function cancelPost(actor: Actor, id: string) {
  const { rights } = await load(actor, id);
  if (!rights.editPlan) throw new ContentError("forbidden");
  await db.contentPost.update({ where: { id }, data: { status: "CANCELLED" } });
  await log(actor, "content.cancelled", id);
}

export async function addContentComment(actor: Actor, id: string, body: string) {
  await load(actor, id);
  const text = body.trim().slice(0, 4000);
  if (!text) throw new ContentError("invalid");
  await db.contentComment.create({ data: { postId: id, authorId: actor.id, body: text } });
}

// The visual's file, for those who can see the post.
export async function getContentImage(actor: Actor, id: string) {
  const post = await db.contentPost.findUnique({ where: { id } });
  if (!post?.imagePath || !contentRights(actor, post).view) return null;
  return { absolutePath: path.join(uploadRoot(), post.imagePath), name: post.imageName ?? "image" };
}

export async function listContentAuthors() {
  return db.user.findMany({
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });
}
