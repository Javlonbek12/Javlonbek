import { Plus } from "lucide-react";
import Link from "next/link";

import { PlanogramList } from "@/components/planograms/planogram-list";
import { AutoSubmitForm } from "@/components/ui/auto-submit-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManagePlanograms } from "@/modules/planograms/access";
import {
  planogramCards,
  planogramsAwaitingApproval,
  type PlanogramCard,
} from "@/modules/planograms/service";

const FILTERS = ["all", "draft", "pending", "approved", "archived"] as const;
type Filter = (typeof FILTERS)[number];

// Which filter a planogram falls under: its version in force, or a version in the works.
const matches = (card: PlanogramCard, filter: Filter) => {
  const statuses = [card.status, ...card.working.map((w) => w.status)];
  if (filter === "all") return card.status !== "ARCHIVED";
  if (filter === "draft") return statuses.includes("DRAFT");
  if (filter === "pending") return statuses.includes("PENDING_APPROVAL");
  if (filter === "approved") return card.status === "APPROVED";
  return card.status === "ARCHIVED";
};

export default async function PlanogramsPage({ searchParams }: PageProps<"/planograms">) {
  const user = await requireUser();
  const params = await searchParams;
  const param = (key: string) => (typeof params[key] === "string" ? String(params[key]) : "");
  const filter: Filter = (FILTERS as readonly string[]).includes(param("status"))
    ? (param("status") as Filter)
    : "all";
  const project = param("project");
  const equipmentId = param("equipment");
  const query = param("q").slice(0, 100);
  // One card per planogram: the version in force, with the versions in the works marked on it.
  const [cards, waiting] = await Promise.all([
    planogramCards({ all: true, project: project || undefined, query }),
    planogramsAwaitingApproval(user),
  ]);
  const byEquipment = equipmentId ? cards.filter((c) => c.equipment.id === equipmentId) : cards;
  const items = byEquipment.filter((c) => matches(c, filter));
  const count = (f: Filter) => byEquipment.filter((c) => matches(c, f)).length;
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
  const equipment = [
    ...new Map(cards.map((c) => [c.equipment.id, c.equipment.name] as const)),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const href = (next: { status?: Filter; project?: string }) => {
    const status = next.status ?? filter;
    const p = next.project ?? project;
    return `/planograms?${new URLSearchParams({
      ...(status !== "all" ? { status } : {}),
      ...(p ? { project: p } : {}),
      ...(equipmentId ? { equipment: equipmentId } : {}),
      ...(query ? { q: query } : {}),
    })}`;
  };

  return (
    <div className="flex flex-col gap-3">
      {waiting.length > 0 && filter !== "pending" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/60 bg-amber-500/5 px-3 py-2 text-sm">
          <span className="font-medium">
            {t("planograms.list.waiting", { count: waiting.length })}
          </span>
          <Link className="text-primary underline" href={href({ status: "pending" })}>
            {t("planograms.list.showWaiting")}
          </Link>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canManagePlanograms(user.role) && (
          <Button asChild size="sm">
            <Link href="/planograms/new">
              <Plus />
              {t("planograms.newPlanogram")}
            </Link>
          </Button>
        )}
        {/* Search by title as you type, the equipment at once; the other filters stay. */}
        <AutoSubmitForm
          action="/planograms"
          className="flex min-w-0 flex-1 basis-48 flex-wrap gap-2"
        >
          {filter !== "all" && <input type="hidden" name="status" value={filter} />}
          {project && <input type="hidden" name="project" value={project} />}
          <Input
            type="search"
            name="q"
            defaultValue={query}
            placeholder={t("planograms.list.search")}
            aria-label={t("planograms.list.search")}
            className="h-8 min-w-0 flex-1 basis-56"
          />
          {equipment.length > 1 && (
            <NativeSelect
              name="equipment"
              defaultValue={equipmentId}
              aria-label={t("planograms.fields.equipment")}
              className="h-8 max-w-full"
            >
              <option value="">{t("planograms.list.allEquipment")}</option>
              {equipment.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          )}
        </AutoSubmitForm>
      </div>
      <nav className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex w-max gap-1 text-sm">
          {FILTERS.map((f) => (
            <li key={f}>
              <Link
                href={href({ status: f })}
                aria-current={filter === f ? "true" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 whitespace-nowrap",
                  filter === f && "bg-secondary font-medium",
                )}
              >
                {t(`planograms.list.filters.${f}`)}
                <span className="text-muted-foreground tabular-nums">{count(f)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <Link
            href={href({ project: "" })}
            className={cn(
              "rounded-full border px-3 py-1",
              !project && "bg-primary text-primary-foreground",
            )}
          >
            {t("planograms.list.allProjects")}
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
      {items.length === 0 && cards.length > 0 ? (
        <p className="text-muted-foreground text-sm">{t("planograms.list.none")}</p>
      ) : (
        <PlanogramList items={items} />
      )}
    </div>
  );
}
