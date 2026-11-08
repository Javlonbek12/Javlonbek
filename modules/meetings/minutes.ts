import { db } from "@/lib/db";
import { getSettings } from "@/modules/core/settings/service";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";
import { extractActionItems, type ExtractedTask } from "@/modules/ai/prompts";
import type { PromptContext } from "@/modules/ai/context";
import { resolveTasks } from "@/modules/bot/resolve";
import { listProjects } from "@/modules/tasks/service";

import { canViewMeeting } from "./access";
import { MeetingError, meetingLocalDate } from "./service";

export type ActionItemExtractor = (
  userId: string,
  notes: string,
  ctx: PromptContext,
) => Promise<ExtractedTask[]>;

// Proposed tasks from the saved minutes (or only from `text`, the part just added by the bot); the
// user confirms them before anything is created.
export async function proposeActionItems(
  actor: Actor,
  meetingId: string,
  extract: ActionItemExtractor = extractActionItems,
  text?: string,
) {
  const meeting = await db.meeting.findUnique({
    where: { id: meetingId },
    include: { participants: { include: { user: true } }, notes: true },
  });
  if (
    !meeting ||
    !canViewMeeting(actor, {
      createdById: meeting.createdById,
      participantIds: meeting.participants.map((p) => p.userId),
    })
  ) {
    throw new MeetingError("forbidden");
  }
  if (!meeting.notes) throw new MeetingError("noNotes");

  const [user, people, projects, settings] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: actor.id } }),
    // Tasks from the minutes go to active people only.
    db.user.findMany({
      where: { deactivatedAt: null },
      select: { id: true, firstName: true, lastName: true, telegramUsername: true },
    }),
    listProjects(actor),
    getSettings(actor.id),
  ]);
  // Participants first: the model matches names against them most of the time.
  const participantIds = new Set(meeting.participants.map((p) => p.userId));
  const ordered = [
    ...people.filter((p) => participantIds.has(p.id)),
    ...people.filter((p) => !participantIds.has(p.id)),
  ];
  const ctx: PromptContext = {
    today: await meetingLocalDate(actor, meeting.startsAt),
    timezone: settings.timezone,
    speakerName: displayName(user),
    teamNames: ordered.map((p) => displayName(p)),
    projects,
  };
  const items = await extract(actor.id, text ?? meeting.notes.text, ctx);
  return resolveTasks(items, ordered, actor.id);
}
