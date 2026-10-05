import Link from "next/link";
import { notFound } from "next/navigation";

import { Ring } from "@/components/dashboard/ring";
import { BurnUpChart } from "@/components/projects/burnup-chart";
import { Gantt } from "@/components/projects/gantt";
import { HealthBadge } from "@/components/projects/health-badge";
import { LaunchPlan } from "@/components/projects/launch-plan";
import { PlanEditor } from "@/components/projects/plan-editor";
import { Milestones } from "@/components/projects/milestones";
import { projectColor } from "@/components/projects/portfolio";
import { ProgressBar } from "@/components/projects/progress-bar";
import { ProjectForm } from "@/components/projects/project-form";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { formatDay, toDateString } from "@/lib/dates";
import { t, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings, getUserToday } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import {
  attention,
  burnUp,
  byResponsible,
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

import { updateProjectAction } from "../actions";

const STATE_STYLES: Record<PhaseState, string> = {
  done: "text-emerald-700 dark:text-emerald-300",
  late: "text-destructive",
  active: "text-blue-700 dark:text-blue-300",
  upcoming: "text-muted-foreground",
  empty: "text-muted-foreground",
};

function TaskLine({ task }: { task: ProjectTask }) {
  return (
    <li className="flex flex-col border-t py-1.5 first:border-t-0">
      <Link href={`/tasks/${task.id}`} className="hover:underline">
        {task.code && <span className="text-muted-foreground">{task.code} · </span>}
        {task.title}
      </Link>
      <span className="text-muted-foreground text-xs">
        {[task.dueDate && formatDay(task.dueDate), task.responsible ?? task.assigneeName]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </li>
  );
}

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { error, tab: tabParam, saved, shifted } = await searchParams;
  const [today, settings] = await Promise.all([getUserToday(user.id), getSettings(user.id)]);
  const data = await getProject(user, id, settings.timezone);
  if (!data) notFound();
  const { project, phases, tasks, canManage } = data;
  const users = canManage ? await listAssignableUsers() : [];

  const stats = projectStats(tasks, today);
  const range = projectRange(tasks);
  const phaseRows = phaseProgress(phases, tasks, today);
  const keyDates = milestones(tasks, today);
  const chart = burnUp(tasks, today);
  const watch = attention(tasks, today);
  const people = byResponsible(tasks, today);
  const template = templateByKey(project.template);
  const tabs = [
    "overview",
    ...(template?.sections.length ? ["plan"] : []),
    ...(canManage ? ["setup"] : []),
  ] as ("overview" | "plan" | "setup")[];
  const tab = tabs.find((x) => x === tabParam) ?? "overview";
  const groups = [
    ["overdue", watch.overdue],
    ["atRisk", watch.atRisk],
    ["blocked", watch.blocked],
    ["dueSoon", watch.dueSoon],
  ] as const;

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
          <span
            className="size-3.5 rounded-full"
            style={{ background: projectColor(project.color) }}
            aria-hidden
          />
          <h1 className="text-[22px] font-medium md:text-2xl">{project.name}</h1>
          <HealthBadge health={stats.health} />
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

      {tabs.length > 1 && (
        <nav className="bg-secondary/70 inline-flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-full p-1 text-sm">
          {tabs.map((key) => (
            <Link
              key={key}
              href={`/projects/${project.id}${key === "overview" ? "" : `?tab=${key}`}`}
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
          saved={saved === "1"}
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
            <dl className="grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
              {(
                [
                  ["done", stats.done, "text-emerald-700 dark:text-emerald-300"],
                  ["inProgress", stats.inProgress, "text-blue-700 dark:text-blue-300"],
                  ["notStarted", stats.notStarted, ""],
                  ["overdue", stats.overdue, stats.overdue ? "text-destructive" : ""],
                  [
                    "atRisk",
                    stats.atRisk,
                    stats.atRisk ? "text-amber-700 dark:text-amber-300" : "",
                  ],
                ] as const
              ).map(([key, value, color]) => (
                <div key={key} className="bg-muted/50 rounded-lg px-1 py-2">
                  <dd className={cn("font-display text-xl font-semibold", color)}>{value}</dd>
                  <dt className="text-muted-foreground text-xs">{t(`projects.counts.${key}`)}</dt>
                </div>
              ))}
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
                        <span className="text-muted-foreground text-xs">
                          {t("projects.attention.more", { count: list.length - 5 })}
                        </span>
                      )}
                    </div>
                  ),
              )}
            </Card>
            <Card className="gap-2">
              <CardTitle>{t("projects.burnup.title")}</CardTitle>
              <CardDescription>{t("projects.burnup.hint")}</CardDescription>
              <BurnUpChart weeks={chart.weeks} total={chart.total} today={today} />
            </Card>
          </div>

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

          <Card className="gap-3">
            <CardTitle>{t("projects.people.title")}</CardTitle>
            <CardDescription>{t("projects.people.hint")}</CardDescription>
            <ul className="flex flex-col gap-2.5 text-sm">
              {people.map((person) => (
                <li
                  key={person.name}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"
                >
                  <span className="truncate">{person.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {t("projects.people.done", { done: person.done, total: person.total })}
                    {person.overdue > 0 && (
                      <span className="text-destructive">
                        {" · "}
                        {t("projects.people.overdue", { count: person.overdue })}
                      </span>
                    )}
                  </span>
                  <ProgressBar
                    percent={Math.round((person.done / person.total) * 100)}
                    late={person.overdue > 0}
                    className="col-span-2 h-1.5"
                  />
                </li>
              ))}
            </ul>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link
                href={`/tasks?${new URLSearchParams({ project: project.name, scope: "team" })}`}
              >
                {t("projects.allTasks")}
              </Link>
            </Button>
          </div>

          {canManage && (
            <details className="bg-card rounded-xl border p-4">
              <summary className="cursor-pointer font-medium">{t("projects.edit")}</summary>
              <div className="pt-3">
                <ProjectForm
                  action={updateProjectAction}
                  projectId={project.id}
                  values={project}
                  users={users.map((u) => ({ id: u.id, name: displayName(u) }))}
                  canChangeLead={user.role === "OWNER"}
                  submit={t("projects.save")}
                />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
