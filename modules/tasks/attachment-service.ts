import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { canEditTask, canViewTask } from "./access";
import { TaskError } from "./errors";

export const MAX_FILE_MB = 20;

function uploadRoot() {
  return path.resolve(getEnv().UPLOAD_DIR);
}

async function visibleTask(actor: Actor, taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canViewTask(actor, task)) throw new TaskError("forbidden");
  return task;
}

const linkSchema = z.object({
  title: z.string().trim().max(200),
  url: z.url({ protocol: /^https?$/ }).max(2000),
});

export async function addLinkAttachment(actor: Actor, taskId: string, title: string, url: string) {
  await visibleTask(actor, taskId);
  const parsed = linkSchema.safeParse({ title, url: url.trim() });
  if (!parsed.success) throw new TaskError("invalid");
  const attachment = await db.taskAttachment.create({
    data: {
      taskId,
      kind: "LINK",
      title: parsed.data.title || parsed.data.url,
      url: parsed.data.url,
      uploadedById: actor.id,
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "task.attachment_added",
    entityType: "Task",
    entityId: taskId,
    details: { title: attachment.title },
  });
  return attachment;
}

// Keeps letters (any alphabet), digits, dot, dash and underscore.
export function safeFileName(name: string): string {
  const base = path
    .basename(name)
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^\.+/, "");
  return (base || "file").slice(0, 120);
}

// Files are stored on the server disk: UPLOAD_DIR/tasks/<taskId>/<random>-<name>.
export async function addFileAttachment(actor: Actor, taskId: string, file: File) {
  await visibleTask(actor, taskId);
  if (file.size === 0) throw new TaskError("invalid");
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new TaskError("fileTooLarge");

  const name = safeFileName(file.name);
  const relativePath = path.join("tasks", taskId, `${randomUUID()}-${name}`);
  const absolutePath = path.join(uploadRoot(), relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

  const attachment = await db.taskAttachment.create({
    data: {
      taskId,
      kind: "FILE",
      title: name,
      filePath: relativePath,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      uploadedById: actor.id,
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "task.attachment_added",
    entityType: "Task",
    entityId: taskId,
    details: { title: name },
  });
  return attachment;
}

export async function listAttachments(taskId: string) {
  return db.taskAttachment.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
}

// Returns the attachment and its absolute path, if the actor may download it.
export async function getAttachmentFile(actor: Actor, attachmentId: string) {
  const attachment = await db.taskAttachment.findUnique({
    where: { id: attachmentId },
    include: { task: true },
  });
  if (!attachment || attachment.kind !== "FILE" || !attachment.filePath) return null;
  if (!canViewTask(actor, attachment.task)) return null;
  const absolutePath = path.join(uploadRoot(), attachment.filePath);
  if (!absolutePath.startsWith(uploadRoot() + path.sep)) return null;
  return { attachment, absolutePath };
}

export async function removeAttachment(actor: Actor, attachmentId: string) {
  const attachment = await db.taskAttachment.findUnique({
    where: { id: attachmentId },
    include: { task: true },
  });
  if (!attachment) throw new TaskError("forbidden");
  const allowed =
    canViewTask(actor, attachment.task) &&
    (attachment.uploadedById === actor.id || canEditTask(actor, attachment.task));
  if (!allowed) throw new TaskError("forbidden");

  await db.taskAttachment.delete({ where: { id: attachmentId } });
  if (attachment.filePath) {
    await rm(path.join(uploadRoot(), attachment.filePath), { force: true });
  }
  await logActivity({
    actorId: actor.id,
    action: "task.attachment_removed",
    entityType: "Task",
    entityId: attachment.taskId,
    details: { title: attachment.title },
  });
}
