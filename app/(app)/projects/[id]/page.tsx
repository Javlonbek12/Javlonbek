import { Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Ring } from "@/components/dashboard/ring";
import { BurnUpChart } from "@/components/projects/burnup-chart";
import { Gantt } from "@/components/projects/gantt";
import { HealthBadge } from "@/components/projects/health-badge";
import { LaunchPlan } from "@/components/projects/launch-plan";
import { PlanEditor } from "@/components/projects/plan-editor";
import { Milestones } from "@/components/projects/milestones";
import { projectColor } from "@/components/projects/project-rows";
import { ProgressBar } from "@/components/projects/progress-bar";
import { ProjectForm } from "@/components/projects/project-form";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { formatDay, todayInTimezone, toDateString } from "@/lib/dates";
import { t, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings, getUserToday } from "@/modules/core/settings/service";
import { personName } from "@/modules/core/users/display-name";
import {
  attention,
  burnUp,
  byPerson,
  milestones,
  phaseProgress,
  projectRange,
  projectStats,
  type PhaseState,
  type ProjectTask,
} from "@/modules/projects/progress";
import { getProject } from "@/modules/projects/service";
import { templateByKey } from "@/modules/projects/templates";
import { listAssignableUsers } from "@/modules/tasks/service";

import { finishProjectAction, updateProjectAction } from "../actions";

const STATE_STYLES: Record<PhaseState, string> = {
  done: "text-emerald-700 dark:text-emerald-300",
  late: "text-destructive",
  active: "text-blue-700 dark:text-blue-300",
  upcoming: "text-muted-foreground",
  empty: "text-muted-foreground",
};

// A task in «Требует внимания»: its due date and who does it (the person, not the template role).
function TaskLine({ task }: { task: ProjectTask }) {
  return (
    <li className="flex flex-col border-t py-1.5 first:border-t-0">
      <Link href={`/tasks/${task.id}`} className="hover:underline">
        {task.code && <span className="text-muted-foreground">{task.code} · </span>}
        {task.title}
      </Link>
      <span className="text-muted-foreground text-xs">
        {[task.dueDate && formatDay(task.dueDate), task.assigneeName].filter(Boolean).join(" · ")}
      </span>
    </li>
  );
}

const TABS = ["overview", "timing", "plan", "setup"] as const;
type Tab = (typeof TABS)[number];

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { error, tab: tabParam, shifted, edit } = await searchParams;
  const [today, settings] = await Promise.all([getUserToday(user.id), getSettings(user.id)]);
  const data = await getProject(user, id, settings.timezone);
  if (!data) notFound();
  const { project, phases, tasks, canManage } = data;
  // The lead stays in the list even if deactivated, so saving the form keeps them.
  const users = canManage ? await listAssignableUsers([project.leadId]) : [];

  const stats = projectStats(tasks, today);
  const range = projectRange(tasks);
  const phaseRows = phaseProgress(phases, tasks, today);
  const keyDates = milestones(tasks, today);
  const chart = burnUp(tasks, today);
  const watch = attention(tasks, today);
  const people = byPerson(tasks, today);
  const template = templateByKey(project.template);
  const tabs = TABS.filter(
    (key) =>
      (key !== "plan" || Boolean(template?.sections.length)) && (key !== "setup" || canManage),
  );
  const tab: Tab = tabs.find((x) => x === tabParam) ?? "overview";
  const editing = canManage && edit === "1";
  const base = `/projects/${project.id}`;
  const groups = [
    ["overdue", watch.overdue],
    ["atRisk", watch.atRisk],
    ["blocked", watch.blocked],
    ["dueSoon", watch.dueSoon],
  ] as const;
  const tasksHref = (more: Record<string, string> = {}) =>
    `/tasks?${new URLSearchParams({ project: project.name, scope: "team", ...more })}`;

  return (
    <div className="flex flex-col gap-4 [&>*]:min-w-0">
      {typeof error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`projects.errors.${error}` as TranslationKey)}
        </p>
      )}
      <div className="flex flex-col gap-1">
        <Link href="/projects" className="text-muted-foreground text-sm hover:underline">
          ← {t("projects.title")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {/* The dot stays on the title's line, also on a phone. */}
          <h1 className="flex min-w-0 items-center gap-2 text-[22px] font-medium md:text-2xl">
            <span
              className="size-3.5 shrink-0 rounded-full"
              style={{ background: projectColor(project.color) }}
              aria-hidden
            />
            <span className="min-w-0 break-words">{project.name}</span>
          </h1>
          {project.finishedAt ? (
            <span className="bg-secondary rounded-full px-2.5 py-0.5 text-xs font-medium">
              {t("projects.finishedOn", {
                date: formatDay(todayInTimezone(settings.timezone, project.finishedAt)),
              })}
            </span>
          ) : (
            <HealthBadge health={stats.health} />
          )}
          {canManage && (
            <div className="ml-auto flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={editing ? base : `${base}?edit=1`} aria-expanded={editing}>
                  <Pencil />
                  {t("projects.edit")}
                </Link>
              </Button>
              <form action={finishProjectAction}>
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="finished" value={project.finishedAt ? "" : "1"} />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  title={project.finishedAt ? undefined : t("projects.finishHint")}
                >
                  {t(project.finishedAt ? "projects.reopen" : "projects.finish")}
                </Button>
              </form>
            </div>
          )}
        </div>
        <p className="text-muted-foreground text-sm">
          {[
            project.team,
            data.lead && t("projects.leadName", { name: data.lead }),
            range && `${formatDay(range.from)} – ${formatDay(range.to)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {project.description && (
          <p className="text-sm whitespace-pre-wrap">{project.description}</p>
        )}
      </div>

      {editing && (
        <Card className="gap-3">
          <CardTitle>{t("projects.edit")}</CardTitle>
          <ProjectForm
            action={updateProjectAction}
            projectId={project.id}
            values={project}
            users={users.map((u) => ({ id: u.id, name: personName(u) }))}
            canChangeLead={user.role === "OWNER"}
            submit={t("projects.save")}
          />
        </Card>
      )}

      {tabs.length > 1 && (
        <nav className="bg-secondary/70 inline-flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-full p-1 text-sm">
          {tabs.map((key) => (
            <Link
              key={key}
              href={key === "overview" ? base : `${base}?tab=${key}`}
              aria-current={key === tab ? "page" : undefined}
              className={cn(
                "rounded-full px-3.5 py-1.5 whitespace-nowrap transition-colors",
                key === tab
                  ? "bg-card text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`projects.tabs.${key}`)}
            </Link>
          ))}
        </nav>
      )}
      {typeof shifted === "string" && (
        <p className="text-sm text-emerald-700 dark:text-emerald-300">
          {t("projects.setup.shifted", { days: shifted })}
        </p>
      )}

      {tab === "plan" && template && (
        <LaunchPlan
          projectId={project.id}
          sections={template.sections}
          values={(project.planSections ?? {}) as Record<string, string>}
          canEdit={canManage}
        />
      )}

      {tab === "setup" && (
        <PlanEditor
          projectId={project.id}
          anchor={
            project.anchorDate && template?.anchor
              ? { label: template.anchor, date: toDateString(project.anchorDate) }
              : null
          }
          phases={phases}
          tasks={tasks}
          people={users.map((u) => ({ id: u.id, name: personName(u) }))}
        />
      )}

      {tab === "overview" && (
        <>
          <Card className="gap-4">
            <div className="flex items-center gap-4">
              <Ring percent={stats.percent} color={projectColor(project.color)} size={104} />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="text-muted-foreground text-sm">
                  {t("projects.tasksCount", { done: stats.done, total: stats.total })}
                </span>
                <ProgressBar
                  percent={stats.percent}
                  planned={stats.plannedPercent}
                  late={stats.health === "late"}
                  className="h-3"
                />
                <span className="text-muted-foreground text-xs">
                  {t("projects.planned", { percent: stats.plannedPercent })}
                </span>
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
              {(
                [
                  [
                    "done",
                    stats.done,
                    "text-emerald-700 dark:text-emerald-300",
                    { status: "DONE" },
                  ],
                  [
                    "inProgress",
                    stats.inProgress,
                    "text-blue-700 dark:text-blue-300",
                    { status: "IN_PROGRESS" },
                  ],
                  ["inReview", stats.inReview, "", { status: "IN_REVIEW" }],
                  ["notStarted", stats.notStarted, "", { status: "APPROVED" }],
                  [
                    "overdue",
                    stats.overdue,
                    stats.overdue ? "text-destructive" : "",
                    { due: "overdue" },
                  ],
                  [
                    "atRisk",
                    stats.atRisk,
                    stats.atRisk ? "text-amber-700 dark:text-amber-300" : "",
                    null,
                  ],
                ] as const
              ).map(([key, value, color, filter]) => {
                const body = (
                  <>
                    <dd className={cn("font-display text-xl font-semibold", color)}>{value}</dd>
                    <dt className="text-muted-foreground text-xs">{t(`projects.counts.${key}`)}</dt>
                  </>
                );
                // Each number opens those tasks in the list.
                const href = filter && value > 0 ? tasksHref(filter) : null;
                return href ? (
                  <Link
                    key={key}
                    href={href}
                    className="bg-muted/50 hover:bg-muted rounded-lg px-1 py-2"
                  >
                    {body}
                  </Link>
                ) : (
                  <div key={key} className="bg-muted/50 rounded-lg px-1 py-2">
                    {body}
                  </div>
                );
              })}
            </dl>
          </Card>

          {keyDates.list.length > 0 && (
            <Card className="gap-3">
              <CardTitle>{t("projects.milestones")}</CardTitle>
              <Milestones list={keyDates.list} today={today} />
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
            <Card className="gap-2">
              <CardTitle>{t("projects.attention.title")}</CardTitle>
              {groups.every(([, list]) => list.length === 0) && (
                <p className="text-muted-foreground text-sm">{t("projects.attention.none")}</p>
              )}
              {groups.map(
                ([key, list]) =>
                  list.length > 0 && (
                    <div key={key} className="flex flex-col text-sm">
                      <span
                        className={cn(
                          "text-xs font-medium",
                          key === "overdue" && "text-destructive",
                          key === "atRisk" && "text-amber-700 dark:text-amber-300",
                          (key === "dueSoon" || key === "blocked") && "text-muted-foreground",
                        )}
                      >
                        {t(`projects.attention.${key}`)} · {list.length}
                      </span>
                      <ul>
                        {list.slice(0, 5).map((task) => (
                          <TaskLine key={task.id} task={task} />
                        ))}
                      </ul>
                      {list.length > 5 && (
                        <Link
                          href={`${base}?tab=timing`}
                          className="text-muted-foreground text-xs hover:underline"
                        >
                          {t("projects.attention.more", { count: list.length - 5 })}
                        </Link>
                      )}
                    </div>
                  ),
              )}
            </Card>

            <Card className="gap-2">
              <CardTitle className="flex items-center gap-1.5">
                {t("projects.people.title")}
                <InfoHint>{t("projects.people.hint")}</InfoHint>
              </CardTitle>
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-muted-foreground text-left text-[11px]">
                      <th className="px-1 py-1 font-medium">{t("projects.people.person")}</th>
                      <th className="px-1 py-1 text-right font-medium">
                        {t("projects.people.total")}
                      </th>
                      <th className="px-1 py-1 text-right font-medium">
                        {t("projects.people.doneCol")}
                      </th>
                      <th className="px-1 py-1 text-right font-medium">
                        {t("projects.people.inWork")}
                      </th>
                      <th className="px-1 py-1 text-right font-medium">
                        {t("projects.people.overdueCol")}
                      </th>
                      <th className="hidden px-1 py-1 text-right font-medium sm:table-cell">
                        {t("projects.people.nextDue")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((person) => (
                      <tr key={person.id} className="border-t">
                        <td className="max-w-0 px-1 py-1.5">
                          <Link
                            href={tasksHref({ person: person.id })}
                            className="block truncate font-medium hover:underline"
                          >
                            {person.name}
                          </Link>
                          {person.nextDue && (
                            <span className="text-muted-foreground text-xs sm:hidden">
                              {formatDay(person.nextDue)}
                            </span>
                          )}
                        </td>
                        <td className="px-1 py-1.5 text-right">{person.total}</td>
                        <td className="px-1 py-1.5 text-right">
                          {person.done || <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-1 py-1.5 text-right">
                          {person.inWork || <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-1 py-1.5 text-right">
                          {person.overdue ? (
                            <Link
                              href={tasksHref({ person: person.id, due: "overdue" })}
                              className="text-destructive font-semibold hover:underline"
                            >
                              {person.overdue}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="text-muted-foreground hidden px-1 py-1.5 text-right sm:table-cell">
                          {person.nextDue ? formatDay(person.nextDue) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={tasksHref()}>{t("projects.allTasks")}</Link>
            </Button>
          </div>
        </>
      )}

      {tab === "timing" && (
        <>
          <Card className="gap-2">
            <CardTitle>{t("projects.burnup.title")}</CardTitle>
            <CardDescription>{t("projects.burnup.hint")}</CardDescription>
            <BurnUpChart weeks={chart.weeks} total={chart.total} today={today} />
          </Card>

          <Card className="gap-3">
            <CardTitle>{t("projects.phases.title")}</CardTitle>
            <ul className="flex flex-col gap-3">
              {phaseRows.map((phase) => (
                <li key={phase.id ?? "none"} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-medium">
                      {phase.title ?? t("projects.phases.noPhase")}
                    </span>
                    <span className="text-xs">
                      <span className={cn("font-medium", STATE_STYLES[phase.state])}>
                        {t(`projects.phases.state.${phase.state}`)}
                      </span>
                      {phase.dueDate && (
                        <span className="text-muted-foreground">
                          {" · "}
                          {t("projects.phases.due", { date: formatDay(phase.dueDate) })}
                        </span>
                      )}
                    </span>
                  </div>
                  <ProgressBar percent={phase.percent} late={phase.state === "late"} />
                  <span className="text-muted-foreground text-xs">
                    {t("projects.tasksCount", { done: phase.done, total: phase.total })}
                    {phase.overdue > 0 && (
                      <span className="text-destructive">
                        {" · "}
                        {t("projects.phases.overdue", { count: phase.overdue })}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          {range && (
            <Card className="gap-3">
              <CardTitle>{t("projects.gantt.title")}</CardTitle>
              <CardDescription>{t("projects.gantt.hint")}</CardDescription>
              <Gantt phases={phaseRows} tasks={tasks} range={range} today={today} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
