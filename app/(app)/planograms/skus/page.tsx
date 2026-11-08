import Link from "next/link";

import { PlanogramErrorNote, SavedNote } from "@/components/planograms/error-note";
import { Thumb } from "@/components/planograms/thumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db";
import { fromDateString } from "@/lib/dates";
import type { PriceLabelStyle } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManagePlanograms } from "@/modules/planograms/access";
import { priceListDate } from "@/modules/planograms/price-status";
import { currentPrices } from "@/modules/planograms/price-table";
import { formatPrice } from "@/modules/planograms/prices";
import { skuLabel } from "@/modules/planograms/shelf-list";

export default async function SkusPage({ searchParams }: PageProps<"/planograms/skus">) {
  const user = await requireUser();
  const query = await searchParams;
  const manage = canManagePlanograms(user.role);
  // The price in force today, and a later list's price beside it (never in its place).
  const [skus, { prices, future }] = await Promise.all([
    db.sku.findMany({ orderBy: [{ archived: "asc" }, { brand: "asc" }, { name: "asc" }] }),
    currentPrices(),
  ]);
  const next = (skuId: string, style: PriceLabelStyle) => {
    const f = future.get(skuId);
    if (!f) return null;
    const price = formatPrice(f.price, style);
    return f.waiting
      ? t("planograms.library.prices.futureWaiting", { price })
      : t("planograms.library.prices.futureFrom", {
          date: priceListDate(fromDateString(f.from)),
          price,
        });
  };

  return (
    <div className="flex flex-col gap-3">
      <PlanogramErrorNote error={query.error} />
      <SavedNote
        show={query.created}
        text={t("planograms.library.skus.imported", {
          created: String(query.created),
          updated: String(query.updated ?? 0),
          skipped: String(query.skipped ?? 0),
        })}
      />
      {manage && (
        <div className="flex flex-col gap-3 md:flex-row md:items-start">
          <Button asChild size="sm" className="self-start">
            <Link href="/planograms/skus/new">{t("planograms.library.skus.new")}</Link>
          </Button>
          <Card className="gap-2 md:flex-1">
            <CardTitle>{t("planograms.library.skus.import")}</CardTitle>
            <p className="text-muted-foreground text-xs">
              {t("planograms.library.skus.importHint")}
            </p>
            <form
              action="/api/planograms/import-skus"
              method="post"
              encType="multipart/form-data"
              className="flex flex-wrap gap-2"
            >
              <Input type="file" name="file" accept=".xlsx,.csv" required className="max-w-xs" />
              <Button type="submit" size="sm" variant="outline">
                {t("planograms.library.mass.run")}
              </Button>
            </form>
          </Card>
        </div>
      )}
      {skus.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("planograms.library.empty")}</p>
      )}
      <ul className="divide-y rounded-lg border">
        {skus.map((s) => (
          <li key={s.id}>
            <Link
              href={`/planograms/skus/${s.id}`}
              className="hover:bg-accent/50 flex items-center gap-3 p-2"
            >
              <Thumb kind="sku" id={s.id} imagePath={s.imagePath} color={s.color} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{skuLabel(s)}</p>
                <p className="text-muted-foreground text-xs">
                  {s.code}
                  {s.format && ` · ${s.format}`}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {s.isMandatory && (
                  <Badge variant="secondary">{t("planograms.library.skus.mandatory")}</Badge>
                )}
                {s.isNew && <Badge>{t("planograms.library.skus.isNew")}</Badge>}
                {s.archived && (
                  <Badge variant="outline">{t("planograms.library.skus.archived")}</Badge>
                )}
              </div>
              <span className="flex w-24 shrink-0 flex-col items-end text-sm tabular-nums">
                {prices.has(s.id) ? formatPrice(prices.get(s.id)!, s.priceStyle) : "—"}
                {next(s.id, s.priceStyle) && (
                  <span className="text-muted-foreground text-right text-[11px] leading-tight">
                    {next(s.id, s.priceStyle)}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
