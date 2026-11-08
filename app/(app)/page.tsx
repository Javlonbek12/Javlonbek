import {
  AlertCircle,
  BarChart3,
  CalendarCheck2,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  FolderKanban,
  ListTodo,
  Play,
  Plus,
  Square,
  Users,
} from "lucide-react";
import Link from "next/link";

import { SectionTitle } from "@/components/dashboard/cards";
import { TimerCard } from "@/components/dashboard/timer-card";
import { WeekBars } from "@/components/dashboard/week-bars";
import { MeetingLine } from "@/components/meetings/meeting-line";
import { HealthBadge } from "@/components/projects/health-badge";
import { projectColor } from "@/components/projects/project-rows";
import { ProgressBar } from "@/components/projects/progress-bar";
import { QuickCircle } from "@/components/tasks/quick-circle";
import { TaskPanel } from "@/components/tasks/task-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { addDays, daysBetween, formatDay, formatDayLong } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { utcToZonedLocal, zonedLocalToUtc } from "@/lib/time";
import { cn } from "@/lib/utils";
import { canUseModule } from "@/modules/core/access/actor";
import { DENIED_PARAM } from "@/modules/core/access/guard";
import { requireUser } from "@/modules/core/auth/current-user";
import { MODULES } from "@/modules/core/registry";
import { getSettings, getUserToday } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { listOtherApprovals, type OtherApproval } from "@/modules/home/approvals";
import { getMyDay, getTeamToday, type DayTask, type TeamRow } from "@/modules/home/today";
import { listMeetingsBetween, type MeetingRow } from "@/modules/meetings/service";
import { canOpenProjects, listProjectCards } from "@/modules/projects/service";
import { withParams } from "@/modules/tasks/back";
import { getMyDashboard } from "@/modules/tasks/dashboard";
import { quickTarget } from "@/modules/tasks/quick";
import { getRunningTimer } from "@/modules/tasks/time";
import { listDecisions, type TaskView } from "@/modules/tasks/service";

import { decideFromHomeAction } from "./home-actions";
import { startTimerAction, stopTimerAction } from "./tasks/actions";

const DECISIONS_SHOWN = 5;
const PROJECTS_SHOWN = 4;

// A task opens in the same panel as in the task list (?task=…), not on a page of its own.
const panelHref = (taskId: string) => withParams("/", { task: taskId });

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
  const important = task.priority === "HIGH" || task.priority === "URGENT";
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
      <Link href={panelHref(task.id)} scroll={false} className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1.5">
          {/* Importance is an icon, not red: red means overdue. */}
          {important && (
            <AlertCircle
              className="size-4 shrink-0 text-orange-500"
              aria-label={t(`tasks.priority.${task.priority}`)}
            />
          )}
          <span className="truncate text-sm font-semibold hover:underline">{task.title}</span>
        </span>
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
              ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
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
  kind: "approve" | "accept" | "remove" | "dueChange" | "coAssignee";
  task: { id: string; title: string };
  detail: string;
}) {
  const label = {
    approve: t("home.today.approveTask"),
    accept: t("home.today.acceptWork"),
    remove: t("home.today.removeRequest"),
    dueChange: t("tasks.dueChange.request"),
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

// A planogram or a post waiting for the viewer: decided on its own page, by its section's rules.
function OtherDecisionRow({ item }: { item: OtherApproval }) {
  const label =
    item.kind === "planogram"
      ? t("home.today.approvePlanogram")
      : item.legal
        ? t("home.today.legalPost")
        : t("home.today.reviewPost");
  return (
    <li className="flex items-center gap-3 rounded-xl border p-3">
      {item.image && (
        // The planogram's own picture (its PNG export), small.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image}
          alt=""
          loading="lazy"
          className="bg-muted size-12 shrink-0 rounded-lg border object-contain"
        />
      )}
      <Link href={item.href} className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-muted-foreground text-xs">
          {label}
          {item.from && ` · ${t("home.today.from", { name: item.from })}`}
        </span>
        <span className="truncate text-sm font-semibold hover:underline">{item.title}</span>
      </Link>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <Link href={item.href}>{t("home.today.open")}</Link>
      </Button>
    </li>
  );
}

function SimpleRow({ task, note }: { task: TaskView; note: string }) {
  return (
    <li>
      <Link
        href={panelHref(task.id)}
        scroll={false}
        className="hover:bg-accent flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm"
      >
        <span className="truncate">{task.title}</span>
        <span className="text-muted-foreground shrink-0 text-xs">{note}</span>
      </Link>
    </li>
  );
}

// «Встречи · сегодня и завтра»: each with its status and buttons. On a phone it stands right
// under «Мой день», on a computer at the top of the right column (the page draws it in both
// places and shows one).
function MeetingsBlock({
  meetings,
  timezone,
  today,
  now,
  className,
}: {
  meetings: MeetingRow[];
  timezone: string;
  today: string;
  now: Date;
  className?: string;
}) {
  if (meetings.length === 0) return null;
  const days = [today, addDays(today, 1)]
    .map((day) => ({
      day,
      list: meetings.filter((m) => utcToZonedLocal(m.startsAt, timezone).startsWith(day)),
    }))
    .filter((group) => group.list.length > 0);
  return (
    <section className={cn("flex-col gap-2.5", className)}>
      <SectionTitle
        icon={CalendarCheck2}
        color="var(--series-7)"
        title={t("home.today.meetings")}
        count={meetings.length}
      />
      {days.map((group) => (
        <div key={group.day} className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs font-medium">
            {group.day === today ? t("meetings.day.today") : t("meetings.day.tomorrow")}
          </span>
          <ul className="flex flex-col gap-2">
            {group.list.map((m) => (
              <MeetingLine key={m.id} meeting={m} timezone={timezone} now={now} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

// A number of «Моя команда»: a link to those tasks; a zero is a quiet dash.
function TeamCell({ value, href, danger }: { value: number; href: string; danger?: boolean }) {
  if (value === 0)
    return (
      <td className="text-muted-foreground px-1 py-2 text-center" aria-label="0">
        —
      </td>
    );
  return (
    <td className="px-1 py-2 text-center">
      <Link
        href={href}
        className={cn(
          "inline-block min-w-7 rounded-md px-1.5 py-0.5 font-semibold hover:underline",
          danger ? "text-destructive bg-destructive/10" : "hover:bg-accent",
        )}
      >
        {value}
      </Link>
    </td>
  );
}

function TeamTable({ rows }: { rows: TeamRow[] }) {
  const tasks = (row: TeamRow, more: Record<string, string>) =>
    `/tasks?${new URLSearchParams({ scope: "team", person: row.id, ...more })}`;
  const columns = [
    ["teamToday", "teamTodayShort"],
    ["teamLate", "teamLateShort"],
    ["teamHandedIn", "teamHandedInShort"],
    ["teamWaiting", "teamWaitingShort"],
  ] as const;
  return (
    <table className="w-full table-fixed text-sm tabular-nums">
      <thead>
        <tr className="text-muted-foreground text-[11px] leading-tight">
          <th className="w-[38%] px-1 pb-1 text-left font-medium" />
          {columns.map(([full, short]) => (
            <th
              key={full}
              className="px-1 pb-1 text-center font-medium"
              title={t(`home.today.${full}`)}
            >
              <span className="sm:hidden lg:inline xl:hidden">{t(`home.today.${short}`)}</span>
              <span className="hidden sm:inline lg:hidden xl:inline">
                {t(`home.today.${full}`)}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-t">
            <td className="truncate px-1 py-2">
              <Link href={tasks(row, {})} className="font-medium hover:underline">
                {row.name}
              </Link>
            </td>
            <TeamCell value={row.dueToday} href={tasks(row, { due: "today" })} />
            <TeamCell value={row.overdue} href={tasks(row, { due: "overdue" })} danger />
            <TeamCell value={row.handedIn} href="/tasks/decide" />
            <TeamCell value={row.notStarted} href={tasks(row, { status: "APPROVED" })} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// «Сегодня»: what to do right now, in this order — the running timer, decisions waiting for me,
// my day, meetings today and tomorrow, the next days; then my team (for whoever oversees one), the
// week in numbers and projects.
export default async function TodayPage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const params = await searchParams;
  const denied = params[DENIED_PARAM];
  const deniedModule = MODULES.find((m) => m.id === denied);
  const openId = typeof params.task === "string" ? params.task : null;
  const showMeetings = canUseModule(user, "meetings");
  const today = await getUserToday(user.id);
  const { timezone } = await getSettings(user.id);
  const showProjects = await canOpenProjects(user);
  const now = new Date();
  const [myDay, decisions, others, meetings, stats, team, timer, projects] = await Promise.all([
    getMyDay(user, today),
    listDecisions(user),
    listOtherApprovals(user),
    showMeetings
      ? listMeetingsBetween(
          user,
          zonedLocalToUtc(`${today}T00:00`, timezone)!,
          zonedLocalToUtc(`${addDays(today, 2)}T00:00`, timezone)!,
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
    ...decisions.dueChange.map((task) => ({
      key: `s${task.id}`,
      kind: "dueChange" as const,
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
  const totalDecisions = decisionRows.length + others.length;
  const shownOthers = others.slice(0, Math.max(0, DECISIONS_SHOWN - decisionRows.length));

  const weeks = stats.weeks.slice(-5);
  const meetingsProps = { meetings, timezone, today, now };

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
          {totalDecisions > 0 && (
            <section className="flex flex-col gap-2.5">
              <SectionTitle
                icon={ClipboardCheck}
                color="var(--series-1)"
                title={t("home.today.decisions")}
                count={totalDecisions}
              />
              <ul className="flex flex-col gap-2">
                {decisionRows.slice(0, DECISIONS_SHOWN).map((row) => (
                  <DecisionRow key={row.key} kind={row.kind} task={row.task} detail={row.detail} />
                ))}
                {shownOthers.map((item) => (
                  <OtherDecisionRow key={`${item.kind}${item.id}`} item={item} />
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

          <MeetingsBlock {...meetingsProps} className="flex lg:hidden" />

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
          <MeetingsBlock {...meetingsProps} className="hidden lg:flex" />

          {team && (
            <Card className="gap-3">
              <SectionTitle
                icon={Users}
                color="var(--series-4)"
                title={t("home.today.team")}
                right={
                  <span className="flex items-center gap-1">
                    <InfoHint>{t("home.today.teamHint")}</InfoHint>
                    <Link
                      href="/tasks?scope=team"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={t("home.today.teamAll")}
                    >
                      <ChevronRight className="size-5" />
                    </Link>
                  </span>
                }
              />
              {team.rows.length > 0 && <TeamTable rows={team.rows} />}
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

          {/* The week in one line: no rings, no «+100%» against an empty week. */}
          <Card className="gap-2">
            <SectionTitle
              icon={BarChart3}
              color="var(--series-3)"
              title={t("home.today.numbers")}
            />
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              <Link href="/tasks?due=week" className="font-medium hover:underline">
                {t("home.today.weekDone", { done: stats.doneThisWeek, plan: stats.weekPlan })}
              </Link>
              <Link href="/tasks?status=IN_PROGRESS" className="hover:underline">
                {t("home.today.weekInWork", { count: stats.inProgress })}
              </Link>
              <Link
                href="/tasks?due=overdue"
                className={cn("hover:underline", stats.overdue > 0 && "text-destructive")}
              >
                {t("home.today.weekLate", { count: stats.overdue })}
              </Link>
            </p>
            <p className="text-muted-foreground text-xs">
              {t("home.today.weekBefore", { count: stats.doneSameDaysLastWeek })}
            </p>
            <details>
              <summary className="text-primary cursor-pointer text-sm font-medium">
                {t("home.today.chart")}
              </summary>
              <div className="mt-3 flex flex-col gap-2">
                <CardDescription className="text-xs">
                  {t("home.dashboard.weeklyHint")}
                </CardDescription>
                <WeekBars weeks={weeks} />
              </div>
            </details>
          </Card>

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

      {openId && (
        <TaskPanel
          user={user}
          taskId={openId}
          base={panelHref(openId)}
          closeHref="/"
          params={params}
        />
      )}
    </div>
  );
}
