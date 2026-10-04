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
};

export function PlanogramList({ items }: { items: Item[] }) {
  if (items.length === 0)
    return <p className="text-muted-foreground text-sm">{t("planograms.empty")}</p>;
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {items.map((p) => (
        <Link
          key={p.id}
          href={`/planograms/${p.id}`}
          className="bg-card hover:bg-accent/40 flex flex-col gap-1 rounded-lg border p-3"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{p.title}</span>
            <PlanogramStatusBadge status={p.status} />
          </span>
          <span className="text-muted-foreground text-xs">
            {p.equipment.name} · {p.channel} · {t("planograms.version", { version: p.version })}
            {p.project && ` · ${p.project}`} · {formatDay(toDateString(p.updatedAt))}
          </span>
        </Link>
      ))}
    </div>
  );
}
