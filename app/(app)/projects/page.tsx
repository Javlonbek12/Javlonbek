import { StatRing } from "@/components/dashboard/ring";
import { Portfolio } from "@/components/projects/portfolio";
import { ProjectForm } from "@/components/projects/project-form";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings, getUserToday } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { listProjectCards } from "@/modules/projects/service";
import { TEMPLATES } from "@/modules/projects/templates";
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
  const sum = (pick: (p: (typeof projects)[number]) => number) =>
    projects.reduce((total, p) => total + pick(p), 0);
  const total = sum((p) => p.stats.total);

  return (
    <div className="flex flex-col gap-4 [&>*]:min-w-0">
      <h1 className="text-[22px] font-medium md:text-2xl">{t("projects.title")}</h1>
      {typeof error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`projects.errors.${error}` as TranslationKey)}
        </p>
      )}
      {projects.length === 0 ? (
        <Card className="gap-1">
          <CardTitle>{t("projects.empty")}</CardTitle>
          <CardDescription>{t("projects.emptyHint")}</CardDescription>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatRing
              value={projects.filter((p) => p.stats.health !== "done").length}
              total={projects.length}
              color="var(--series-7)"
              caption={t("projects.summary.projects")}
            />
            <StatRing
              value={sum((p) => p.stats.done)}
              total={total}
              color="var(--series-3)"
              caption={t("projects.summary.done")}
            />
            <StatRing
              value={sum((p) => p.stats.inProgress)}
              total={total}
              color="var(--series-1)"
              caption={t("projects.summary.inProgress")}
            />
            <StatRing
              value={sum((p) => p.problems.reduce((n, row) => n + row.count, 0))}
              total={total}
              color="var(--series-8)"
              caption={t("projects.summary.problems")}
            />
          </div>
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">{t("projects.board.title")}</h2>
            <Portfolio cards={projects} />
          </section>
        </>
      )}
      {user.role === "OWNER" && (
        <details className="bg-card rounded-xl border p-4">
          <summary className="cursor-pointer font-medium">{t("projects.new")}</summary>
          <div className="pt-3">
            <ProjectForm
              action={createProjectAction}
              users={users.map((u) => ({ id: u.id, name: displayName(u) }))}
              canChangeLead
              submit={t("projects.create")}
              templates={TEMPLATES}
            />
          </div>
        </details>
      )}
    </div>
  );
}
