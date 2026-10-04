import { Plus } from "lucide-react";
import Link from "next/link";

import { PlanogramList } from "@/components/planograms/planogram-list";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManagePlanograms } from "@/modules/planograms/access";
import { listPlanograms } from "@/modules/planograms/service";

export default async function PlanogramsPage({ searchParams }: PageProps<"/planograms">) {
  const user = await requireUser();
  const params = await searchParams;
  const all = params.show === "all";
  const project = typeof params.project === "string" ? params.project : "";
  const items = await listPlanograms({
    status: all ? undefined : "active",
    project: project || undefined,
  });
  const projects = (
    await db.planogram.findMany({
      where: { project: { not: null } },
      distinct: ["project"],
      select: { project: true },
    })
  )
    .map((p) => p.project!)
    .sort();
  const href = (next: Record<string, string>) =>
    `/planograms?${new URLSearchParams({ ...(all ? { show: "all" } : {}), ...(project ? { project } : {}), ...next })}`;

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
      </div>
      {projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <Link
            href={`/planograms${all ? "?show=all" : ""}`}
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
