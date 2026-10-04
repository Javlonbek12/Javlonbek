import type { Prisma } from "@/lib/generated/prisma/client";
import type { Actor } from "@/modules/core/permissions";

export type MeetingAccessInfo = { createdById: string; participantIds: string[] };

// A meeting is visible to its creator, its participants and the OWNER.
export function canViewMeeting(actor: Actor, meeting: MeetingAccessInfo): boolean {
  return (
    actor.role === "OWNER" ||
    meeting.createdById === actor.id ||
    meeting.participantIds.includes(actor.id)
  );
}

// Time, title and participants are changed by the creator or the OWNER.
export function canEditMeeting(actor: Actor, meeting: MeetingAccessInfo): boolean {
  return actor.role === "OWNER" || meeting.createdById === actor.id;
}

export function visibleMeetingsWhere(actor: Actor): Prisma.MeetingWhereInput {
  if (actor.role === "OWNER") return {};
  return { OR: [{ createdById: actor.id }, { participants: { some: { userId: actor.id } } }] };
}
