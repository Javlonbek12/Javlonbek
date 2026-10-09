import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { ContentFileKind, ContentLang } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/modules/core/permissions";
import { logActivity } from "@/modules/core/activity/service";
import { safeFileName } from "@/modules/tasks/attachment-service";

import { contentRights, ContentError } from "./service";

// Files of a post, separately for Russian and Uzbek: photos, videos and other files (PDF, ...).
// The kind is decided by the file's bytes, not by its name.

export const LANGS = ["RU", "UZ"] as const satisfies ContentLang[];
export const MAX_FILES_PER_LANG = 10;
// Telegram does not let a bot send files bigger than 50 MB.
export const MAX_FILE_MB = 50;

type Detected = { kind: ContentFileKind; mime: string; ext: string };

const startsWith = (b: Buffer, bytes: number[], at = 0) =>
  bytes.every((byte, i) => b[at + i] === byte);

// Photos and videos are recognised by their first bytes; anything else is a plain file.
export function detectFile(buffer: Buffer, name: string): Detected {
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47]))
    return { kind: "PHOTO", mime: "image/png", ext: "png" };
  if (startsWith(buffer, [0xff, 0xd8])) return { kind: "PHOTO", mime: "image/jpeg", ext: "jpg" };
  if (
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return { kind: "PHOTO", mime: "image/webp", ext: "webp" };
  if (buffer.subarray(0, 3).toString("latin1") === "GIF")
    return { kind: "PHOTO", mime: "image/gif", ext: "gif" };
  if (buffer.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("latin1");
    return brand === "qt  "
      ? { kind: "VIDEO", mime: "video/quicktime", ext: "mov" }
      : { kind: "VIDEO", mime: "video/mp4", ext: "mp4" };
  }
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3]))
    return { kind: "VIDEO", mime: "video/webm", ext: "webm" };
  const ext = (path
    .extname(name)
    .slice(1)
    .toLowerCase()
    .match(/^[a-z0-9]{1,8}$/) ?? [""])[0];
  return { kind: "FILE", mime: "application/octet-stream", ext: ext || "bin" };
}

const uploadRoot = () => path.resolve(getEnv().UPLOAD_DIR);

export async function listPostFiles(postId: string) {
  return db.contentFile.findMany({
    where: { postId },
    orderBy: [{ lang: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

async function loadEditable(actor: Actor, postId: string) {
  const post = await db.contentPost.findUnique({ where: { id: postId } });
  if (!post) throw new ContentError("notFound");
  const rights = contentRights(actor, post);
  if (!rights.editContent) throw new ContentError("forbidden");
  return post;
}

// Adds one file to the post in the given language. A planned post becomes a draft.
export async function addPostFile(actor: Actor, postId: string, lang: ContentLang, file: File) {
  const post = await loadEditable(actor, postId);
  if (!LANGS.includes(lang)) throw new ContentError("invalid");
  if (!file.size || file.size > MAX_FILE_MB * 1024 * 1024) throw new ContentError("image");
  const count = await db.contentFile.count({ where: { postId, lang } });
  if (count >= MAX_FILES_PER_LANG) throw new ContentError("tooMany");
  const buffer = Buffer.from(await file.arrayBuffer());
  const type = detectFile(buffer, file.name);
  const relative = path.join("content", postId, `${randomUUID()}.${type.ext}`);
  const absolute = path.join(uploadRoot(), relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, buffer);
  const row = await db.contentFile.create({
    data: {
      postId,
      lang,
      kind: type.kind,
      path: relative,
      name: safeFileName(file.name) || `file.${type.ext}`,
      mime: type.mime,
      size: file.size,
      sortOrder: count,
    },
  });
  await db.contentPost.update({
    where: { id: postId },
    data: { status: post.status === "PLANNED" ? "DRAFT" : post.status },
  });
  await logActivity({
    actorId: actor.id,
    action: "content.file_added",
    entityType: "ContentPost",
    entityId: postId,
    details: { name: row.name, lang },
  });
  return row;
}

// Removes the file from disk only when no other row uses it (old visuals are shared by RU and UZ).
async function removeFromDisk(relative: string) {
  if (await db.contentFile.count({ where: { path: relative } })) return;
  await rm(path.join(uploadRoot(), relative), { force: true });
}

export async function removePostFile(actor: Actor, fileId: string) {
  const file = await db.contentFile.findUnique({ where: { id: fileId } });
  if (!file) throw new ContentError("notFound");
  await loadEditable(actor, file.postId);
  await db.contentFile.delete({ where: { id: fileId } });
  await removeFromDisk(file.path);
  await logActivity({
    actorId: actor.id,
    action: "content.file_removed",
    entityType: "ContentPost",
    entityId: file.postId,
    details: { name: file.name, lang: file.lang },
  });
}

// Moves a file one place up or down within its language.
export async function movePostFile(actor: Actor, fileId: string, direction: "up" | "down") {
  const file = await db.contentFile.findUnique({ where: { id: fileId } });
  if (!file) throw new ContentError("notFound");
  await loadEditable(actor, file.postId);
  const files = await db.contentFile.findMany({
    where: { postId: file.postId, lang: file.lang },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const i = files.findIndex((f) => f.id === fileId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= files.length) return;
  [files[i], files[j]] = [files[j]!, files[i]!];
  await db.$transaction(
    files.map((f, index) =>
      db.contentFile.update({ where: { id: f.id }, data: { sortOrder: index } }),
    ),
  );
}

// A file and its place on disk, for those who can see the post.
export async function getPostFile(actor: Actor, fileId: string) {
  const file = await db.contentFile.findUnique({ where: { id: fileId }, include: { post: true } });
  if (!file || !contentRights(actor, file.post).view) return null;
  const absolutePath = path.join(uploadRoot(), file.path);
  if (!absolutePath.startsWith(uploadRoot() + path.sep)) return null;
  return { file, absolutePath };
}

// Deletes the post's folder (used when the post itself is deleted).
export async function removePostFolder(postId: string) {
  await rm(path.join(uploadRoot(), "content", postId), { recursive: true, force: true });
}

// "Same as Russian": copies the files of one language to the other (the same files on disk).
export async function copyPostFiles(
  actor: Actor,
  postId: string,
  from: ContentLang,
  to: ContentLang,
) {
  await loadEditable(actor, postId);
  if (from === to) throw new ContentError("invalid");
  const [source, existing] = await Promise.all([
    db.contentFile.findMany({
      where: { postId, lang: from },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    db.contentFile.count({ where: { postId, lang: to } }),
  ]);
  if (!source.length) throw new ContentError("empty");
  if (existing + source.length > MAX_FILES_PER_LANG) throw new ContentError("tooMany");
  await db.contentFile.createMany({
    data: source.map((f, i) => ({
      postId,
      lang: to,
      kind: f.kind,
      path: f.path,
      name: f.name,
      mime: f.mime,
      size: f.size,
      sortOrder: existing + i,
    })),
  });
  await logActivity({
    actorId: actor.id,
    action: "content.files_copied",
    entityType: "ContentPost",
    entityId: postId,
    details: { from, to },
  });
}
