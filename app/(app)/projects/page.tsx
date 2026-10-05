import Link from "next/link";

import { HealthBadge } from "@/components/projects/health-badge";
import { ProgressBar } from "@/components/projects/progress-bar";
import { ProjectForm } from "@/components/projects/project-form";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { formatDay } from "@/lib/dates";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings, getUserToday } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { listProjectCards } from "@/modules/projects/service";
import { listAssignableUsers } from "@/modules/tasks/service";

import { createProjectAction } from "./actions";

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const user = await requireUser();
  const { error } = await searchParams;
  const [today, settings] = await Promise.all([getUserToday(user.id), getSettings(user.id)]);
  const [projects, users] = await Promise.all([
    listProjectCards(user, today, settings.timezone),
    user.role === "OWNER" ? listAssignableUsers() : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("projects.title")}</h1>
      {typeof error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`projects.errors.${error}` as TranslationKey)}
        </p>
      )}
      {projects.length === 0 && (
        <Card className="gap-1">
          <CardTitle>{t("projects.empty")}</CardTitle>
          <CardDescription>{t("projects.emptyHint")}</CardDescription>
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {projects.map((project) => (
          <Link
            key={project.id}
            href={`/projects/${project.id}`}
            className="bg-card hover:bg-accent/40 flex flex-col gap-3 rounded-xl border p-4 transition-colors"
          >
            <span className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">{project.name}</span>
                <span className="text-muted-foreground text-xs">
                  {[project.team, project.lead && t("projects.leadName", { name: project.lead })]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <HealthBadge health={project.stats.health} />
            </span>
            <span className="flex flex-col gap-1.5">
              <span className="flex justify-between text-sm">
                <b>{t("projects.progress", { percent: project.stats.percent })}</b>
                <span className="text-muted-foreground text-xs">
                  {t("projects.tasksCount", {
                    done: project.stats.done,
                    total: project.stats.total,
                  })}
                </span>
              </span>
              <ProgressBar
                percent={project.stats.percent}
                planned={project.stats.plannedPercent}
                late={project.stats.health === "late"}
              />
              <span className="text-muted-foreground text-xs">
                {t("projects.planned", { percent: project.stats.plannedPercent })}
              </span>
            </span>
            <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span>
                {t("projects.counts.inProgress")}: <b>{project.stats.inProgress}</b>
              </span>
              <span className={project.stats.overdue ? "text-destructive" : undefined}>
                {t("projects.counts.overdue")}: <b>{project.stats.overdue}</b>
              </span>
              {project.stats.atRisk > 0 && (
                <span className="text-amber-700 dark:text-amber-300">
                  {t("projects.counts.atRisk")}: <b>{project.stats.atRisk}</b>
                </span>
              )}
            </span>
            {project.next && (
              <span className="border-t pt-2 text-xs">
                <span className="text-muted-foreground">{t("projects.next")}: </span>
                <b>{project.next.title}</b> · {formatDay(project.next.date)} ·{" "}
                {project.next.daysLeft === 0
                  ? t("projects.today")
                  : project.next.daysLeft > 0
                    ? t("projects.inDays", { count: project.next.daysLeft })
                    : t("projects.lateDays", { count: -project.next.daysLeft })}
              </span>
            )}
          </Link>
        ))}
      </div>
      {user.role === "OWNER" && (
        <details className="bg-card rounded-xl border p-4">
          <summary className="cursor-pointer font-medium">{t("projects.new")}</summary>
          <div className="pt-3">
            <ProjectForm
              action={createProjectAction}
              users={users.map((u) => ({ id: u.id, name: displayName(u) }))}
              canChangeLead
              submit={t("projects.create")}
            />
          </div>
        </details>
      )}
    </div>
  );
}
