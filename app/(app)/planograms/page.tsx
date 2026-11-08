import { Plus } from "lucide-react";
import Link from "next/link";

import { PlanogramList } from "@/components/planograms/planogram-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManagePlanograms } from "@/modules/planograms/access";
import { planogramCards } from "@/modules/planograms/service";

export default async function PlanogramsPage({ searchParams }: PageProps<"/planograms">) {
  const user = await requireUser();
  const params = await searchParams;
  const all = params.show === "all";
  const project = typeof params.project === "string" ? params.project : "";
  const query = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  // One card per planogram: the version in force, with the versions in the works marked on it.
  const items = await planogramCards({ all, project: project || undefined, query });
  // Projects of planograms only: a template's project is not a filter.
  const projects = (
    await db.planogram.findMany({
      where: { project: { not: null }, isTemplate: false },
      distinct: ["project"],
      select: { project: true },
    })
  )
    .map((p) => p.project!)
    .sort();
  const href = (next: Record<string, string>) =>
    `/planograms?${new URLSearchParams({ ...(all ? { show: "all" } : {}), ...(project ? { project } : {}), ...(query ? { q: query } : {}), ...next })}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {canManagePlanograms(user.role) && (
          <Button asChild size="sm">
            <Link href="/planograms/new">
              <Plus />
              {t("planograms.newPlanogram")}
            </Link>
          </Button>
        )}
        <div className="flex rounded-md border p-0.5 text-sm">
          <Link
            href={href({ show: "" })}
            className={cn("rounded px-3 py-1", !all && "bg-secondary font-medium")}
          >
            {t("planograms.filterActive")}
          </Link>
          <Link
            href={href({ show: "all" })}
            className={cn("rounded px-3 py-1", all && "bg-secondary font-medium")}
          >
            {t("planograms.filterAll")}
          </Link>
        </div>
        {/* Search by title; the filters stay. */}
        <form action="/planograms" className="flex min-w-0 flex-1 basis-48 gap-2">
          {all && <input type="hidden" name="show" value="all" />}
          {project && <input type="hidden" name="project" value={project} />}
          <Input
            type="search"
            name="q"
            defaultValue={query}
            placeholder={t("planograms.list.search")}
            aria-label={t("planograms.list.search")}
            className="h-8"
          />
        </form>
      </div>
      {projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <Link
            href={href({ project: "" })}
            className={cn(
              "rounded-full border px-3 py-1",
              !project && "bg-primary text-primary-foreground",
            )}
          >
            {t("planograms.filterAll")}
          </Link>
          {projects.map((p) => (
            <Link
              key={p}
              href={href({ project: p })}
              className={cn(
                "rounded-full border px-3 py-1",
                project === p && "bg-primary text-primary-foreground",
              )}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
      {project && (
        <p className="text-sm">
          {t("planograms.export.batch")}:{" "}
          <a
            className="underline"
            href={`/api/planograms/export?${new URLSearchParams({ project, format: "pptx" })}`}
          >
            PPTX
          </a>{" "}
          ·{" "}
          <a
            className="underline"
            href={`/api/planograms/export?${new URLSearchParams({ project, format: "pdf" })}`}
          >
            PDF
          </a>
        </p>
      )}
      <PlanogramList items={items} />
    </div>
  );
}
