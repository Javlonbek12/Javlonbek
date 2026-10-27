import Link from "next/link";

import { PlanogramErrorNote } from "@/components/planograms/error-note";
import { PosmForm } from "@/components/planograms/posm-form";
import { Thumb } from "@/components/planograms/thumb";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManagePlanograms } from "@/modules/planograms/access";

export default async function PosmPage({ searchParams }: PageProps<"/planograms/posm">) {
  const user = await requireUser();
  const { error } = await searchParams;
  const items = await db.posm.findMany({ orderBy: [{ archived: "asc" }, { name: "asc" }] });
  return (
    <div className="flex flex-col gap-4">
      <PlanogramErrorNote error={error} />
      {items.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("planograms.library.empty")}</p>
      )}
      <ul className="divide-y rounded-lg border">
        {items.map((p) => (
          <li key={p.id}>
            <Link
              href={`/planograms/posm/${p.id}`}
              className="hover:bg-accent/50 flex items-center gap-3 p-2"
            >
              <Thumb kind="posm" id={p.id} imagePath={p.imagePath} color={p.color} />
              <span className="flex-1 text-sm font-medium">{p.name}</span>
              <span className="text-muted-foreground text-xs">
                {t(`planograms.library.posm.types.${p.type}`)} · {p.slotSpan}
                {p.shelfSpan > 1 && ` × ${p.shelfSpan}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {canManagePlanograms(user.role) && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer font-medium">
            {t("planograms.library.posm.new")}
          </summary>
          <div className="mt-3">
            <PosmForm posm={null} />
          </div>
        </details>
      )}
    </div>
  );
}
