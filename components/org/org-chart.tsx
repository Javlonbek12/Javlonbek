import { Users } from "lucide-react";
import Link from "next/link";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { OrgTreeNode } from "@/modules/org/service";

import { CenteredScroll } from "./centered-scroll";

export type PersonLoad = { active: number; overdue: number };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

function countPeople(node: OrgTreeNode): number {
  return (
    (node.kind === "POSITION" ? 1 : 0) + node.children.reduce((sum, c) => sum + countPeople(c), 0)
  );
}

function NodeCard({ node, load }: { node: OrgTreeNode; load?: Map<string, PersonLoad> }) {
  if (node.kind === "UNIT") {
    return (
      <div className="bg-muted/70 flex w-48 flex-col items-center gap-1 rounded-lg border px-3 py-2.5 text-center">
        <Users className="text-muted-foreground size-4" aria-hidden />
        <p className="text-sm leading-tight font-semibold">{node.name}</p>
        {node.title && <p className="text-muted-foreground text-xs">{node.title}</p>}
        <p className="text-muted-foreground text-[11px]">
          {t("team.org.people", { count: countPeople(node) })}
        </p>
      </div>
    );
  }
  const vacant = !node.user && !node.personName;
  const name = node.user?.name ?? node.personName ?? t("team.org.vacancy");
  const stats = node.user ? load?.get(node.user.id) : undefined;
  const body = (
    <>
      {node.label && (
        <span className="bg-background text-muted-foreground -mt-5 mb-1 rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap">
          {node.label}
        </span>
      )}
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-full text-sm font-semibold",
          vacant
            ? "text-muted-foreground border border-dashed"
            : "bg-primary text-primary-foreground",
        )}
        aria-hidden
      >
        {vacant ? "?" : initials(name)}
      </span>
      <span
        className={cn(
          "text-sm leading-tight font-semibold",
          vacant && "text-muted-foreground italic",
        )}
      >
        {name}
      </span>
      <span className="text-muted-foreground text-xs leading-tight">{node.title}</span>
      {node.personName && !node.user && (
        <span className="text-muted-foreground text-[10px]">({t("team.org.notInApp")})</span>
      )}
      {stats && (
        <span className="text-muted-foreground mt-0.5 text-[11px]">
          {t("team.org.active", { count: stats.active })}
          {stats.overdue > 0 && (
            <>
              {" · "}
              <span className="text-destructive font-medium">
                {t("team.org.overdue", { count: stats.overdue })}
              </span>
            </>
          )}
        </span>
      )}
    </>
  );
  const box = cn(
    "bg-card flex w-44 flex-col items-center gap-1 rounded-lg border px-3 py-3 text-center shadow-xs",
    vacant && "border-dashed shadow-none",
  );
  return node.user ? (
    <Link
      href={`/team/${node.user.id}`}
      className={cn(
        box,
        "hover:border-foreground/40 focus-visible:ring-ring/50 transition-colors outline-none focus-visible:ring-[3px]",
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

function Branch({ nodes, load }: { nodes: OrgTreeNode[]; load?: Map<string, PersonLoad> }) {
  return (
    <ul>
      {nodes.map((node) => (
        <li key={node.id}>
          <NodeCard node={node} load={load} />
          {node.children.length > 0 && <Branch nodes={node.children} load={load} />}
        </li>
      ))}
    </ul>
  );
}

// The visual org chart. Wide structures scroll sideways; the list view stays for editing.
export function OrgChart({
  roots,
  load,
}: {
  roots: OrgTreeNode[];
  load?: Map<string, PersonLoad>;
}) {
  return (
    <CenteredScroll className="overflow-x-auto pb-2">
      <div className="org-chart mx-auto w-max min-w-full px-2 py-4">
        <Branch nodes={roots} load={load} />
      </div>
    </CenteredScroll>
  );
}
