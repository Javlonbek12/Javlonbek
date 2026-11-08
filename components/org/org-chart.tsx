import { ChevronLeft, ChevronRight, Pencil, Plus, Users } from "lucide-react";
import Link from "next/link";

import { moveOrgNodeAction } from "@/app/(app)/team/structure/actions";
import { initials } from "@/components/team/avatar";
import { Button } from "@/components/ui/button";
import { personTasksHref } from "@/components/team/stat-links";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { OrgTreeNode } from "@/modules/org/service";

export type PersonLoad = { active: number; overdue: number };

type ChartOptions = {
  load?: Map<string, PersonLoad>;
  // Places with an open invite.
  invited?: Set<string>;
  // The owner's «Изменить структуру»: arrows, «изменить» and «+» under every card.
  edit?: boolean;
  // «Свернуть всё»: only this many levels are drawn.
  depth?: number;
};

export function countPeople(node: OrgTreeNode): number {
  return (
    (node.kind === "POSITION" ? 1 : 0) + node.children.reduce((sum, c) => sum + countPeople(c), 0)
  );
}

function NodeCard({ node, options }: { node: OrgTreeNode; options: ChartOptions }) {
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
  // A deactivated person's place looks vacant, with their name and «отключён».
  const off = node.user?.deactivated === true;
  const vacant = (!node.user && !node.personName) || off;
  const name = node.user?.name ?? node.personName ?? t("team.org.vacancy");
  const stats = node.user ? options.load?.get(node.user.id) : undefined;
  return (
    <div
      className={cn(
        "bg-card relative flex w-44 flex-col items-center gap-1 rounded-lg border px-3 py-3 text-center shadow-xs",
        vacant && "border-dashed shadow-none",
        node.user && "hover:border-foreground/40 transition-colors",
      )}
    >
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
        {vacant && !off ? "?" : initials(name)}
      </span>
      {node.user ? (
        // The whole card opens the person; the numbers below open their tasks.
        <Link
          href={`/team/${node.user.id}`}
          className={cn(
            "text-sm leading-tight font-semibold after:absolute after:inset-0 hover:underline",
            vacant && "text-muted-foreground italic",
          )}
        >
          {name}
        </Link>
      ) : (
        <span
          className={cn(
            "text-sm leading-tight font-semibold",
            vacant && "text-muted-foreground italic",
          )}
        >
          {name}
        </span>
      )}
      <span className="text-muted-foreground text-xs leading-tight">{node.title}</span>
      {node.personName && !node.user && (
        <span className="text-muted-foreground text-[10px]">({t("team.org.notInApp")})</span>
      )}
      {off && (
        <span className="text-muted-foreground text-[10px]">({t("team.deactivation.mark")})</span>
      )}
      {options.invited?.has(node.id) && (
        <span className="rounded-full border px-2 py-0.5 text-[10px]">
          {t("team.org.invitedBadge")}
        </span>
      )}
      {stats && node.user && !off && (
        <span className="relative z-10 mt-0.5 flex flex-wrap justify-center gap-x-1.5 text-[11px]">
          <Link
            href={personTasksHref(node.user.id)}
            className="text-muted-foreground hover:underline"
          >
            {t("team.org.active", { count: stats.active })}
          </Link>
          {stats.overdue > 0 && (
            <Link
              href={personTasksHref(node.user.id, true)}
              className="text-destructive font-medium hover:underline"
            >
              {t("team.org.overdue", { count: stats.overdue })}
            </Link>
          )}
        </span>
      )}
    </div>
  );
}

// Under a card in edit mode: move it among its siblings, change it, add someone under it.
function EditTools({ node, first, last }: { node: OrgTreeNode; first: boolean; last: boolean }) {
  const tool =
    "bg-card hover:bg-accent text-muted-foreground flex size-7 items-center justify-center rounded-full border";
  return (
    <div className="mt-1.5 flex items-center gap-1">
      {(["left", "right"] as const).map((direction) => (
        <form key={direction} action={moveOrgNodeAction}>
          <input type="hidden" name="nodeId" value={node.id} />
          <input type="hidden" name="direction" value={direction} />
          <input type="hidden" name="from" value="chart" />
          {/* The guarded Button: a double press moves the card once, not twice. */}
          <Button
            type="submit"
            size="icon"
            variant="outline"
            className="text-muted-foreground size-7 disabled:opacity-30"
            disabled={direction === "left" ? first : last}
            title={t(direction === "left" ? "team.org.moveLeft" : "team.org.moveRight")}
            aria-label={t(direction === "left" ? "team.org.moveLeft" : "team.org.moveRight")}
          >
            {direction === "left" ? <ChevronLeft /> : <ChevronRight />}
          </Button>
        </form>
      ))}
      <Link
        href={`/team/structure?view=list&edit=${node.id}#node-${node.id}`}
        className={tool}
        title={t("team.org.edit")}
        aria-label={t("team.org.edit")}
      >
        <Pencil className="size-3.5" />
      </Link>
      <Link
        href={`/team/structure?view=list&add=${node.id}#node-${node.id}`}
        className={tool}
        title={t("team.org.addChild")}
        aria-label={t("team.org.addChild")}
      >
        <Plus className="size-4" />
      </Link>
    </div>
  );
}

function Branch({
  nodes,
  options,
  level,
}: {
  nodes: OrgTreeNode[];
  options: ChartOptions;
  level: number;
}) {
  return (
    <ul>
      {nodes.map((node, i) => {
        const folded = options.depth !== undefined && level >= options.depth;
        return (
          <li key={node.id} id={`node-${node.id}`}>
            <NodeCard node={node} options={options} />
            {options.edit && (
              <EditTools node={node} first={i === 0} last={i === nodes.length - 1} />
            )}
            {node.children.length > 0 &&
              (folded ? (
                <span className="text-muted-foreground mt-1 rounded-full border border-dashed px-2 text-[11px]">
                  {t("team.org.hiddenBelow", { count: node.children.length })}
                </span>
              ) : (
                <Branch nodes={node.children} options={options} level={level + 1} />
              ))}
          </li>
        );
      })}
    </ul>
  );
}

// The visual org chart; the viewport around it fits it to the screen.
export function OrgChart({ roots, ...options }: { roots: OrgTreeNode[] } & ChartOptions) {
  return (
    <div className="org-chart px-2 py-4">
      <Branch nodes={roots} options={options} level={1} />
    </div>
  );
}
