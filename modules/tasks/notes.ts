import { db } from "@/lib/db";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";

import { canViewTask, isClosed, type TaskAccessInfo } from "./access";
import { TaskError } from "./errors";

// The task's shared notes («Заметки», BACKLOG item 24): one text per task that everyone who sees
// the task reads and writes; saved on its own while typing. A change by someone other than the
// author is movement (deletion asks then). Saves carry the version they were made on: one made
// over someone else's newer save is refused with that save, never silently wiping it.

export const MAX_NOTE_LENGTH = 20_000;
// One line in the task's history per person per stretch of writing, not one per autosave.
const HISTORY_GAP_MS = 15 * 60_000;

// Written by everyone who sees the task while it is open (a personal one: its author).
export function canEditNote(actor: Actor, task: TaskAccessInfo) {
  return canViewTask(actor, task) && !isClosed(task.status);
}

export type NoteView = {
  text: string;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

const EMPTY: NoteView = { text: "", version: 0, updatedAt: null, updatedBy: null };

export async function getNote(taskId: string): Promise<NoteView> {
  const note = await db.taskNote.findUnique({
    where: { taskId },
    include: { updatedBy: { select: { firstName: true, lastName: true } } },
  });
  if (!note) return EMPTY;
  return {
    text: note.text,
    version: note.version,
    updatedAt: note.updatedAt.toISOString(),
    updatedBy: note.updatedBy ? displayName(note.updatedBy) : null,
  };
}

export type SaveNoteResult =
  | { ok: true; version: number; updatedAt: string }
  // Someone saved after the version this save was made on: theirs, to show.
  | { ok: false; conflict: NoteView };

export async function saveNote(
  actor: Actor,
  taskId: string,
  input: string,
  baseVersion: number,
  now = new Date(),
): Promise<SaveNoteResult> {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canViewTask(actor, task)) throw new TaskError("forbidden");
  if (!canEditNote(actor, task)) throw new TaskError("forbidden");
  const text = input.replace(/\r\n?/g, "\n");
  if (text.length > MAX_NOTE_LENGTH) throw new TaskError("noteTooLong");
  const current = await db.taskNote.findUnique({ where: { taskId } });
  if ((current?.version ?? 0) !== baseVersion)
    return { ok: false, conflict: await getNote(taskId) };
  if (current && current.text === text)
    return { ok: true, version: current.version, updatedAt: current.updatedAt.toISOString() };

  const byOther = actor.id !== task.creatorId;
  let saved;
  if (!current) {
    try {
      saved = await db.taskNote.create({
        data: {
          taskId,
          text,
          updatedById: actor.id,
          editedByOthersAt: byOther ? now : null,
        },
      });
    } catch {
      // Someone created it a moment earlier.
      return { ok: false, conflict: await getNote(taskId) };
    }
  } else {
    const { count } = await db.taskNote.updateMany({
      where: { taskId, version: baseVersion },
      data: {
        text,
        version: { increment: 1 },
        updatedById: actor.id,
        ...(byOther ? { editedByOthersAt: now } : {}),
      },
    });
    if (count === 0) return { ok: false, conflict: await getNote(taskId) };
    saved = await db.taskNote.findUniqueOrThrow({ where: { taskId } });
  }

  const recent = await db.activityLog.findFirst({
    where: {
      entityType: "Task",
      entityId: taskId,
      action: "task.note_saved",
      actorId: actor.id,
      createdAt: { gte: new Date(now.getTime() - HISTORY_GAP_MS) },
    },
  });
  if (!recent)
    await logActivity({
      actorId: actor.id,
      action: "task.note_saved",
      entityType: "Task",
      entityId: taskId,
    });
  return { ok: true, version: saved.version, updatedAt: saved.updatedAt.toISOString() };
}
