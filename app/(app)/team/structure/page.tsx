import Link from "next/link";

import { OrgChart, type PersonLoad } from "@/components/org/org-chart";
import { OrgNodeForm, OrgTree } from "@/components/org/org-tree";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { toDateString, todayInTimezone } from "@/lib/dates";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireModule } from "@/modules/core/access/guard";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { canEditOrg, getOrgTree, type OrgTreeNode } from "@/modules/org/service";

// Flat list of nodes for the "reports to" picker, indented by depth.
function flatten(nodes: OrgTreeNode[], depth = 0): { id: string; name: string }[] {
  return nodes.flatMap((n) => [
    {
      id: n.id,
      name: `${"— ".repeat(depth)}${n.kind === "UNIT" ? n.name : `${n.user?.name ?? n.personName ?? t("team.org.vacancy")}, ${n.title}`}`,
    },
    ...flatten(n.children, depth + 1),
  ]);
}

// Open team tasks per person (for the cards): owners and managers only, like the statistics.
async function loadByPerson(timezone: string) {
  const today = todayInTimezone(timezone);
  const open = await db.task.findMany({
    where: { isPersonal: false, status: { in: ["APPROVED", "IN_PROGRESS", "IN_REVIEW"] } },
    select: { assigneeId: true, dueDate: true },
  });
  const load = new Map<string, PersonLoad>();
  for (const task of open) {
    const entry = load.get(task.assigneeId) ?? { active: 0, overdue: 0 };
    entry.active += 1;
    if (task.dueDate && toDateString(task.dueDate) < today) entry.overdue += 1;
    load.set(task.assigneeId, entry);
  }
  return load;
}

export default async function StructurePage({ searchParams }: PageProps<"/team/structure">) {
  const user = await requireModule("structure");
  const { error, view: viewParam } = await searchParams;
  const view = viewParam === "list" ? "list" : "chart";
  const [tree, users, { timezone }] = await Promise.all([
    getOrgTree(),
    db.user.findMany({ orderBy: { firstName: "asc" } }),
    getSettings(user.id),
  ]);
  const editable = canEditOrg(user);
  const load =
    user.role === "OWNER" || user.role === "MANAGER" ? await loadByPerson(timezone) : undefined;
  const options = {
    people: users.map((u) => ({ id: u.id, name: displayName(u) })),
    nodes: flatten(tree),
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("team.org.title")}</h1>
        <div className="flex gap-1">
          <Button asChild size="sm" variant={view === "chart" ? "default" : "outline"}>
            <Link href="/team/structure">{t("team.org.viewChart")}</Link>
          </Button>
          <Button asChild size="sm" variant={view === "list" ? "default" : "outline"}>
            <Link href="/team/structure?view=list">{t("team.org.viewList")}</Link>
          </Button>
        </div>
      </div>
      {typeof error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`team.org.errors.${error}` as TranslationKey)}
        </p>
      )}
      <Card className="min-w-0 overflow-hidden">
        {tree.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {editable ? t("team.org.emptyOwner") : t("team.org.empty")}
          </p>
        ) : view === "chart" ? (
          <OrgChart roots={tree} load={load} />
        ) : (
          <OrgTree nodes={tree} editable={editable} options={options} />
        )}
      </Card>
      {editable && view === "chart" && tree.length > 0 && (
        <p className="text-muted-foreground -mt-2 text-xs">
          <Link href="/team/structure?view=list" className="underline">
            {t("team.org.editInList")}
          </Link>
        </p>
      )}
      {editable && (view === "list" || tree.length === 0) && (
        <details className="rounded-xl border p-4" open={tree.length === 0}>
          <summary className="cursor-pointer font-medium">{t("team.org.addRoot")}</summary>
          <OrgNodeForm parentId={null} options={options} />
        </details>
      )}
    </div>
  );
}
