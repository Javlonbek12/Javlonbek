import type { Metadata } from "next";

import { PlanogramPicture } from "@/components/planograms/planogram-picture";
import { formatDay, toDateString } from "@/lib/dates";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { describeChange } from "@/modules/planograms/describe";
import { planogramSvg, slideSubtitle, slideTitle } from "@/modules/planograms/export";
import { changesVsPrevious, findByShareToken } from "@/modules/planograms/service";
import { shelfList } from "@/modules/planograms/shelf-list";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Public page for merchandisers: an approved planogram by its secret link, no login. Under the
// picture, the same shelves as a list (SKU, marks, price) that reads on a phone in the shop.
// ?print=1 gives bigger price tags; printed, it is an A4 sheet turned sideways.
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
  const [svg, changes, skus, posms] = await Promise.all([
    planogramSvg(loaded, { large, imageBase: `/p/${token}/img` }),
    changesVsPrevious(loaded),
    db.sku.findMany({ select: { id: true, brand: true, name: true, priceStyle: true } }),
    db.posm.findMany({ select: { id: true, name: true } }),
  ]);
  const names = new Map([...skus, ...posms].map((x) => [x.id, x.name]));
  const shelves = shelfList(
    loaded.layout,
    loaded.geometry,
    new Map(skus.map((s) => [s.id, s])),
    new Map(posms.map((p) => [p.id, p.name])),
    loaded.prices,
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-4 print:max-w-none print:p-0">
      <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
      {!loaded.inForce && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-xl border p-3 text-sm font-medium"
        >
          {t("planograms.public.notInForce")}
        </p>
      )}
      <h1 className="text-[22px] font-medium md:text-2xl">{slideTitle(loaded)}</h1>
      <p className="text-muted-foreground text-sm">
        {slideSubtitle(loaded)}
        {loaded.inForce &&
          loaded.record.approvedAt &&
          ` · ${t("planograms.public.approved", { date: formatDay(toDateString(loaded.record.approvedAt)) })}`}
      </p>
      <PlanogramPicture
        svg={svg}
        className="print:overflow-visible print:border-0 print:p-0 [&_svg]:h-auto print:[&_svg]:h-auto print:[&_svg]:max-h-[170mm] print:[&_svg]:w-full print:[&_svg]:max-w-full"
      />
      {loaded.record.notes && <p className="text-sm whitespace-pre-wrap">{loaded.record.notes}</p>}
      <section className="flex flex-col gap-2 print:break-before-page">
        <h2 className="font-medium">{t("planograms.public.shelves")}</h2>
        <ol className="flex flex-col gap-2 print:columns-2 print:gap-8">
          {shelves.map(({ shelf, entries }) => (
            <li key={shelf} className="rounded-xl border p-3 print:break-inside-avoid print:p-2">
              <h3 className="mb-1 text-sm font-semibold">
                {t("planograms.public.shelf", { n: shelf })}
              </h3>
              <ul className="flex flex-col gap-0.5 text-sm">
                {entries.map((e, i) => (
                  <li
                    key={i}
                    className={cn(
                      "flex items-baseline gap-2",
                      e.kind !== "SKU" && "text-muted-foreground",
                    )}
                  >
                    <span className="text-muted-foreground w-5 shrink-0 text-right text-xs tabular-nums">
                      {i + 1}.
                    </span>
                    {e.kind === "SKU" ? (
                      <>
                        <span className="min-w-0 flex-1 break-words">
                          {e.name}
                          {e.facings > 1 && <span className="font-semibold"> ×{e.facings}</span>}
                          {e.badges.length > 0 && (
                            <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">
                              {e.badges.join(" ")}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums">
                          {e.price ?? t("planograms.public.noPrice")}
                        </span>
                      </>
                    ) : e.kind === "POSM" ? (
                      <span className="min-w-0 flex-1 break-words">
                        {t("planograms.public.posm")}: {e.name}
                      </span>
                    ) : (
                      <span className="min-w-0 flex-1">
                        {t(
                          e.kind === "EMPTY"
                            ? "planograms.public.empty"
                            : "planograms.public.notFilled",
                        )}
                        {e.places > 1 && ` ×${e.places}`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
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
