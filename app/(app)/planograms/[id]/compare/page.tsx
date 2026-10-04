import Link from "next/link";
import { notFound } from "next/navigation";

import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { comparisonSvgs } from "@/modules/planograms/export";
import { loadPlanogram } from "@/modules/planograms/repository";

// Before / after side by side with highlighted changes.
export default async function ComparePage({
  params,
  searchParams,
}: PageProps<"/planograms/[id]/compare">) {
  await requireUser();
  const { id } = await params;
  const { with: withId } = await searchParams;
  const current = await loadPlanogram(id);
  const beforeId = typeof withId === "string" ? withId : current?.record.previousVersionId;
  if (!current || !beforeId) notFound();
  const result = await comparisonSvgs(beforeId, id);
  if (!result) notFound();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">
          {t("planograms.compare.title")}: {current.record.title}
        </h2>
        <Link className="text-sm underline" href={`/planograms/${id}`}>
          ← {current.record.title}
        </Link>
      </div>
      <p className="text-muted-foreground text-xs">{t("planograms.compare.legend")}</p>
      <div className="grid gap-3 xl:grid-cols-2">
        <section className="flex flex-col gap-1">
          <h3 className="font-medium">
            {t("planograms.compare.before")} ·{" "}
            {t("planograms.version", { version: result.before.record.version })}
          </h3>
          <div
            className="overflow-x-auto rounded-lg border bg-white p-2"
            dangerouslySetInnerHTML={{ __html: result.beforeSvg }}
          />
        </section>
        <section className="flex flex-col gap-1">
          <h3 className="font-medium">
            {t("planograms.compare.after")} ·{" "}
            {t("planograms.version", { version: result.after.record.version })}
          </h3>
          <div
            className="overflow-x-auto rounded-lg border bg-white p-2"
            dangerouslySetInnerHTML={{ __html: result.afterSvg }}
          />
        </section>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {result.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
