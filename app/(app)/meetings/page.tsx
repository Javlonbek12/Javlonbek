import { Plus, Repeat } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { listMeetingsBetween } from "@/modules/meetings/service";

export default async function MeetingsPage({ searchParams }: PageProps<"/meetings">) {
  const user = await requireUser();
  const { show } = await searchParams;
  const past = show === "past";
  const { timezone } = await getSettings(user.id);
  const now = new Date();
  const day = 86_400_000;
  const meetings = past
    ? (await listMeetingsBetween(user, new Date(now.getTime() - 90 * day), now)).reverse()
    : await listMeetingsBetween(
        user,
        new Date(now.getTime() - 2 * 60 * 60_000),
        new Date(now.getTime() + 60 * day),
      );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("meetings.title")}</h1>
        <Button asChild size="sm">
          <Link href="/meetings/new">
            <Plus />
            {t("meetings.newMeeting")}
          </Link>
        </Button>
      </div>
      <div className="flex gap-1 border-b text-sm">
        {[
          { key: "upcoming", href: "/meetings", label: t("meetings.upcoming"), active: !past },
          { key: "past", href: "/meetings?show=past", label: t("meetings.past"), active: past },
        ].map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2",
              tab.active
                ? "border-primary font-medium"
                : "text-muted-foreground border-transparent",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      {meetings.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("meetings.empty")}</p>
      )}
      <div className="flex flex-col gap-2">
        {meetings.map((m) => (
          <Link
            key={m.id}
            href={`/meetings/${m.id}`}
            className="bg-card hover:bg-accent/50 flex flex-col gap-1 rounded-lg border p-3"
          >
            <span className="flex items-center gap-2 font-medium">
              {m.title}
              {m.seriesId && (
                <Repeat
                  className="text-muted-foreground size-3.5"
                  aria-label={t("meetings.weekly")}
                />
              )}
            </span>
            <span className="text-muted-foreground text-xs">
              {formatDateTime(m.startsAt, timezone)} · {m.durationMinutes} мин ·{" "}
              {m.participants.length} уч.
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
