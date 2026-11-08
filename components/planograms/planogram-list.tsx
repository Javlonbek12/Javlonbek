import Link from "next/link";

import { formatDay, toDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { PlanogramStatus } from "@/lib/generated/prisma/enums";

import { PlanogramStatusBadge } from "./status-badge";

type Item = {
  id: string;
  title: string;
  status: PlanogramStatus;
  version: number;
  project: string | null;
  channel: string;
  updatedAt: Date;
  equipment: { name: string };
  // Other versions in the works (the list shows one card per planogram).
  working?: { id: string; version: number; status: "DRAFT" | "PENDING_APPROVAL" }[];
};

export function PlanogramList({ items }: { items: Item[] }) {
  if (items.length === 0)
    return <p className="text-muted-foreground text-sm">{t("planograms.empty")}</p>;
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {items.map((p) => (
        <div
          key={p.id}
          className="bg-card hover:bg-accent/40 relative flex flex-col gap-1 rounded-lg border p-3"
        >
          <Link
            href={`/planograms/${p.id}`}
            className="flex flex-wrap items-center gap-2 after:absolute after:inset-0"
          >
            <span className="font-medium">{p.title}</span>
            <PlanogramStatusBadge status={p.status} />
          </Link>
          <span className="text-muted-foreground text-xs">
            {p.equipment.name} · {p.channel} · {t("planograms.version", { version: p.version })}
            {p.project && ` · ${p.project}`} · {formatDay(toDateString(p.updatedAt))}
          </span>
          {p.working && p.working.length > 0 && (
            <span className="relative z-10 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {p.working.map((w) => (
                <Link
                  key={w.id}
                  href={`/planograms/${w.id}`}
                  className="text-amber-700 underline dark:text-amber-300"
                >
                  {t(
                    w.status === "DRAFT"
                      ? "planograms.list.hasDraft"
                      : "planograms.list.hasPending",
                    { version: w.version },
                  )}
                </Link>
              ))}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
