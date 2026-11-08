"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";
import type { OrgTreeNode } from "@/modules/org/service";

type Load = Record<string, { active: number; overdue: number }>;

function Person({ node, load, path }: { node: OrgTreeNode; load: Load; path?: string }) {
  const t = useT();
  const name = node.user?.name ?? node.personName ?? t("team.org.vacancy");
  const stats = node.user && !node.user.deactivated ? load[node.user.id] : undefined;
  const vacant = (!node.user && !node.personName) || node.user?.deactivated;
  return (
    <span className="flex min-w-0 flex-col">
      {node.user ? (
        <Link
          href={`/team/${node.user.id}`}
          className={cn("font-medium hover:underline", vacant && "text-muted-foreground italic")}
        >
          {name}
          {node.user.deactivated && ` (${t("team.deactivation.mark")})`}
        </Link>
      ) : (
        <span className={cn("font-medium", vacant && "text-muted-foreground italic")}>{name}</span>
      )}
      <span className="text-muted-foreground text-xs">
        {node.title}
        {path && ` · ${path}`}
        {stats && ` · ${t("team.org.active", { count: stats.active })}`}
      </span>
      {stats && stats.overdue > 0 && (
        <span className="text-destructive text-xs">
          {t("team.org.overdue", { count: stats.overdue })}
        </span>
      )}
    </span>
  );
}

function Level({ nodes, load, depth }: { nodes: OrgTreeNode[]; load: Load; depth: number }) {
  return (
    <ul className={cn("flex flex-col gap-1", depth > 0 && "border-l pl-3")}>
      {nodes.map((node) => {
        const body =
          node.kind === "UNIT" ? (
            <span className="font-semibold">
              {node.name}
              {node.title && (
                <span className="text-muted-foreground text-xs font-normal"> · {node.title}</span>
              )}
            </span>
          ) : (
            <Person node={node} load={load} />
          );
        return (
          <li key={node.id} className="py-1">
            {node.children.length > 0 ? (
              // The first two levels open, deeper ones folded.
              <details open={depth < 1}>
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <span className="flex items-start gap-1.5">
                    <span className="text-muted-foreground w-3 text-xs">▸</span>
                    {body}
                    <span className="text-muted-foreground ml-auto text-xs">
                      {node.children.length}
                    </span>
                  </span>
                </summary>
                <div className="mt-1 ml-1">
                  <Level nodes={node.children} load={load} depth={depth + 1} />
                </div>
              </details>
            ) : (
              <span className="flex items-start gap-1.5">
                <span className="w-3" />
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Every place with the units above it, for the search.
function flatten(nodes: OrgTreeNode[], path: string[] = []): { node: OrgTreeNode; path: string }[] {
  return nodes.flatMap((node) => {
    const here = node.kind === "UNIT" ? [...path, node.name ?? ""] : path;
    return [
      ...(node.kind === "POSITION" ? [{ node, path: path.join(" › ") }] : []),
      ...flatten(node.children, node.label ? [...here, node.label] : here),
    ];
  });
}

// On a phone a wide chart doesn't fit: a folding list with a search for a person instead, and
// the chart one press away.
export function OrgPhoneList({
  roots,
  load,
  chart,
}: {
  roots: OrgTreeNode[];
  load: Load;
  chart: React.ReactNode;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [showChart, setShowChart] = useState(false);
  const q = query.trim().toLowerCase();
  const found = q
    ? flatten(roots).filter(({ node }) =>
        [node.user?.name, node.personName, node.title]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    : [];
  return (
    <>
      <div className={cn("flex flex-col gap-3 md:hidden", showChart && "hidden")}>
        <label className="bg-card flex items-center gap-2 rounded-2xl border px-4">
          <Search className="text-muted-foreground size-[18px] shrink-0" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("team.org.searchPerson")}
            aria-label={t("team.org.searchPerson")}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        {q ? (
          found.length ? (
            <ul className="flex flex-col gap-2">
              {found.map(({ node, path }) => (
                <li key={node.id}>
                  <Person node={node} load={load} path={path} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">{t("team.empty")}</p>
          )
        ) : (
          <Level nodes={roots} load={load} depth={0} />
        )}
        <button
          type="button"
          onClick={() => setShowChart(true)}
          className="text-primary w-fit text-sm font-medium hover:underline"
        >
          {t("team.org.showChart")}
        </button>
      </div>
      <div className={cn(!showChart && "hidden", "md:block")}>
        {showChart && (
          <button
            type="button"
            onClick={() => setShowChart(false)}
            className="text-primary mb-2 w-fit text-sm font-medium hover:underline md:hidden"
          >
            {t("team.org.showList")}
          </button>
        )}
        {chart}
      </div>
    </>
  );
}
