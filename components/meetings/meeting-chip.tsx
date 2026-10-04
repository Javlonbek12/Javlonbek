import Link from "next/link";

import { formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const COLORS =
  "rounded bg-violet-100 px-1 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100";

// A meeting in the calendar: violet, with its start time.
// `compact` (inside a month-grid cell, which is itself a link) renders plain text: links can't nest.
export function MeetingChip({
  meeting,
  timezone,
  compact = false,
}: {
  meeting: { id: string; title: string; startsAt: Date };
  timezone: string;
  compact?: boolean;
}) {
  const content = (
    <>
      <span className="font-medium">{formatTime(meeting.startsAt, timezone)}</span>{" "}
      <span className="truncate">{meeting.title}</span>
    </>
  );
  if (compact) return <span className={cn(COLORS, "hidden truncate md:block")}>{content}</span>;
  return (
    <Link href={`/meetings/${meeting.id}`} className={cn(COLORS, "flex gap-2 p-2 text-sm")}>
      {content}
    </Link>
  );
}
