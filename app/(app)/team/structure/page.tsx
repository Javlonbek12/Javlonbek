import { FileSpreadsheet } from "lucide-react";
import Link from "next/link";

import { ChartViewport } from "@/components/org/chart-viewport";
import { OrgChart, type PersonLoad } from "@/components/org/org-chart";
import { OrgPhoneList } from "@/components/org/org-phone-list";
import { OrgNodeForm, OrgTree } from "@/components/org/org-tree";
import { inviteMessage } from "@/components/team/invite-section";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { toDateString, todayInTimezone } from "@/lib/dates";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireModule } from "@/modules/core/access/guard";
import { activePlaceInvites, INVITE_TTL_DAYS } from "@/modules/core/invites/service";
import { getSettings } from "@/modules/core/settings/service";
import { displayName, personName } from "@/modules/core/users/display-name";
import { canEditOrg, getOrgTree, type OrgTreeNode } from "@/modules/org/service";
import { isLateWork } from "@/modules/tasks/today";

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

const placedIds = (nodes: OrgTreeNode[]): string[] =>
  nodes.flatMap((n) => [...(n.user ? [n.user.id] : []), ...placedIds(n.children)]);

// Open team tasks per person (for the cards): owners and managers only, like the statistics.
async function loadByPerson(timezone: string) {
  const today = todayInTimezone(timezone);
  const open = await db.task.findMany({
    where: { isPersonal: false, status: { in: ["APPROVED", "IN_PROGRESS", "IN_REVIEW"] } },
    select: { assigneeId: true, dueDate: true, status: true },
  });
  const load = new Map<string, PersonLoad>();
  for (const task of open) {
    const entry = load.get(task.assigneeId) ?? { active: 0, overdue: 0 };
    entry.active += 1;
    const due = task.dueDate ? toDateString(task.dueDate) : null;
    // Work on review isn't late (the same «просрочено» as in Tasks).
    if (isLateWork({ status: task.status, dueDate: due }, today)) entry.overdue += 1;
    load.set(task.assigneeId, entry);
  }
  return load;
}

export default async function StructurePage({ searchParams }: PageProps<"/team/structure">) {
  const user = await requireModule("structure");
  const params = await searchParams;
  const view = params.view === "list" ? "list" : "chart";
  const [tree, users, { timezone }] = await Promise.all([
    getOrgTree(),
    // Active people; a deactivated one only where they already have a place (shown as such).
    db.user.findMany({
      where: { OR: [{ deactivatedAt: null }, { orgNode: { isNot: null } }] },
      orderBy: { firstName: "asc" },
    }),
    getSettings(user.id),
  ]);
  const editable = canEditOrg(user);
  const edit = editable && view === "chart" && params.edit === "1";
  const collapsed = params.collapse === "1";
  const load =
    user.role === "OWNER" || user.role === "MANAGER" ? await loadByPerson(timezone) : undefined;
  const { APP_URL } = getEnv();
  const placeInvites = editable ? await activePlaceInvites() : new Map();
  const invites = new Map(
    [...placeInvites].map(([nodeId, invite]) => {
      const link = `${APP_URL}/invite/${invite.code}`;
      return [nodeId, { id: invite.id, role: invite.role, link, message: inviteMessage(link) }];
    }),
  );
  const options = {
    people: users.map((u) => ({ id: u.id, name: personName(u) })),
    nodes: flatten(tree),
    invites,
    inviteDays: INVITE_TTL_DAYS,
    editId: typeof params.edit === "string" && view === "list" ? params.edit : undefined,
    addId: typeof params.add === "string" ? params.add : undefined,
  };
  // People the chart doesn't have yet: the owner is told, so it doesn't stay incomplete unnoticed.
  const placed = new Set(placedIds(tree));
  const notPlaced = editable
    ? users.filter((u) => !u.deactivatedAt && !placed.has(u.id)).map((u) => displayName(u))
    : [];
  const chartHref = (next: { edit?: boolean; collapse?: boolean }) => {
    const query = new URLSearchParams();
    if (next.edit ?? edit) query.set("edit", "1");
    if (next.collapse ?? collapsed) query.set("collapse", "1");
    return `/team/structure${query.size ? `?${query}` : ""}`;
  };
  const chart = (
    <ChartViewport
      tools={
        <>
          <Button asChild size="sm" variant="outline">
            <Link href={chartHref({ collapse: !collapsed })} scroll={false}>
              {t(collapsed ? "team.org.expandAll" : "team.org.collapseAll")}
            </Link>
          </Button>
          {editable && (
            <Button asChild size="sm" variant={edit ? "default" : "outline"}>
              <Link href={chartHref({ edit: !edit })} scroll={false}>
                {t(edit ? "team.org.editDone" : "team.org.editMode")}
              </Link>
            </Button>
          )}
        </>
      }
    >
      <OrgChart
        roots={tree}
        load={load}
        invited={new Set(placeInvites.keys())}
        edit={edit}
        depth={collapsed ? 2 : undefined}
      />
    </ChartViewport>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-medium md:text-2xl">{t("team.org.title")}</h1>
        <div className="flex flex-wrap gap-1">
          <Button asChild size="sm" variant={view === "chart" ? "default" : "outline"}>
            <Link href="/team/structure">{t("team.org.viewChart")}</Link>
          </Button>
          <Button asChild size="sm" variant={view === "list" ? "default" : "outline"}>
            <Link href="/team/structure?view=list">{t("team.org.viewList")}</Link>
          </Button>
          {editable && (
            <Button asChild size="sm" variant="ghost">
              <Link href="/team/structure/import">
                <FileSpreadsheet />
                {t("team.org.import.open")}
              </Link>
            </Button>
          )}
        </div>
      </div>
      {params.imported && (
        <p role="status" className="bg-secondary rounded-md p-3 text-sm">
          {t("team.org.import.done")}
        </p>
      )}
      {typeof params.error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`team.org.errors.${params.error}` as TranslationKey)}
        </p>
      )}
      {notPlaced.length > 0 && tree.length > 0 && (
        <p className="bg-secondary flex flex-wrap items-center gap-x-2 rounded-md p-3 text-sm">
          <span>
            {t("team.org.notPlaced", { count: notPlaced.length, names: notPlaced.join(", ") })}
          </span>
          <Link
            href="/team/structure?view=list&add=root#add-root"
            className="font-medium underline"
          >
            {t("team.org.placeThem")}
          </Link>
        </p>
      )}
      <Card className="min-w-0 overflow-hidden">
        {tree.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {editable ? t("team.org.emptyOwner") : t("team.org.empty")}
          </p>
        ) : view === "chart" ? (
          <OrgPhoneList roots={tree} load={Object.fromEntries(load ?? new Map())} chart={chart} />
        ) : (
          <OrgTree nodes={tree} editable={editable} options={options} />
        )}
      </Card>
      {editable && view === "chart" && tree.length > 0 && !edit && (
        <p className="text-muted-foreground -mt-2 text-xs">{t("team.org.editHint")}</p>
      )}
      {editable && (view === "list" || tree.length === 0) && (
        <details
          id="add-root"
          className="scroll-mt-24 rounded-xl border p-4"
          open={tree.length === 0 || params.add === "root"}
        >
          <summary className="cursor-pointer font-medium">{t("team.org.addRoot")}</summary>
          <OrgNodeForm parentId={null} options={options} />
        </details>
      )}
    </div>
  );
}
