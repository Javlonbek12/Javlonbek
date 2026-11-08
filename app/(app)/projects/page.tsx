import { Plus } from "lucide-react";
import Link from "next/link";

import { ProjectForm } from "@/components/projects/project-form";
import { ProjectRows } from "@/components/projects/project-rows";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings, getUserToday } from "@/modules/core/settings/service";
import { listProjectCards } from "@/modules/projects/service";
import { TEMPLATES, templateRoles } from "@/modules/projects/templates";
import { distinctNames } from "@/modules/tasks/names";
import { listAssignableUsers } from "@/modules/tasks/service";

import { createProjectAction } from "./actions";

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const user = await requireUser();
  const { error, show, create } = await searchParams;
  // In work by default; finished projects under their own filter.
  const finished = show === "finished";
  const canCreate = user.role === "OWNER";
  const creating = canCreate && create === "1";
  const [today, settings] = await Promise.all([getUserToday(user.id), getSettings(user.id)]);
  const [projects, users] = await Promise.all([
    listProjectCards(user, today, settings.timezone, { finished }),
    creating ? listAssignableUsers() : Promise.resolve([]),
  ]);
  const names = distinctNames(users);
  const sum = (pick: (p: (typeof projects)[number]) => number) =>
    projects.reduce((total, p) => total + pick(p), 0);

  return (
    <div className="flex flex-col gap-4 [&>*]:min-w-0">
      <PageHeader
        title={t("projects.title")}
        actions={
          <>
            <Segmented
              label={t("projects.title")}
              items={[false, true].map((value) => ({
                key: String(value),
                label: t(value ? "projects.filterFinished" : "projects.filterActive"),
                href: value ? "/projects?show=finished" : "/projects",
                active: value === finished,
              }))}
            />
            {canCreate && (
              <Button asChild size="sm">
                <Link href={creating ? "/projects" : "/projects?create=1"} aria-expanded={creating}>
                  <Plus />
                  {t("projects.new")}
                </Link>
              </Button>
            )}
          </>
        }
      />
      {typeof error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`projects.errors.${error}` as TranslationKey)}
        </p>
      )}
      {creating && (
        <Card className="gap-3">
          <CardTitle>{t("projects.new")}</CardTitle>
          <ProjectForm
            action={createProjectAction}
            users={users.map((u) => ({ id: u.id, name: names.get(u.id)! }))}
            canChangeLead
            submit={t("projects.create")}
            templates={TEMPLATES}
            roles={Object.fromEntries(TEMPLATES.map((tpl) => [tpl.key, templateRoles(tpl)]))}
          />
        </Card>
      )}
      {projects.length === 0 ? (
        <Card className="gap-1">
          <CardTitle>{t(finished ? "projects.noneFinished" : "projects.empty")}</CardTitle>
          {!finished && <CardDescription>{t("projects.emptyHint")}</CardDescription>}
        </Card>
      ) : (
        <>
          {/* One line instead of four tiles: the whole picture in words. */}
          <p className="text-muted-foreground text-sm">
            {t("projects.rows.summary", {
              projects: projects.length,
              done: sum((p) => p.stats.done),
              total: sum((p) => p.stats.total),
              inWork: sum((p) => p.stats.inProgress),
            })}
            {sum((p) => p.stats.overdue) > 0 && (
              <span className="text-destructive">
                {" · "}
                {t("projects.rows.summaryOverdue", { count: sum((p) => p.stats.overdue) })}
              </span>
            )}
          </p>
          <ProjectRows cards={projects} />
        </>
      )}
    </div>
  );
}
