import {
  AlertTriangle,
  BarChart3,
  CalendarCheck2,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FolderKanban,
  ListTodo,
  Play,
  Plus,
  Square,
  Target,
  Users,
} from "lucide-react";
import Link from "next/link";

import { SectionTitle, StatCard } from "@/components/dashboard/cards";
import { TimerCard } from "@/components/dashboard/timer-card";
import { WeekBars } from "@/components/dashboard/week-bars";
import { MeetingChip } from "@/components/meetings/meeting-chip";
import { HealthBadge } from "@/components/projects/health-badge";
import { projectColor } from "@/components/projects/portfolio";
import { ProgressBar } from "@/components/projects/progress-bar";
import { QuickCircle } from "@/components/tasks/quick-circle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription } from "@/components/ui/card";
import { addDays, daysBetween, formatDay, formatDayLong } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { zonedLocalToUtc } from "@/lib/time";
import { cn } from "@/lib/utils";
import { canUseModule } from "@/modules/core/access/actor";
import { DENIED_PARAM } from "@/modules/core/access/guard";
import { requireUser } from "@/modules/core/auth/current-user";
import { MODULES } from "@/modules/core/registry";
import { getSettings, getUserToday } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { getMyDay, getTeamToday, type DayTask } from "@/modules/home/today";
import { listMeetingsBetween } from "@/modules/meetings/service";
import { canOpenProjects, listProjectCards } from "@/modules/projects/service";
import { getMyDashboard } from "@/modules/tasks/dashboard";
import { quickTarget } from "@/modules/tasks/quick";
import { getRunningTimer } from "@/modules/tasks/time";
import { listDecisions, type TaskView } from "@/modules/tasks/service";

import { decideFromHomeAction } from "./home-actions";
import { startTimerAction, stopTimerAction } from "./tasks/actions";

const DECISIONS_SHOWN = 5;
const PROJECTS_SHOWN = 4;

// One row of «Мой день»: close/hand in, title, when it is due, and the timer.
function DayRow({
  task,
  today,
  closeTarget,
  timerRunning,
}: {
  task: DayTask;
  today: string;
  closeTarget: "DONE" | "IN_REVIEW" | null;
  timerRunning: boolean;
}) {
  const when =
    task.when === "overdue"
      ? t("home.today.overdueDays", { days: daysBetween(task.dueDate!, today) })
      : task.when === "today"
        ? t("home.today.dueToday")
        : task.dueDate
          ? t("home.dashboard.due", { date: formatDay(task.dueDate) })
          : t("home.today.inProgress");
  return (
    <li
      className={cn(
        "bg-card flex items-center gap-3 rounded-xl border p-3",
        task.when === "overdue" && "border-l-destructive border-l-4",
      )}
    >
      <QuickCircle
        taskId={task.id}
        status={task.status}
        target={closeTarget}
        accepts={false}
        blocked={task.openBlockers > 0}
        back="/"
      />
      <Link href={`/tasks/${task.id}`} className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-semibold hover:underline">{task.title}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          <span
            className={cn(
              task.when === "overdue" ? "text-destructive font-medium" : "text-muted-foreground",
            )}
          >
            {when}
          </span>
          {task.isPersonal && <Badge variant="outline">{t("tasks.fields.personalShort")}</Badge>}
          {task.project && <Badge variant="secondary">{task.project}</Badge>}
        </span>
      </Link>
      <form action={timerRunning ? stopTimerAction : startTimerAction} className="shrink-0">
        <input type="hidden" name="taskId" value={task.id} />
        <input type="hidden" name="back" value="/" />
        <button
          type="submit"
          title={timerRunning ? t("home.today.stopTimer") : t("home.today.startTimer")}
          aria-label={timerRunning ? t("home.today.stopTimer") : t("home.today.startTimer")}
          className={cn(
            "flex size-9 items-center justify-center rounded-full border",
            timerRunning
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {timerRunning ? (
            <Square className="size-3.5 fill-current" />
          ) : (
            <Play className="size-4" />
          )}
        </button>
      </form>
    </li>
  );
}

// A row in «Ждут вашего решения»: what is asked, the task, and the one-click answer when
// there is one (approving and accepting need no reason; the rest open the decision panel).
function DecisionRow({
  kind,
  task,
  detail,
}: {
  kind: "approve" | "accept" | "remove" | "coAssignee";
  task: { id: string; title: string };
  detail: string;
}) {
  const label = {
    approve: t("home.today.approveTask"),
    accept: t("home.today.acceptWork"),
    remove: t("home.today.removeRequest"),
    coAssignee: detail,
  }[kind];
  const quick = kind === "approve" ? "APPROVED" : kind === "accept" ? "DONE" : null;
  return (
    <li className="flex items-center gap-3 rounded-xl border p-3">
      <Link
        href={`/tasks/decide?task=${encodeURIComponent(task.id)}`}
        className="flex min-w-0 flex-1 flex-col gap-0.5"
      >
        <span className="text-muted-foreground text-xs">
          {label}
          {kind !== "coAssignee" && detail && ` · ${detail}`}
        </span>
        <span className="truncate text-sm font-semibold hover:underline">{task.title}</span>
      </Link>
      {quick ? (
        <form action={decideFromHomeAction} className="shrink-0">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="to" value={quick} />
          <Button type="submit" size="sm">
            {quick === "APPROVED" ? t("home.today.approve") : t("home.today.accept")}
          </Button>
        </form>
      ) : (
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link href={`/tasks/decide?task=${encodeURIComponent(task.id)}`}>
            {t("home.today.open")}
          </Link>
        </Button>
      )}
    </li>
  );
}

function SimpleRow({ task, note }: { task: TaskView; note: string }) {
  return (
    <li>
      <Link
        href={`/tasks/${task.id}`}
        className="hover:bg-accent flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm"
      >
        <span className="truncate">{task.title}</span>
        <span className="text-muted-foreground shrink-0 text-xs">{note}</span>
      </Link>
    </li>
  );
}

// «Сегодня»: what to do right now, in this order — the running timer, decisions waiting for me,
// my day, today's meetings, the next days; then my team (for whoever oversees one), the week in
// numbers and projects.
export default async function TodayPage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const denied = (await searchParams)[DENIED_PARAM];
  const deniedModule = MODULES.find((m) => m.id === denied);
  const showMeetings = canUseModule(user, "meetings");
  const today = await getUserToday(user.id);
  const { timezone } = await getSettings(user.id);
  const showProjects = await canOpenProjects(user);
  const [myDay, decisions, meetings, stats, team, timer, projects] = await Promise.all([
    getMyDay(user, today),
    listDecisions(user),
    showMeetings
      ? listMeetingsBetween(
          user,
          zonedLocalToUtc(`${today}T00:00`, timezone)!,
          zonedLocalToUtc(`${addDays(today, 1)}T00:00`, timezone)!,
          true,
        )
      : Promise.resolve([]),
    getMyDashboard(user, today, timezone),
    getTeamToday(user, today),
    getRunningTimer(user.id),
    showProjects ? listProjectCards(user, today, timezone) : Promise.resolve([]),
  ]);
  const botUsername = getEnv().TELEGRAM_BOT_USERNAME;

  const decisionRows = [
    ...decisions.approve.map((task) => ({
      key: `a${task.id}`,
      kind: "approve" as const,
      task,
      detail: t("home.today.from", { name: displayName(task.creator) }),
    })),
    ...decisions.accept.map((task) => ({
      key: `r${task.id}`,
      kind: "accept" as const,
      task,
      detail: t("home.today.from", { name: displayName(task.assignee) }),
    })),
    ...decisions.remove.map((task) => ({
      key: `d${task.id}`,
      kind: "remove" as const,
      task,
      detail: "",
    })),
    ...decisions.coAssignees
      .filter((request) => request.task.visible)
      .map((request) => ({
        key: `c${request.id}`,
        kind: "coAssignee" as const,
        task: request.task,
        detail: t("home.today.coAssignee", { name: request.name }),
      })),
  ];

  const thisWeek = stats.doneThisWeek;
  const before = stats.doneSameDaysLastWeek;
  const trend = before ? Math.round(((thisWeek - before) / before) * 100) : thisWeek ? 100 : 0;
  const weeks = stats.weeks.slice(-5);

  return (
    <div className="flex flex-col gap-5 md:gap-6 [&>*]:min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] md:text-[32px]">
            {t("home.greeting", { name: user.firstName })}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{formatDayLong(today)}</p>
        </div>
        <Button
          asChild
          className="h-10 shrink-0 rounded-xl shadow-[0_8px_18px_-8px_var(--primary)]"
        >
          {/* On a phone only «+» shows: the label still names it for screen readers. */}
          <Link href="/tasks/new" aria-label={t("home.today.newTask")}>
            <Plus />
            <span className="hidden sm:inline">{t("home.today.newTask")}</span>
          </Link>
        </Button>
      </div>

      {deniedModule && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t("home.denied", { section: t(deniedModule.titleKey) })}
        </p>
      )}

      {timer && <TimerCard timer={timer} />}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-5 [&>*]:min-w-0">
          {decisionRows.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <SectionTitle
                icon={ClipboardCheck}
                color="var(--series-1)"
                title={t("home.today.decisions")}
                count={decisionRows.length}
              />
              <ul className="flex flex-col gap-2">
                {decisionRows.slice(0, DECISIONS_SHOWN).map((row) => (
                  <DecisionRow key={row.key} kind={row.kind} task={row.task} detail={row.detail} />
                ))}
              </ul>
              {decisionRows.length > DECISIONS_SHOWN && (
                <Link
                  href="/tasks/decide"
                  className="text-primary self-start text-sm font-medium hover:underline"
                >
                  {t("home.today.allDecisions", { count: decisionRows.length })} →
                </Link>
              )}
            </section>
          )}

          <section className="flex flex-col gap-2.5">
            <SectionTitle
              icon={ListTodo}
              color="var(--series-5)"
              title={t("home.today.myDay")}
              count={myDay.day.length}
              right={
                <Link
                  href="/tasks"
                  className="text-primary text-sm font-medium whitespace-nowrap hover:underline"
                >
                  {t("home.today.allMine")} →
                </Link>
              }
            />
            {myDay.day.length === 0 ? (
              <Card className="gap-1 p-4">
                <p className="text-sm font-medium">{t("home.today.dayEmpty")}</p>
                <CardDescription className="text-xs">
                  {t("home.today.dayEmptyHint")}
                </CardDescription>
              </Card>
            ) : (
              <ul className="flex flex-col gap-2">
                {myDay.day.map((task) => (
                  <DayRow
                    key={task.id}
                    task={task}
                    today={today}
                    closeTarget={quickTarget(user, task)}
                    timerRunning={timer?.taskId === task.id}
                  />
                ))}
              </ul>
            )}
            {myDay.handedIn > 0 && (
              <p className="text-muted-foreground text-xs">
                {t("home.today.handedIn", { count: myDay.handedIn })}
              </p>
            )}
          </section>

          {meetings.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <SectionTitle
                icon={CalendarCheck2}
                color="var(--series-7)"
                title={t("home.dashboard.meetingsToday")}
                count={meetings.length}
              />
              {meetings.map((m) => (
                <MeetingChip key={m.id} meeting={m} timezone={timezone} />
              ))}
            </section>
          )}

          {myDay.upcoming.length > 0 && (
            <Card className="gap-2">
              <SectionTitle
                icon={CalendarDays}
                color="var(--series-1)"
                title={t("home.today.upcoming")}
                count={myDay.upcoming.length}
              />
              <ul className="flex flex-col gap-0.5">
                {myDay.upcoming.map((task) => (
                  <SimpleRow
                    key={task.id}
                    task={task}
                    note={
                      task.dueDate === addDays(today, 1)
                        ? t("home.today.tomorrow")
                        : t("home.today.dayAfter")
                    }
                  />
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5 [&>*]:min-w-0">
          {team && (
            <Card className="gap-3">
              <SectionTitle
                icon={Users}
                color="var(--series-4)"
                title={t("home.today.team")}
                right={
                  <Link
                    href="/tasks?scope=team"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t("home.today.teamAll")}
                  >
                    <ChevronRight className="size-5" />
                  </Link>
                }
              />
              <CardDescription className="-mt-1 text-xs">
                {t("home.today.teamHint")}
              </CardDescription>
              {team.rows.length > 0 && (
                <ul className="flex flex-col">
                  {team.rows.map((row) => (
                    <li key={row.id} className="border-b last:border-b-0">
                      <Link
                        href={`/tasks?scope=team&person=${encodeURIComponent(row.id)}`}
                        className="hover:bg-accent flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-lg px-1.5 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate font-medium">{row.name}</span>
                        <span className="text-muted-foreground flex gap-3 text-xs tabular-nums">
                          <span>
                            {row.inProgress} {t("home.today.teamInProgress")}
                          </span>
                          <span className={cn(row.overdue > 0 && "text-destructive font-medium")}>
                            {row.overdue} {t("home.today.teamOverdue")}
                          </span>
                          {row.inReview > 0 && (
                            <span>
                              {row.inReview} {t("home.today.teamInReview")}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {(team.more > 0 || team.idle > 0) && (
                <p className="text-muted-foreground text-xs">
                  {[
                    team.more > 0 && t("home.today.teamMore", { count: team.more }),
                    team.idle > 0 && t("home.today.teamIdle", { count: team.idle }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </Card>
          )}

          <section className="flex flex-col gap-2.5">
            <SectionTitle
              icon={BarChart3}
              color="var(--series-3)"
              title={t("home.today.numbers")}
            />
            <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-1">
              <StatCard
                tone="green"
                icon={Target}
                label={t("home.dashboard.doneWeek")}
                value={stats.doneThisWeek}
                total={stats.weekPlan}
                note={
                  trend > 0
                    ? `↗ ${t("home.dashboard.trendUp", { n: trend })}`
                    : trend < 0
                      ? `↘ ${t("home.dashboard.trendDown", { n: -trend })}`
                      : t("home.dashboard.trendSame")
                }
                noteTone={trend > 0 ? "up" : trend < 0 ? "down" : undefined}
              />
              <StatCard
                tone="blue"
                icon={Clock3}
                label={t("home.dashboard.inProgress")}
                value={stats.inProgress}
                total={stats.open}
                note={t("home.dashboard.inProgressNote")}
              />
              <StatCard
                tone="red"
                icon={AlertTriangle}
                label={t("home.dashboard.overdue")}
                value={stats.overdue}
                total={stats.open}
                note={
                  stats.overdue ? t("home.dashboard.overdueNote") : t("home.dashboard.overdueNone")
                }
                noteTone={stats.overdue ? "down" : "up"}
              />
            </div>
            <details className="bg-card rounded-2xl border px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium">
                {t("home.today.chart")}
              </summary>
              <div className="mt-3 flex flex-col gap-2">
                <CardDescription className="text-xs">
                  {t("home.dashboard.weeklyHint")}
                </CardDescription>
                <WeekBars weeks={weeks} />
              </div>
            </details>
          </section>

          {projects.length > 0 && (
            <Card className="gap-3">
              <SectionTitle
                icon={FolderKanban}
                title={t("home.today.projects")}
                right={
                  <Link
                    href="/projects"
                    className="text-primary text-sm font-medium whitespace-nowrap hover:underline"
                  >
                    {t("home.dashboard.allProjects")} →
                  </Link>
                }
              />
              <ul className="flex flex-col gap-2">
                {projects.slice(0, PROJECTS_SHOWN).map((project) => {
                  const color = projectColor(project.color);
                  return (
                    <li key={project.id}>
                      <Link
                        href={`/projects/${project.id}`}
                        className="hover:bg-accent/50 flex flex-col gap-1.5 rounded-xl p-1.5"
                      >
                        <span className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate font-semibold">{project.name}</span>
                          <HealthBadge health={project.stats.health} />
                        </span>
                        <ProgressBar
                          percent={project.stats.percent}
                          planned={project.stats.plannedPercent}
                          color={color}
                          className="h-2"
                        />
                        <span className="text-muted-foreground line-clamp-1 text-xs">
                          {project.stats.percent}%
                          {project.next &&
                            ` · ${formatDay(project.next.date)} ${project.next.title}`}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {!user.botChatId && (
        <p className="text-muted-foreground text-sm">
          {t("home.botNotLinked")}{" "}
          {botUsername && (
            <a className="text-primary underline" href={`https://t.me/${botUsername}?start`}>
              {t("home.openBot")} @{botUsername}
            </a>
          )}
        </p>
      )}
    </div>
  );
}
