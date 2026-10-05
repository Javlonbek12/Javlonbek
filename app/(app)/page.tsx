import Link from "next/link";

import { TaskList } from "@/components/tasks/task-row";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { formatDayLong } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { getTodayOverview } from "@/modules/tasks/service";
import { MeetingChip } from "@/components/meetings/meeting-chip";
import { addDays } from "@/lib/dates";
import { zonedLocalToUtc } from "@/lib/time";
import { getSettings } from "@/modules/core/settings/service";
import { listMeetingsBetween } from "@/modules/meetings/service";
import { canSeeReports } from "@/modules/reports/access";

// The "Today" screen: tasks due today, overdue tasks, tasks waiting for my decision.
export default async function TodayPage() {
  const user = await requireUser();
  const today = await getUserToday(user.id);
  const { dueToday, overdue, waiting } = await getTodayOverview(user, today);
  const { timezone } = await getSettings(user.id);
  const meetings = await listMeetingsBetween(
    user,
    zonedLocalToUtc(`${today}T00:00`, timezone)!,
    zonedLocalToUtc(`${addDays(today, 1)}T00:00`, timezone)!,
    true,
  );
  const botUsername = getEnv().TELEGRAM_BOT_USERNAME;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold md:text-3xl">
            {t("home.greeting", { name: user.firstName })}
          </h1>
          <p className="text-muted-foreground text-sm">
            {formatDayLong(today)} · {t(`roles.${user.role}`)}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {canSeeReports(user) && (
            <Button asChild size="sm" variant="outline">
              <Link href="/reports">{t("reports.open")}</Link>
            </Button>
          )}
          <Button asChild size="sm">
            <Link href="/tasks/new">{t("tasks.newTask")}</Link>
          </Button>
        </div>
      </div>

      {meetings.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">
            {t("nav.meetings")} · {meetings.length}
          </h2>
          {meetings.map((m) => (
            <MeetingChip key={m.id} meeting={m} timezone={timezone} />
          ))}
        </section>
      )}

      {overdue.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-destructive font-medium">
            {t("today.overdue")} · {overdue.length}
          </h2>
          <TaskList tasks={overdue} today={today} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">
          {t("today.dueToday")} · {dueToday.length}
        </h2>
        <TaskList tasks={dueToday} today={today} empty={t("today.empty")} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">
          {t("today.waiting")} · {waiting.length}
        </h2>
        <p className="text-muted-foreground text-xs">{t("today.waitingHint")}</p>
        <TaskList tasks={waiting} today={today} empty={t("today.empty")} />
      </section>

      {!user.botChatId && (
        <Card>
          <CardTitle>Telegram</CardTitle>
          <CardDescription>
            {t("home.botNotLinked")}{" "}
            {botUsername && (
              <a className="text-primary underline" href={`https://t.me/${botUsername}?start`}>
                {t("home.openBot")} @{botUsername}
              </a>
            )}
          </CardDescription>
        </Card>
      )}
    </div>
  );
}
