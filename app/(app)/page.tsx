import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  Clock3,
  FileText,
  FolderKanban,
  Lightbulb,
  ListTodo,
  Plus,
  Target,
} from "lucide-react";
import Link from "next/link";

import { SectionTitle, StatCard } from "@/components/dashboard/cards";
import { QuerySelect } from "@/components/dashboard/query-select";
import { WeekBars } from "@/components/dashboard/week-bars";
import { MeetingChip } from "@/components/meetings/meeting-chip";
import { HealthBadge } from "@/components/projects/health-badge";
import { projectColor } from "@/components/projects/portfolio";
import { ProgressBar } from "@/components/projects/progress-bar";
import { StatusBadge } from "@/components/tasks/task-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { addDays, formatDay, formatDayLong } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { zonedLocalToUtc } from "@/lib/time";
import { cn } from "@/lib/utils";
import { canUseModule } from "@/modules/core/access/actor";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings, getUserToday } from "@/modules/core/settings/service";
import { listMeetingsBetween } from "@/modules/meetings/service";
import { canOpenProjects, listProjectCards } from "@/modules/projects/service";
import { canSeeReports } from "@/modules/reports/access";
import { getMyDashboard } from "@/modules/tasks/dashboard";
import { getTodayOverview, type TaskView } from "@/modules/tasks/service";

const OVERDUE_SHOWN = 6;
const WEEK_RANGES = ["5", "10"] as const;

// One task in a compact row: title, badges, due date and "Open".
function TaskLine({ task, overdue }: { task: TaskView; overdue?: boolean }) {
  return (
    <li
      className={cn(
        "bg-card shadow-card flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:gap-4 sm:py-2.5",
        overdue && "border-l-destructive border-l-4",
      )}
    >
      <Link
        href={`/tasks/${task.id}`}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1"
      >
        <span className="truncate text-sm font-semibold hover:underline">{task.title}</span>
        <StatusBadge status={task.status} />
        {task.isPersonal && <Badge variant="outline">{t("tasks.fields.personalShort")}</Badge>}
        {task.project && <Badge variant="secondary">{task.project}</Badge>}
      </Link>
      {task.dueDate && (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-xs",
            overdue ? "text-destructive font-medium" : "text-muted-foreground",
          )}
        >
          <CalendarDays className="size-4" />
          {t("home.dashboard.due", { date: formatDay(task.dueDate) })}
          {overdue && ` · ${t("home.dashboard.overdueTag")}`}
        </span>
      )}
      <Link
        href={`/tasks/${task.id}`}
        className="text-primary bg-secondary/70 hover:bg-secondary hidden shrink-0 items-center gap-0.5 rounded-lg px-3 py-1.5 text-xs font-semibold sm:flex"
      >
        {t("home.dashboard.open")}
        <ChevronRight className="size-3.5" />
      </Link>
    </li>
  );
}

// A small card with a short list (or an empty note) and a link to the full list.
function ShortList({
  icon,
  color,
  title,
  hint,
  tasks,
  empty,
  href,
}: {
  icon: typeof Bookmark;
  color: string;
  title: string;
  hint?: string;
  tasks: TaskView[];
  empty: string;
  href: string;
}) {
  return (
    <Card className="gap-3">
      <SectionTitle
        icon={icon}
        color={color}
        title={title}
        count={tasks.length}
        right={
          <Link href={href} className="text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-5" />
          </Link>
        }
      />
      {hint && <CardDescription className="-mt-1 text-xs">{hint}</CardDescription>}
      {tasks.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {tasks.slice(0, 3).map((task) => (
            <li key={task.id}>
              <Link
                href={`/tasks/${task.id}`}
                className="hover:bg-accent flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm"
              >
                <span className="truncate">{task.title}</span>
                <StatusBadge status={task.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// The "Today" screen: the week in numbers, projects, overdue tasks, today's and waiting tasks.
export default async function TodayPage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const params = await searchParams;
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  const today = await getUserToday(user.id);
  const { timezone } = await getSettings(user.id);
  const showProjects = await canOpenProjects(user);
  const [{ dueToday, overdue, waiting }, meetings, stats, projects] = await Promise.all([
    getTodayOverview(user, today),
    listMeetingsBetween(
      user,
      zonedLocalToUtc(`${today}T00:00`, timezone)!,
      zonedLocalToUtc(`${addDays(today, 1)}T00:00`, timezone)!,
      true,
    ),
    getMyDashboard(user, today, timezone),
    showProjects ? listProjectCards(user, today, timezone) : Promise.resolve([]),
  ]);
  const botUsername = getEnv().TELEGRAM_BOT_USERNAME;

  // Overdue tasks with the type filter and the due-date order from the address.
  const type = one("type") === "team" || one("type") === "personal" ? one("type")! : "all";
  const order = one("sort") === "desc" ? "desc" : "asc";
  const overdueShown = overdue
    .filter((task) => type === "all" || task.isPersonal === (type === "personal"))
    .sort((a, b) => {
      const byDue = (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
      return order === "asc" ? byDue : -byDue;
    });

  const range = WEEK_RANGES.find((r) => r === one("weeks")) ?? "5";
  const weeks = stats.weeks.slice(-Number(range));
  const thisWeek = stats.weeks.at(-1)?.count ?? 0;
  const lastWeek = stats.weeks.at(-2)?.count ?? 0;
  const trend = lastWeek
    ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
    : thisWeek
      ? 100
      : 0;

  const actions = [
    showProjects && {
      href: "/projects",
      icon: FolderKanban,
      color: "var(--series-1)",
      label: t("home.dashboard.createProject"),
    },
    canUseModule(user, "meetings") && {
      href: "/meetings/new",
      icon: CalendarClock,
      color: "var(--series-7)",
      label: t("home.dashboard.planMeeting"),
    },
    canSeeReports(user) && {
      href: "/reports",
      icon: BarChart3,
      color: "var(--series-3)",
      label: t("home.dashboard.makeReport"),
    },
    {
      href: "/tasks/new",
      icon: Plus,
      color: "var(--series-2)",
      label: t("tasks.newTask"),
    },
  ].filter((a): a is Exclude<typeof a, false> => Boolean(a));

  return (
    <div className="flex flex-col gap-5 md:gap-6 [&>*]:min-w-0">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2.5 text-[24px] md:text-[32px]">
            <span aria-hidden>👋</span>
            {t("home.greeting", { name: user.firstName })}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {formatDayLong(today)} · {t("home.dashboard.tagline")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          {showProjects && (
            <Button asChild size="sm" variant="outline" className="md:hidden">
              <Link href="/projects">{t("projects.open")}</Link>
            </Button>
          )}
          {canUseModule(user, "content") && (
            <Button asChild size="sm" variant="outline" className="md:hidden">
              <Link href="/content">{t("content.open")}</Link>
            </Button>
          )}
          {canUseModule(user, "connect") && (
            <Button asChild size="sm" variant="outline" className="md:hidden">
              <Link href="/connect">{t("connect.open")}</Link>
            </Button>
          )}
          {canUseModule(user, "distribution") && (
            <Button asChild size="sm" variant="outline" className="md:hidden">
              <Link href="/distribution/campaigns">{t("dist.title")}</Link>
            </Button>
          )}
          {canUseModule(user, "distribution") && (
            <Button asChild size="sm" variant="outline" className="md:hidden">
              <Link href="/equipment">{t("equip.title")}</Link>
            </Button>
          )}
          {canSeeReports(user) && (
            <Button asChild variant="outline" className="bg-card h-10 rounded-xl">
              <Link href="/reports">
                <FileText className="text-primary" />
                {t("reports.open")}
              </Link>
            </Button>
          )}
          <Button asChild className="h-10 rounded-xl shadow-[0_8px_18px_-8px_var(--primary)]">
            <Link href="/tasks/new">
              <Plus />
              {t("tasks.newTask")}
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3 md:gap-4">
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
          note={stats.overdue ? t("home.dashboard.overdueNote") : t("home.dashboard.overdueNone")}
          noteTone={stats.overdue ? "down" : "up"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr] [&>*]:min-w-0">
        {projects.length > 0 && (
          <Card className="gap-4">
            <SectionTitle
              icon={FolderKanban}
              title={t("home.dashboard.projects")}
              right={
                <Link href="/projects" className="text-primary text-sm font-medium hover:underline">
                  {t("home.dashboard.allProjects")} →
                </Link>
              }
            />
            <ul className="flex flex-col gap-3">
              {projects.slice(0, 4).map((project) => {
                const color = projectColor(project.color);
                return (
                  <li key={project.id}>
                    <Link
                      href={`/projects/${project.id}`}
                      className="hover:bg-accent/50 flex items-start gap-3 rounded-xl p-1.5"
                    >
                      <span
                        className="flex size-11 shrink-0 items-center justify-center rounded-xl text-base font-bold"
                        style={{
                          background: `color-mix(in oklch, ${color} 14%, transparent)`,
                          color,
                        }}
                      >
                        {project.name.trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
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
                        <span className="text-muted-foreground line-clamp-2 text-xs">
                          {project.stats.percent}% ·{" "}
                          {t("projects.tasksCount", {
                            done: project.stats.done,
                            total: project.stats.total,
                          })}
                          {project.next &&
                            ` · ${formatDay(project.next.date)} ${project.next.title}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        <Card className="gap-2">
          <SectionTitle
            icon={BarChart3}
            title={t("home.dashboard.weekly")}
            right={
              <QuerySelect
                name="weeks"
                value={range}
                label={t("home.dashboard.weekly")}
                options={WEEK_RANGES.map((n) => ({
                  value: n,
                  label: t("home.dashboard.weeksRange", { n }),
                }))}
              />
            }
          />
          <CardDescription>{t("home.dashboard.weeklyHint")}</CardDescription>
          <WeekBars weeks={weeks} />
        </Card>
      </div>

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

      {overdue.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle
            icon={ListTodo}
            color="var(--destructive)"
            title={t("today.overdue")}
            count={overdue.length}
            countTone="danger"
            right={
              <div className="flex flex-wrap gap-2">
                <QuerySelect
                  name="type"
                  value={type}
                  label={t("home.dashboard.typeAll")}
                  options={[
                    { value: "all", label: t("home.dashboard.typeAll") },
                    { value: "team", label: t("home.dashboard.typeTeam") },
                    { value: "personal", label: t("home.dashboard.typePersonal") },
                  ]}
                />
                <QuerySelect
                  name="sort"
                  value={order}
                  label={t("home.dashboard.sortDueAsc")}
                  options={[
                    { value: "asc", label: t("home.dashboard.sortDueAsc") },
                    { value: "desc", label: t("home.dashboard.sortDueDesc") },
                  ]}
                />
              </div>
            }
          />
          <ul className="flex flex-col gap-2">
            {overdueShown.slice(0, OVERDUE_SHOWN).map((task) => (
              <TaskLine key={task.id} task={task} overdue />
            ))}
          </ul>
          {overdueShown.length > OVERDUE_SHOWN && (
            <Link
              href="/tasks?due=overdue"
              className="text-primary self-start text-sm font-medium hover:underline"
            >
              {t("home.dashboard.showAll", { count: overdueShown.length })} →
            </Link>
          )}
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
        <ShortList
          icon={Bookmark}
          color="var(--series-5)"
          title={t("today.dueToday")}
          tasks={dueToday}
          empty={t("home.dashboard.todayEmpty")}
          href="/tasks?due=today"
        />
        <ShortList
          icon={CalendarDays}
          color="var(--series-1)"
          title={t("today.waiting")}
          hint={t("today.waitingHint")}
          tasks={waiting}
          empty={t("home.dashboard.waitingEmpty")}
          href="/tasks/decide"
        />
        <Card className="gap-3 md:col-span-2 xl:col-span-1">
          <SectionTitle
            icon={Lightbulb}
            color="var(--series-4)"
            title={t("home.dashboard.actions")}
          />
          <CardDescription className="-mt-1 text-xs">
            {t("home.dashboard.actionsHint")}
          </CardDescription>
          <div className="grid grid-cols-3 gap-2">
            {actions.slice(0, 3).map(({ href, icon: Icon, color, label }) => (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-center gap-2 rounded-xl border px-1.5 py-3 text-center text-xs leading-tight font-medium transition-colors hover:brightness-95"
                style={{ background: `color-mix(in oklch, ${color} 8%, var(--card))` }}
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white"
                  style={{ background: color }}
                >
                  <Icon className="size-[18px]" />
                </span>
                {label}
              </Link>
            ))}
          </div>
        </Card>
      </div>

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
