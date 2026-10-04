import Link from "next/link";

import { PlanogramErrorNote } from "@/components/planograms/error-note";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDay, toDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManagePlanograms } from "@/modules/planograms/access";
import { listPriceLists } from "@/modules/planograms/pricing";

export default async function PricesPage({ searchParams }: PageProps<"/planograms/prices">) {
  const user = await requireUser();
  const { error } = await searchParams;
  const lists = await listPriceLists();
  return (
    <div className="flex flex-col gap-4">
      <PlanogramErrorNote error={error} />
      {canManagePlanograms(user.role) && (
        <Card className="gap-2">
          <CardTitle>{t("planograms.library.prices.new")}</CardTitle>
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
              <span className="text-muted-foreground">
                {t("planograms.library.prices.effectiveFrom")}{" "}
                {formatDay(toDateString(l.effectiveFrom))} ·{" "}
                {t("planograms.library.prices.rows", { count: String(l._count.prices) })}
              </span>
              {l.appliedAt && (
                <span className="text-muted-foreground text-xs">
                  {t("planograms.library.prices.applied", {
                    date: formatDay(toDateString(l.appliedAt)),
                  })}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
