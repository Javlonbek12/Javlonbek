import { Plus, Repeat } from "lucide-react";
import Link from "next/link";

import { MeetingButtons, MeetingStatus, timeRange } from "@/components/meetings/meeting-line";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { utcToZonedLocal } from "@/lib/time";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings, getUserToday } from "@/modules/core/settings/service";
import { collapseSeries, dayHeading } from "@/modules/meetings/days";
import {
  countMeetingsWithoutNotes,
  listMeetingsBetween,
  type MeetingRow,
} from "@/modules/meetings/service";
import { distinctNames } from "@/modules/tasks/names";

const DAY = 86_400_000;
const FACES = 4;

const initials = (person: { firstName: string; lastName?: string | null }) =>
  `${person.firstName.charAt(0)}${person.lastName?.charAt(0) ?? ""}`.toUpperCase();

// The people of a meeting as small circles with initials (the names on hover and for readers).
function Faces({ meeting }: { meeting: MeetingRow }) {
  const people = meeting.participants.map((p) => p.user);
  const names = distinctNames(people);
  const label = people.map((p) => names.get(p.id)).join(", ");
  return (
    <span className="flex items-center" title={label} aria-label={label}>
      {people.slice(0, FACES).map((person) => (
        <span
          key={person.id}
          className="bg-secondary text-primary border-card -ml-1.5 flex size-7 items-center justify-center rounded-full border-2 text-[10px] font-bold first:ml-0"
        >
          {initials(person)}
        </span>
      ))}
      {people.length > FACES && (
        <span className="text-muted-foreground ml-1 text-xs">+{people.length - FACES}</span>
      )}
    </span>
  );
}

export default async function MeetingsPage({ searchParams }: PageProps<"/meetings">) {
  const user = await requireUser();
  const { show, who } = await searchParams;
  const past = show === "past";
  // The owner sees every meeting of the team; by default only their own, like on «Сегодня».
  const all = user.role === "OWNER" && who === "all";
  const [{ timezone }, today] = await Promise.all([getSettings(user.id), getUserToday(user.id)]);
  const now = new Date();
  const [meetings, withoutNotes] = await Promise.all([
    past
      ? listMeetingsBetween(user, new Date(now.getTime() - 90 * DAY), now, !all).then((list) =>
          list.reverse(),
        )
      : listMeetingsBetween(
          user,
          new Date(now.getTime() - 2 * 60 * 60_000),
          new Date(now.getTime() + 60 * DAY),
          !all,
        ),
    countMeetingsWithoutNotes(user, now, !all),
  ]);
  const rows = past
    ? meetings.map((meeting) => ({ meeting, step: null, more: 0, last: null }))
    : collapseSeries(meetings);
  const days: { day: string; rows: typeof rows }[] = [];
  for (const row of rows) {
    const day = utcToZonedLocal(row.meeting.startsAt, timezone).slice(0, 10);
    const last = days.at(-1);
    if (last?.day === day) last.rows.push(row);
    else days.push({ day, rows: [row] });
  }
  const href = (next: { show?: string; who?: string }) => {
    const query = new URLSearchParams({
      ...(past ? { show: "past" } : {}),
      ...(all ? { who: "all" } : {}),
      ...next,
    });
    for (const [key, value] of [...query.entries()]) if (!value) query.delete(key);
    const text = query.toString();
    return text ? `/meetings?${text}` : "/meetings";
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[22px] font-medium md:text-2xl">{t("meetings.title")}</h1>
        <Button asChild size="sm">
          <Link href="/meetings/new">
            <Plus />
            {t("meetings.newMeeting")}
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-2 border-b">
        <div className="flex gap-1 text-sm">
          {[
            { key: "upcoming", show: "", label: t("meetings.upcoming"), active: !past },
            { key: "past", show: "past", label: t("meetings.past"), active: past },
          ].map((tab) => (
            <Link
              key={tab.key}
              href={href({ show: tab.show })}
              aria-current={tab.active ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2",
                tab.active
                  ? "border-primary font-medium"
                  : "text-muted-foreground border-transparent",
              )}
            >
              {tab.label}
              {tab.key === "past" && withoutNotes > 0 && (
                <span className="rounded-full bg-amber-500/15 px-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  {t("meetings.noNotesCount", { n: withoutNotes })}
                </span>
              )}
            </Link>
          ))}
        </div>
        {user.role === "OWNER" && (
          <div className="bg-secondary/70 mb-1.5 inline-flex gap-0.5 rounded-full p-1 text-sm">
            {[
              { key: "", label: t("meetings.scopeMine") },
              { key: "all", label: t("meetings.scopeAll") },
            ].map((option) => (
              <Link
                key={option.key || "mine"}
                href={href({ who: option.key })}
                className={cn(
                  "rounded-full px-3 py-1",
                  (option.key === "all") === all
                    ? "bg-card font-medium shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {option.label}
              </Link>
            ))}
          </div>
        )}
      </div>
      {meetings.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("meetings.empty")}</p>
      )}
      {days.map((group) => (
        <section key={group.day} className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-sm font-medium first-letter:uppercase">
            {dayHeading(group.day, today)}
          </h2>
          <ul className="flex flex-col gap-2">
            {group.rows.map(({ meeting, step, more, last }) => {
              const mine = meeting.participants.some((p) => p.userId === user.id);
              return (
                <li
                  key={meeting.id}
                  className={cn(
                    "bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-l-4 border-l-violet-500 p-3",
                    !mine && "border-l-muted-foreground/30 opacity-70",
                  )}
                >
                  <span className="w-24 shrink-0 text-sm font-semibold tabular-nums">
                    {timeRange(meeting, timezone)}
                  </span>
                  <Link
                    href={`/meetings/${meeting.id}`}
                    className="flex min-w-0 flex-1 flex-col gap-0.5"
                  >
                    <span className="truncate font-medium hover:underline">{meeting.title}</span>
                    <span className="flex flex-wrap gap-x-2 text-xs">
                      <MeetingStatus meeting={meeting} now={now} />
                      {step && (
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Repeat className="size-3" aria-hidden />
                          {t(`meetings.series.${step}`)}
                          {more > 0 &&
                            last &&
                            ` · ${t("meetings.series.more", {
                              n: more,
                              date: formatDay(utcToZonedLocal(last, timezone).slice(0, 10)),
                            })}`}
                        </span>
                      )}
                      {!mine && (
                        <span className="text-muted-foreground">{t("meetings.notMine")}</span>
                      )}
                    </span>
                  </Link>
                  <Faces meeting={meeting} />
                  <MeetingButtons meeting={meeting} now={now} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
