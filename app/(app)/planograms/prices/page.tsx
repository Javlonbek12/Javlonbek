import { Download } from "lucide-react";
import Link from "next/link";

import { PlanogramErrorNote } from "@/components/planograms/error-note";
import { PriceTable } from "@/components/planograms/price-table";
import { PriceListStatusBadge } from "@/components/planograms/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManagePlanograms } from "@/modules/planograms/access";
import { priceListDate } from "@/modules/planograms/price-status";
import { priceTable } from "@/modules/planograms/price-table";
import { listPriceLists } from "@/modules/planograms/pricing";

import { savePricesAction } from "../actions";

export default async function PricesPage({ searchParams }: PageProps<"/planograms/prices">) {
  const user = await requireUser();
  const { error, unread } = await searchParams;
  const [lists, current] = await Promise.all([listPriceLists(), priceTable()]);
  return (
    <div className="flex flex-col gap-4">
      <PlanogramErrorNote error={error} />
      {typeof unread === "string" && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {t("planograms.library.prices.unreadRows", { rows: unread })}
        </p>
      )}
      {canManagePlanograms(user.role) && (
        <Card className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("planograms.library.prices.new")}</CardTitle>
            <Button asChild variant="outline" size="sm">
              <a href="/api/planograms/price-lists/template">
                <Download />
                {t("planograms.library.prices.download")}
              </a>
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">{t("planograms.library.prices.hint")}</p>
          <form
            action="/api/planograms/price-lists"
            method="post"
            encType="multipart/form-data"
            className="grid gap-3 md:grid-cols-3"
          >
            <Label className="flex-col items-start">
              {t("planograms.library.prices.name")}
              <Input name="name" required />
            </Label>
            <Label className="flex-col items-start">
              {t("planograms.library.prices.effectiveFrom")}
              <Input type="date" name="effectiveFrom" required />
            </Label>
            <Label className="flex-col items-start">
              {t("planograms.library.prices.file")}
              <Input type="file" name="file" accept=".xlsx,.csv" required />
            </Label>
            <Button type="submit" size="sm" className="self-start">
              {t("planograms.library.prices.upload")}
            </Button>
          </form>
        </Card>
      )}
      {lists.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("planograms.library.empty")}</p>
      )}
      <ul className="divide-y rounded-lg border">
        {lists.map((l) => (
          <li key={l.id}>
            <Link
              href={`/planograms/prices/${l.id}`}
              className="hover:bg-accent/50 flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm"
            >
              <span className="font-medium">{l.name}</span>
              <PriceListStatusBadge status={l.status} />
              <span className="text-muted-foreground">
                {t("planograms.library.prices.effectiveFrom")} {priceListDate(l.effectiveFrom)} ·{" "}
                {t("planograms.library.prices.rows", { count: String(l._count.prices) })}
              </span>
              {l.appliedAt && (
                <span className="text-muted-foreground text-xs">
                  {t("planograms.library.prices.applied", { date: priceListDate(l.appliedAt) })}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      <Card className="gap-3">
        <CardTitle>{t("planograms.library.prices.current")}</CardTitle>
        <p className="text-muted-foreground text-sm">
          {current.list
            ? t("planograms.library.prices.currentHint", { list: current.list.name })
            : t("planograms.library.prices.currentEmpty")}
        </p>
        <PriceTable
          rows={current.rows}
          editable={canManagePlanograms(user.role)}
          action={savePricesAction}
          submit={t("planograms.library.prices.saveNew")}
          head={
            <>
              <Label className="flex-col items-start">
                {t("planograms.library.prices.name")}
                <Input name="name" required maxLength={100} className="w-56" />
              </Label>
              <Label className="flex-col items-start">
                {t("planograms.library.prices.effectiveFrom")}
                <Input type="date" name="effectiveFrom" required />
              </Label>
            </>
          }
        />
      </Card>
    </div>
  );
}
