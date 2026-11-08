import { ExternalLink, NotebookPen } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  canJoin,
  meetingEnd,
  meetingPhase,
  minutesUntil,
  needsNotes,
} from "@/modules/meetings/status";

// Meetings have one colour everywhere (owner's decision): violet, on «Сегодня», in the calendar
// and in the meetings list.
export const MEETING_TONE =
  "bg-violet-50 text-violet-900 dark:bg-violet-950/40 dark:text-violet-100";
export const MEETING_DOT = "bg-violet-500";

type Meeting = {
  id: string;
  title: string;
  startsAt: Date;
  durationMinutes: number;
  link: string | null;
  notes: unknown;
};

// «14:00–15:30».
export function timeRange(meeting: Meeting, timezone: string) {
  return `${formatTime(meeting.startsAt, timezone)}–${formatTime(meetingEnd(meeting), timezone)}`;
}

// Where the meeting is now: «через 40 мин», «идёт сейчас», «прошла · Итоги не записаны».
export function MeetingStatus({ meeting, now }: { meeting: Meeting; now: Date }) {
  const phase = meetingPhase(meeting, now);
  const left = minutesUntil(meeting, now);
  if (phase === "live")
    return (
      <span className="font-medium text-violet-700 dark:text-violet-300">
        {t("meetings.status.live")}
      </span>
    );
  if (phase === "past")
    return needsNotes(meeting, now) ? (
      <span className="font-medium text-amber-700 dark:text-amber-300">
        {t("meetings.status.past")} · {t("meetings.status.noNotes")}
      </span>
    ) : (
      <span className="text-muted-foreground">
        {t("meetings.status.past")} · {t("meetings.status.notesDone")}
      </span>
    );
  return left < 60 ? (
    <span className="text-muted-foreground">{t("meetings.status.inMinutes", { n: left })}</span>
  ) : null;
}

// «Подключиться» from 15 minutes before the start until the end; «Записать итоги» once it is over
// and nothing is written.
export function MeetingButtons({ meeting, now }: { meeting: Meeting; now: Date }) {
  const join = canJoin(meeting, now);
  const notes = needsNotes(meeting, now);
  if (!join && !notes) return null;
  return (
    <span className="flex shrink-0 flex-wrap gap-2">
      {join && (
        <Button asChild size="sm">
          <a href={meeting.link!} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
            {t("meetings.join")}
          </a>
        </Button>
      )}
      {notes && (
        <Button asChild size="sm" variant="outline">
          <Link href={`/meetings/${meeting.id}#notes`}>
            <NotebookPen />
            {t("meetings.writeNotes")}
          </Link>
        </Button>
      )}
    </span>
  );
}

// A meeting on «Сегодня»: time, title, status and its buttons.
export function MeetingLine({
  meeting,
  timezone,
  now,
  className,
}: {
  meeting: Meeting;
  timezone: string;
  now: Date;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "bg-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-l-4 border-l-violet-500 p-3",
        className,
      )}
    >
      <Link href={`/meetings/${meeting.id}`} className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold hover:underline">{meeting.title}</span>
        <span className="flex flex-wrap gap-x-2 text-xs">
          <span className="tabular-nums">{timeRange(meeting, timezone)}</span>
          <MeetingStatus meeting={meeting} now={now} />
        </span>
      </Link>
      <MeetingButtons meeting={meeting} now={now} />
    </li>
  );
}
