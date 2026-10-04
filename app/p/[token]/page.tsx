import type { Metadata } from "next";

import { formatDay, toDateString } from "@/lib/dates";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { describeChange } from "@/modules/planograms/describe";
import { planogramSvg, slideSubtitle, slideTitle } from "@/modules/planograms/export";
import { changesVsPrevious, findByShareToken } from "@/modules/planograms/service";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Public page for merchandisers: an approved planogram by its secret link, no login.
// ?print=1 gives bigger price tags and a print-friendly page.
export default async function PublicPlanogramPage({
  params,
  searchParams,
}: PageProps<"/p/[token]">) {
  const { token } = await params;
  const { print } = await searchParams;
  const loaded = token.length >= 16 ? await findByShareToken(token) : null;
  if (!loaded) {
    return <main className="p-6 text-center">{t("planograms.public.notApproved")}</main>;
  }
  const large = print === "1";
  const [svg, changes, names] = await Promise.all([
    planogramSvg(loaded, { large }),
    changesVsPrevious(loaded),
    Promise.all([
      db.sku.findMany({ select: { id: true, name: true } }),
      db.posm.findMany({ select: { id: true, name: true } }),
    ]).then(([a, b]) => new Map([...a, ...b].map((x) => [x.id, x.name]))),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-4 print:p-0">
      <h1 className="text-2xl font-semibold">{slideTitle(loaded)}</h1>
      <p className="text-muted-foreground text-sm">
        {slideSubtitle(loaded)}
        {loaded.record.approvedAt &&
          ` · ${t("planograms.public.approved", { date: formatDay(toDateString(loaded.record.approvedAt)) })}`}
      </p>
      <div
        className="overflow-x-auto rounded-lg border bg-white p-2 print:overflow-visible print:border-0 [&_svg]:h-auto [&_svg]:max-w-none print:[&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {loaded.record.notes && <p className="text-sm whitespace-pre-wrap">{loaded.record.notes}</p>}
      {changes.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="font-medium">{t("planograms.export.changesTitle")}</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {changes.map((c, i) => (
              <li key={i}>• {describeChange(c, names)}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
