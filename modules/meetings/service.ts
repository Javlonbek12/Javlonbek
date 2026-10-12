import { randomUUID } from "node:crypto";

import { z } from "zod";

import { db } from "@/lib/db";
import { isDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatDateTime, utcToZonedLocal, zonedLocalToUtc } from "@/lib/time";
import { logActivity } from "@/modules/core/activity/service";
import { notify } from "@/modules/core/notifications/service";
import type { Actor } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { visibleTasksWhere } from "@/modules/tasks/access";

import { canEditMeeting, canViewMeeting, visibleMeetingsWhere } from "./access";
import { weeklyOccurrences } from "./recurrence";

export class MeetingError extends Error {
  constructor(public readonly code: "invalid" | "forbidden" | "noNotes") {
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

const include = {
  participants: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
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

async function validParticipants(ids: string[], creatorId: string) {
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
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

  const author = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  for (const userId of participantIds.filter((id) => id !== actor.id)) {
    const { timezone: theirTz } = await getSettings(userId);
    await notify(userId, () => ({
      type: "meeting_invite",
      title: t("notifications.events.meetingInviteTitle"),
      body: t("notifications.events.meetingInviteBody", {
        title: data.title,
        when:
          formatDateTime(first.startsAt, theirTz) + (seriesId ? ` (${t("meetings.weekly")})` : ""),
        name: displayName(author),
      }),
      link: `/meetings/${first.id}`,
    }));
  }
  return first;
}

export async function updateMeeting(actor: Actor, meetingId: string, input: MeetingInput) {
  const meeting = await db.meeting.findUnique({
    where: { id: meetingId },
    include: { participants: true },
  });
  if (!meeting || !canEditMeeting(actor, accessInfo(meeting))) throw new MeetingError("forbidden");
  const data = parse(input);
  const { timezone } = await getSettings(actor.id);
  const startsAt = zonedLocalToUtc(data.startsLocal, timezone);
  if (!startsAt) throw new MeetingError("invalid");
  const participantIds = await validParticipants(data.participantIds, meeting.createdById);

  await db.$transaction([
    db.meetingParticipant.deleteMany({ where: { meetingId } }),
    db.meeting.update({
      where: { id: meetingId },
      data: {
        title: data.title,
        startsAt,
        durationMinutes: data.durationMinutes,
        agenda: data.agenda,
        link: data.link,
        participants: { create: participantIds.map((userId) => ({ userId })) },
      },
    }),
  ]);
  await logActivity({
    actorId: actor.id,
    action: "meeting.updated",
    entityType: "Meeting",
    entityId: meetingId,
  });
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

export async function listMeetingsBetween(actor: Actor, from: Date, to: Date, onlyMine = false) {
  return db.meeting.findMany({
    where: {
      AND: [
        onlyMine ? { participants: { some: { userId: actor.id } } } : visibleMeetingsWhere(actor),
        { startsAt: { gte: from, lt: to } },
      ],
    },
    include,
    orderBy: { startsAt: "asc" },
  });
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
  return { meeting, tasks, canEdit: canEditMeeting(actor, accessInfo(meeting)) };
}

// Participants, the creator and the OWNER can write the minutes.
export async function saveNotes(actor: Actor, meetingId: string, text: string) {
  const meeting = await db.meeting.findUnique({
    where: { id: meetingId },
    include: { participants: true },
  });
  if (!meeting || !canViewMeeting(actor, accessInfo(meeting))) throw new MeetingError("forbidden");
  const body = text.trim().slice(0, 20_000);
  if (!body) throw new MeetingError("invalid");
  await db.meetingNotes.upsert({
    where: { meetingId },
    create: { meetingId, text: body, authorId: actor.id },
    update: { text: body, authorId: actor.id },
  });
  await logActivity({
    actorId: actor.id,
    action: "meeting.notes_saved",
    entityType: "Meeting",
    entityId: meetingId,
  });
  return meeting;
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
