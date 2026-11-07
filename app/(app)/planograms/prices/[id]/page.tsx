import Link from "next/link";
import { notFound } from "next/navigation";

import { PlanogramErrorNote, SavedNote } from "@/components/planograms/error-note";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDay, toDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { canApprovePlanograms } from "@/modules/planograms/access";
import { formatPrice } from "@/modules/planograms/prices";
import { PriceTable } from "@/components/planograms/price-table";
import { canManagePlanograms } from "@/modules/planograms/access";
import { priceTable } from "@/modules/planograms/price-table";
import { draftsOnOlderLists, previewPriceList } from "@/modules/planograms/pricing";

import { applyPriceListAction, savePricesAction } from "../../actions";

export default async function PriceListPage({
  params,
  searchParams,
}: PageProps<"/planograms/prices/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const list = await db.priceList.findUnique({ where: { id } });
  if (!list) notFound();
  const [preview, table, waiting] = await Promise.all([
    previewPriceList(id),
    priceTable(id),
    // Once the list is applied, a draft on an older list was put there on purpose.
    list.appliedAt ? [] : draftsOnOlderLists(id),
  ]);
  const editable = !list.appliedAt && canManagePlanograms(user.role);
  const skus = await db.sku.findMany({
    where: { id: { in: preview.flatMap((p) => p.changes.map((c) => c.skuId)) } },
  });
  const byId = new Map(skus.map((s) => [s.id, s]));
  const price = (value: number | null, skuId: string) =>
    value === null ? "—" : formatPrice(value, byId.get(skuId)?.priceStyle ?? "NUMBER");

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">
        {list.name} · {t("planograms.library.prices.effectiveFrom").toLowerCase()}{" "}
        {formatDay(toDateString(list.effectiveFrom))}
      </h2>
      <PlanogramErrorNote error={query.error} />
      <SavedNote
        show={query.edited}
        text={t("planograms.library.prices.edited", { count: String(query.edited) })}
      />
      <SavedNote
        show={query.created}
        text={t("planograms.library.prices.created", { count: String(query.created) })}
      />
      {typeof query.drafts === "string" && query.drafts !== "0" && (
        <p className="text-sm text-amber-700">
          {t("planograms.library.prices.drafts", { count: query.drafts })}
        </p>
      )}
      {typeof query.moved === "string" && query.moved !== "0" && (
        <p className="text-muted-foreground text-sm">
          {t("planograms.library.prices.moved", { count: query.moved })}
        </p>
      )}
      {typeof query.unknown === "string" && (
        <p className="text-sm text-amber-700">
          {t("planograms.library.prices.unknown", { codes: query.unknown })}
        </p>
      )}
      {list.appliedAt && (
        <p className="text-muted-foreground text-sm">
          {t("planograms.library.prices.applied", {
            date: formatDay(toDateString(list.appliedAt)),
          })}
        </p>
      )}
      <h3 className="font-medium">{t("planograms.library.prices.preview")}</h3>
      {preview.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("planograms.library.prices.noChanges")}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {preview.map((p) => (
            <Card key={p.planogramId} className="gap-1">
              <CardTitle>
                <Link className="underline" href={`/planograms/${p.planogramId}`}>
                  {p.title}
                </Link>{" "}
                <span className="text-muted-foreground text-sm font-normal">
                  {t("planograms.version", { version: p.version })}
                </span>
              </CardTitle>
              <ul className="text-sm">
                {p.changes.map((c) => {
                  const sku = byId.get(c.skuId);
                  return (
                    <li key={c.skuId}>
                      {sku ? `${sku.brand} ${sku.name}` : c.skuId}: {price(c.from, c.skuId)} →{" "}
                      {price(c.to, c.skuId)}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {waiting.length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          <p>{t("planograms.library.prices.waiting", { count: String(waiting.length) })}</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {waiting.map((p) => (
              <li key={p.id}>
                <Link className="underline" href={`/planograms/${p.id}`}>
                  {p.title}
                </Link>{" "}
                <span className="text-muted-foreground">
                  {t("planograms.version", { version: p.version })} ·{" "}
                  {t(`planograms.status.${p.status}`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {canApprovePlanograms(user.role) && (preview.length > 0 || waiting.length > 0) && (
        <form action={applyPriceListAction}>
          <input type="hidden" name="priceListId" value={list.id} />
          <Button type="submit">{t("planograms.library.prices.apply")}</Button>
        </form>
      )}

      <Card className="gap-3">
        <CardTitle>{t("planograms.library.prices.listPrices")}</CardTitle>
        <p className="text-muted-foreground text-sm">
          {table.previous
            ? t("planograms.library.prices.listHint", { list: table.previous.name })
            : t("planograms.library.prices.listHintFirst")}{" "}
          {editable
            ? t("planograms.library.prices.editable")
            : list.appliedAt
              ? t("planograms.library.prices.readonly")
              : ""}
        </p>
        <PriceTable
          rows={table.rows}
          editable={editable}
          action={savePricesAction}
          hidden={{ listId: list.id }}
          submit={t("planograms.library.prices.saveList")}
        />
      </Card>
    </div>
  );
}
