import Link from "next/link";

import { TaskList } from "@/components/tasks/task-row";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { formatDay, formatDayLong } from "@/lib/dates";
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
import { StatRing } from "@/components/dashboard/ring";
import { WeekBars } from "@/components/dashboard/week-bars";
import { HealthBadge } from "@/components/projects/health-badge";
import { projectColor } from "@/components/projects/portfolio";
import { ProgressBar } from "@/components/projects/progress-bar";
import { canOpenProjects, listProjectCards } from "@/modules/projects/service";
import { getMyDashboard } from "@/modules/tasks/dashboard";
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
  const showProjects = await canOpenProjects(user);
  const [stats, projects] = await Promise.all([
    getMyDashboard(user, today, timezone),
    showProjects ? listProjectCards(user, today, timezone) : Promise.resolve([]),
  ]);

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
          {showProjects && (
            <Button asChild size="sm" variant="outline" className="md:hidden">
              <Link href="/projects">{t("projects.open")}</Link>
            </Button>
          )}
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatRing
          value={stats.doneThisWeek}
          total={stats.weekPlan}
          color="var(--series-3)"
          caption={t("home.dashboard.doneWeek")}
        />
        <StatRing
          value={stats.inProgress}
          total={stats.open}
          color="var(--series-1)"
          caption={t("home.dashboard.inProgress")}
        />
        <StatRing
          value={stats.overdue}
          total={stats.open}
          color="var(--series-8)"
          caption={t("home.dashboard.overdue")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr] [&>*]:min-w-0">
        {projects.length > 0 && (
          <Card className="gap-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle>{t("home.dashboard.projects")}</CardTitle>
              <Link href="/projects" className="text-muted-foreground text-sm hover:underline">
                {t("home.dashboard.allProjects")} →
              </Link>
            </div>
            <ul className="flex flex-col gap-2.5">
              {projects.slice(0, 4).map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="hover:bg-accent/40 flex flex-col gap-1.5 rounded-lg border-l-4 py-1.5 pr-1 pl-3"
                    style={{ borderLeftColor: projectColor(project.color) }}
                  >
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{project.name}</span>
                      <HealthBadge health={project.stats.health} />
                    </span>
                    <ProgressBar
                      percent={project.stats.percent}
                      planned={project.stats.plannedPercent}
                      color={projectColor(project.color)}
                      className="h-2"
                    />
                    <span className="text-muted-foreground text-xs">
                      {project.stats.percent}% ·{" "}
                      {t("projects.tasksCount", {
                        done: project.stats.done,
                        total: project.stats.total,
                      })}
                      {project.next && ` · ◆ ${formatDay(project.next.date)} ${project.next.title}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card className="gap-2">
          <CardTitle>{t("home.dashboard.weekly")}</CardTitle>
          <CardDescription>{t("home.dashboard.weeklyHint")}</CardDescription>
          <WeekBars weeks={stats.weeks} />
        </Card>
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
