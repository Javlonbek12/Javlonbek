// Where a meeting is in time, for its status line («через 40 мин», «идёт», «прошла») and the
// buttons: «Подключиться» opens 15 minutes before the start and lasts until the end; after the end
// the meeting asks for its outcome («Записать итоги»).

export const JOIN_BEFORE_MINUTES = 15;

export type MeetingPhase = "upcoming" | "soon" | "live" | "past";

type Timed = { startsAt: Date; durationMinutes: number };

export const meetingEnd = (meeting: Timed) =>
  new Date(meeting.startsAt.getTime() + meeting.durationMinutes * 60_000);

export function meetingPhase(meeting: Timed, now: Date): MeetingPhase {
  if (now >= meetingEnd(meeting)) return "past";
  if (now >= meeting.startsAt) return "live";
  const minutes = (meeting.startsAt.getTime() - now.getTime()) / 60_000;
  return minutes <= JOIN_BEFORE_MINUTES ? "soon" : "upcoming";
}

// Whole minutes until the start (0 once it began).
export const minutesUntil = (meeting: Timed, now: Date) =>
  Math.max(0, Math.ceil((meeting.startsAt.getTime() - now.getTime()) / 60_000));

// «Подключиться» is offered from 15 minutes before the start until the end, when there is a link.
export const canJoin = (meeting: Timed & { link: string | null }, now: Date) => {
  const phase = meetingPhase(meeting, now);
  return Boolean(meeting.link) && (phase === "soon" || phase === "live");
};

// A meeting that is over and has no outcome written yet («Итоги не записаны»).
export const needsNotes = (meeting: Timed & { notes: unknown }, now: Date) =>
  meetingPhase(meeting, now) === "past" && !meeting.notes;
