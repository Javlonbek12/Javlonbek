import { randomUUID } from "node:crypto";

import { z } from "zod";

import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { addDays, daysBetween, isDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatDateTime, utcToZonedLocal, zonedLocalToUtc } from "@/lib/time";
import { logActivity } from "@/modules/core/activity/service";
import { notify } from "@/modules/core/notifications/service";
import type { Actor } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";
import { activeOr } from "@/modules/core/users/active";
import { displayName } from "@/modules/core/users/display-name";
import { visibleTasksWhere } from "@/modules/tasks/access";

import { canEditMeeting, canViewMeeting, visibleMeetingsWhere } from "./access";
import { weeklyOccurrences } from "./recurrence";
import { meetingPhase } from "./status";

export class MeetingError extends Error {
  constructor(public readonly code: "invalid" | "forbidden" | "noNotes" | "conflict" | "tooLong") {
    super(code);
    this.name = "MeetingError";
  }
}

export const meetingInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  // Local time in the user's timezone, from <input type="datetime-local">.
  startsLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  durationMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60),
  agenda: z
    .string()
    .trim()
    .max(5000)
    .transform((v) => v || null),
  link: z
    .union([z.url({ protocol: /^https?$/ }).max(2000), z.literal("")])
    .transform((v) => v || null),
  participantIds: z.array(z.string().max(64)).max(100),
  repeatUntil: z
    .string()
    .nullable()
    .refine((v) => v === null || v === "" || isDateString(v))
    .transform((v) => v || null),
});

export type MeetingInput = z.input<typeof meetingInputSchema>;

const person = {
  select: { id: true, firstName: true, lastName: true, deactivatedAt: true },
} as const;

const include = {
  participants: { include: { user: person } },
  createdBy: person,
} as const;

function accessInfo(meeting: { createdById: string; participants: { userId: string }[] }) {
  return {
    createdById: meeting.createdById,
    participantIds: meeting.participants.map((p) => p.userId),
  };
}

function parse(input: MeetingInput) {
  const parsed = meetingInputSchema.safeParse(input);
  if (!parsed.success) throw new MeetingError("invalid");
  return parsed.data;
}

// Active people; `keep`: those already in the meeting stay even if deactivated since.
async function validParticipants(ids: string[], creatorId: string, keep: string[] = []) {
  const users = await db.user.findMany({
    where: { AND: [{ id: { in: ids } }, activeOr(keep)] },
    select: { id: true },
  });
  return [...new Set([creatorId, ...users.map((u) => u.id)])];
}

// Creates a meeting (or a weekly series of separate occurrences) and invites participants.
export async function createMeeting(actor: Actor, input: MeetingInput) {
  const data = parse(input);
  const { timezone } = await getSettings(actor.id);
  const starts = weeklyOccurrences(data.startsLocal, data.repeatUntil).map((local) =>
    zonedLocalToUtc(local, timezone),
  );
  if (starts.some((s) => s === null)) throw new MeetingError("invalid");
  const participantIds = await validParticipants(data.participantIds, actor.id);
  const seriesId = starts.length > 1 ? randomUUID() : null;

  const meetings = await db.$transaction(
    starts.map((startsAt) =>
      db.meeting.create({
        data: {
          title: data.title,
          startsAt: startsAt!,
          durationMinutes: data.durationMinutes,
          agenda: data.agenda,
          link: data.link,
          createdById: actor.id,
          seriesId,
          participants: { create: participantIds.map((userId) => ({ userId })) },
        },
      }),
    ),
  );
  const first = meetings[0];
  await logActivity({
    actorId: actor.id,
    action: "meeting.created",
    entityType: "Meeting",
    entityId: first.id,
    details: { occurrences: meetings.length },
  });

  await tellParticipants(actor, "invite", participantIds, first, data.title, seriesId !== null);
  return first;
}

// Invitations to new participants, or "the meeting moved" to the ones already invited.
async function tellParticipants(
  actor: Actor,
  kind: "invite" | "moved",
  userIds: string[],
  meeting: { id: string; startsAt: Date },
  title: string,
  weekly: boolean,
) {
  const recipients = userIds.filter((id) => id !== actor.id);
  if (recipients.length === 0) return;
  const author = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  for (const userId of recipients) {
    const { timezone } = await getSettings(userId);
    await notify(userId, () => ({
      type: "meeting_invite",
      title: t(
        kind === "invite"
          ? "notifications.events.meetingInviteTitle"
          : "notifications.events.meetingMovedTitle",
      ),
      body: t(
        kind === "invite"
          ? "notifications.events.meetingInviteBody"
          : "notifications.events.meetingMovedBody",
        {
          title,
          when:
            formatDateTime(meeting.startsAt, timezone) +
            (weekly ? ` (${t("meetings.weekly")})` : ""),
          name: displayName(author),
        },
      ),
      link: `/meetings/${meeting.id}`,
    }));
  }
}

// Changes one occurrence, or (following) it and the later ones of its weekly series: those move by
// the same number of days to the new time of day. New participants are invited; when the time
// changes, the ones already invited hear about it (the reminder follows the new time by itself).
export async function updateMeeting(
  actor: Actor,
  meetingId: string,
  input: MeetingInput,
  following = false,
) {
  const meeting = await db.meeting.findUnique({
    where: { id: meetingId },
    include: { participants: true },
  });
  if (!meeting || !canEditMeeting(actor, accessInfo(meeting))) throw new MeetingError("forbidden");
  const data = parse(input);
  const { timezone } = await getSettings(actor.id);
  const participantIds = await validParticipants(
    data.participantIds,
    meeting.createdById,
    meeting.participants.map((p) => p.userId),
  );

  const targets =
    following && meeting.seriesId
      ? await db.meeting.findMany({
          where: { seriesId: meeting.seriesId, startsAt: { gte: meeting.startsAt } },
          orderBy: { startsAt: "asc" },
        })
      : [meeting];
  const shift = daysBetween(
    utcToZonedLocal(meeting.startsAt, timezone).slice(0, 10),
    data.startsLocal.slice(0, 10),
  );
  const time = data.startsLocal.slice(11);
  const moves = targets.map((m) => ({
    id: m.id,
    startsAt: zonedLocalToUtc(
      m.id === meeting.id
        ? data.startsLocal
        : `${addDays(utcToZonedLocal(m.startsAt, timezone).slice(0, 10), shift)}T${time}`,
      timezone,
    ),
  }));
  if (moves.some((m) => m.startsAt === null)) throw new MeetingError("invalid");

  await db.$transaction([
    db.meetingParticipant.deleteMany({ where: { meetingId: { in: targets.map((m) => m.id) } } }),
    ...moves.map((move) =>
      db.meeting.update({
        where: { id: move.id },
        data: {
          title: data.title,
          startsAt: move.startsAt!,
          durationMinutes: data.durationMinutes,
          agenda: data.agenda,
          link: data.link,
          participants: { create: participantIds.map((userId) => ({ userId })) },
        },
      }),
    ),
  ]);
  await logActivity({
    actorId: actor.id,
    action: "meeting.updated",
    entityType: "Meeting",
    entityId: meetingId,
    details: { occurrences: targets.length },
  });

  const updated = { id: meetingId, startsAt: moves.find((m) => m.id === meetingId)!.startsAt! };
  const before = new Set(meeting.participants.map((p) => p.userId));
  const weekly = targets.length > 1;
  await tellParticipants(
    actor,
    "invite",
    participantIds.filter((id) => !before.has(id)),
    updated,
    data.title,
    weekly,
  );
  if (updated.startsAt.getTime() !== meeting.startsAt.getTime())
    await tellParticipants(
      actor,
      "moved",
      participantIds.filter((id) => before.has(id)),
      updated,
      data.title,
      weekly,
    );
}

// Deletes one occurrence, or it and all later ones of the same weekly series.
export async function deleteMeeting(actor: Actor, meetingId: string, following = false) {
  const meeting = await db.meeting.findUnique({
    where: { id: meetingId },
    include: { participants: true },
  });
  if (!meeting || !canEditMeeting(actor, accessInfo(meeting))) throw new MeetingError("forbidden");
  const where =
    following && meeting.seriesId
      ? { seriesId: meeting.seriesId, startsAt: { gte: meeting.startsAt } }
      : { id: meetingId };
  const { count } = await db.meeting.deleteMany({ where });
  await logActivity({
    actorId: actor.id,
    action: "meeting.deleted",
    entityType: "Meeting",
    entityId: meetingId,
    details: { count },
  });
  return count;
}

// Meetings starting in [from, to). `notes`: whether the outcome («Итоги встречи») is written, for
// «Итоги не записаны».
export async function listMeetingsBetween(actor: Actor, from: Date, to: Date, onlyMine = false) {
  return db.meeting.findMany({
    where: {
      AND: [
        onlyMine ? { participants: { some: { userId: actor.id } } } : visibleMeetingsWhere(actor),
        { startsAt: { gte: from, lt: to } },
      ],
    },
    include: { ...include, notes: { select: { updatedAt: true } } },
    orderBy: { startsAt: "asc" },
  });
}

export type MeetingRow = Awaited<ReturnType<typeof listMeetingsBetween>>[number];

// Past meetings (up to `now`, the last 90 days) whose outcome nobody wrote yet: the number on the
// «Прошедшие» tab.
export async function countMeetingsWithoutNotes(actor: Actor, now = new Date(), onlyMine = false) {
  const started = await db.meeting.findMany({
    where: {
      AND: [
        onlyMine ? { participants: { some: { userId: actor.id } } } : visibleMeetingsWhere(actor),
        { startsAt: { gte: new Date(now.getTime() - 90 * 86_400_000), lt: now } },
        { notes: null },
      ],
    },
    select: { startsAt: true, durationMinutes: true },
  });
  return started.filter((m) => meetingPhase(m, now) === "past").length;
}

export async function getMeetingDetail(actor: Actor, meetingId: string) {
  const meeting = await db.meeting.findUnique({
    where: { id: meetingId },
    include: {
      ...include,
      notes: { include: { author: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!meeting || !canViewMeeting(actor, accessInfo(meeting))) return null;
  const tasks = await db.task.findMany({
    where: { AND: [visibleTasksWhere(actor), { meetingId }] },
    include: { assignee: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "asc" },
  });
  // How many occurrences «this and following» covers (for the confirmation).
  const followingCount = meeting.seriesId
    ? await db.meeting.count({
        where: { seriesId: meeting.seriesId, startsAt: { gte: meeting.startsAt } },
      })
    : 1;
  return { meeting, tasks, followingCount, canEdit: canEditMeeting(actor, accessInfo(meeting)) };
}

export const NOTES_MAX = 20_000;

async function notesMeeting(actor: Actor, meetingId: string) {
  const meeting = await db.meeting.findUnique({
    where: { id: meetingId },
    include: { participants: true, notes: true },
  });
  if (!meeting || !canViewMeeting(actor, accessInfo(meeting))) throw new MeetingError("forbidden");
  return meeting;
}

const isUniqueClash = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

// Participants, the creator and the OWNER can write the minutes. `version` is the minutes'
// updatedAt the editor started from ("" = there were none): when someone saved in between, the
// save is refused instead of silently overwriting their text.
export async function saveNotes(actor: Actor, meetingId: string, text: string, version?: string) {
  const meeting = await notesMeeting(actor, meetingId);
  const body = text.trim();
  if (!body) throw new MeetingError("invalid");
  if (body.length > NOTES_MAX) throw new MeetingError("tooLong");
  if (version === undefined) {
    await db.meetingNotes.upsert({
      where: { meetingId },
      create: { meetingId, text: body, authorId: actor.id },
      update: { text: body, authorId: actor.id },
    });
  } else if (version === "") {
    if (meeting.notes) throw new MeetingError("conflict");
    try {
      await db.meetingNotes.create({ data: { meetingId, text: body, authorId: actor.id } });
    } catch (error) {
      if (isUniqueClash(error)) throw new MeetingError("conflict");
      throw error;
    }
  } else {
    const since = new Date(version);
    if (Number.isNaN(since.getTime())) throw new MeetingError("invalid");
    const { count } = await db.meetingNotes.updateMany({
      where: { meetingId, updatedAt: since },
      data: { text: body, authorId: actor.id },
    });
    if (count === 0) throw new MeetingError("conflict");
  }
  await logActivity({
    actorId: actor.id,
    action: "meeting.notes_saved",
    entityType: "Meeting",
    entityId: meetingId,
  });
  return meeting;
}

// Minutes from the bot are added below what is already written, under a line with the author and
// the time, so a voice note never wipes out minutes typed on the site.
export async function appendNotes(actor: Actor, meetingId: string, text: string, now = new Date()) {
  const body = text.trim();
  if (!body) throw new MeetingError("invalid");
  for (let attempt = 0; attempt < 3; attempt++) {
    const meeting = await notesMeeting(actor, meetingId);
    const existing = meeting.notes;
    if (!existing) {
      if (body.length > NOTES_MAX) throw new MeetingError("tooLong");
      try {
        await db.meetingNotes.create({ data: { meetingId, text: body, authorId: actor.id } });
      } catch (error) {
        if (isUniqueClash(error)) continue;
        throw error;
      }
    } else {
      const [author, { timezone }] = await Promise.all([
        db.user.findUniqueOrThrow({ where: { id: actor.id } }),
        getSettings(actor.id),
      ]);
      const header = t("meetings.notes.addedBy", {
        name: displayName(author),
        when: formatDateTime(now, timezone),
      });
      const combined = `${existing.text}\n\n${header}\n${body}`;
      if (combined.length > NOTES_MAX) throw new MeetingError("tooLong");
      // Only if nobody saved in between; otherwise read again and add to the fresh text.
      const { count } = await db.meetingNotes.updateMany({
        where: { meetingId, updatedAt: existing.updatedAt },
        data: { text: combined, authorId: actor.id },
      });
      if (count === 0) continue;
    }
    await logActivity({
      actorId: actor.id,
      action: "meeting.notes_saved",
      entityType: "Meeting",
      entityId: meetingId,
      details: { appended: existing !== null },
    });
    return meeting;
  }
  throw new MeetingError("conflict");
}

// The meeting's local date (for resolving "до пятницы" in the minutes).
export async function meetingLocalDate(actor: Actor, startsAt: Date) {
  const { timezone } = await getSettings(actor.id);
  return utcToZonedLocal(startsAt, timezone).slice(0, 10);
}

// Recent meetings of the user for the bot's /notes command (last 3 days up to now + 1 day).
export async function recentMeetingsForNotes(actor: Actor, now = new Date()) {
  return db.meeting.findMany({
    where: {
      AND: [
        visibleMeetingsWhere(actor),
        {
          startsAt: {
            gte: new Date(now.getTime() - 3 * 86_400_000),
            lt: new Date(now.getTime() + 86_400_000),
          },
        },
      ],
    },
    orderBy: { startsAt: "desc" },
    take: 8,
  });
}
