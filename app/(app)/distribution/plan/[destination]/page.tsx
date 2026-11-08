import Link from "next/link";
import { notFound } from "next/navigation";

import { fmt, N } from "@/components/distribution/parts";
import { PrintButton } from "@/components/distribution/print-button";
import { Card } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/input";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { remainder, sumUnits } from "@/modules/distribution/compute";
import { loadDistribution } from "@/modules/distribution/service";
import { parseDestination } from "@/modules/distribution/types";

import { shipWaybillAction } from "../../actions";

// The waybill of a region or one of its TSMs: what to send, what has gone already; printable, and
// the whole remainder can be recorded as shipped in one go. A region's share covers its TSMs: what
// went straight to them is not sent to the region again.
export default async function WaybillPage({
  params,
  searchParams,
}: PageProps<"/distribution/plan/[destination]">) {
  const user = await requireUser();
  const destination = decodeURIComponent((await params).destination);
  const query = await searchParams;
  const d = await loadDistribution();
  if (!d.destinations.includes(destination)) notFound();
  const { region, tsm } = parseDestination(destination);
  const units = tsm ? sumUnits(d.tsms.get(region)?.get(tsm)) : sumUnits(d.regions.get(destination));
  const lines = d.plans
    .map((p) => ({ item: p.item, ...remainder(p, destination, d.shipments) }))
    .filter((l) => l.planned > 0 || l.shipped > 0 || l.viaTsm > 0);
  const total = (key: "planned" | "shipped" | "viaTsm" | "toSend") =>
    lines.reduce((s, l) => s + l[key], 0);
  // A region's waybill shows what its TSMs got straight from the central warehouse.
  const viaTsm = !tsm && total("viaTsm") > 0;
  const error = typeof query.error === "string" ? query.error : null;

  return (
    <div className="flex flex-col gap-4 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/distribution/plan" className="text-muted-foreground text-sm hover:underline">
          {t("dist.waybill.back")}
        </Link>
        <PrintButton />
      </div>
      <Card className="gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{t("dist.waybill.title", { destination })}</h2>
          <p className="text-muted-foreground text-sm">
            {t("dist.waybill.units", { count: fmt(units) })}
          </p>
        </div>
        {typeof query.done === "string" && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400 print:hidden">
            {t("dist.waybill.done", { count: query.done })}
          </p>
        )}
        {error && (
          <p className="text-destructive text-sm print:hidden">
            {t(`dist.errors.${error}` as TranslationKey)}
          </p>
        )}
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="px-2 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">{t("dist.waybill.posm")}</th>
                <th className="px-2 py-2 font-medium">{t("dist.waybill.category")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("dist.waybill.planned")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("dist.waybill.shipped")}</th>
                {viaTsm && (
                  <th className="px-2 py-2 text-right font-medium">{t("dist.waybill.viaTsm")}</th>
                )}
                <th className="px-2 py-2 text-right font-medium">{t("dist.waybill.toSend")}</th>
                <th className="hidden px-2 py-2 font-medium print:table-cell">
                  {t("dist.waybill.received")}
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.item.id} className="border-b last:border-b-0">
                  <td className="text-muted-foreground px-2 py-2">{i + 1}</td>
                  <td className="px-2 py-2">{l.item.name}</td>
                  <td className="text-muted-foreground px-2 py-2">{l.item.category}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(l.planned)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    <N value={l.shipped} />
                  </td>
                  {viaTsm && (
                    <td className="px-2 py-2 text-right tabular-nums">
                      <N value={l.viaTsm} />
                    </td>
                  )}
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">
                    {fmt(l.toSend)}
                  </td>
                  <td className="hidden w-40 border-l px-2 py-2 print:table-cell" />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-semibold">
                <td className="px-2 py-2" colSpan={3}>
                  {t("dist.total")}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(total("planned"))}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(total("shipped"))}</td>
                {viaTsm && (
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(total("viaTsm"))}</td>
                )}
                <td className="px-2 py-2 text-right tabular-nums">{fmt(total("toSend"))}</td>
                <td className="hidden print:table-cell" />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      {viaTsm && (
        <p className="text-muted-foreground text-xs print:hidden">{t("dist.waybill.viaTsmHint")}</p>
      )}
      {total("toSend") > 0 ? (
        <div className="bg-card rounded-2xl border p-4 print:hidden">
          <ConfirmAction
            label={t("dist.waybill.ship")}
            title={t("dist.waybill.shipTitle", { destination })}
            hint={t("dist.waybill.shipHint", { count: fmt(total("toSend")) })}
            confirm={t("dist.waybill.shipConfirm")}
            action={shipWaybillAction}
            hidden={{ destination, orderId: d.order?.id ?? "" }}
            tone="default"
            size="default"
          >
            {lines
              .filter((l) => l.toSend > 0)
              .map((l) => (
                <span key={l.item.id} hidden>
                  <input type="hidden" name="posmId" value={l.item.id} />
                  <input type="hidden" name="quantity" value={l.toSend} />
                </span>
              ))}
            <label className="flex flex-col gap-1 text-sm">
              {t("dist.waybill.date")}
              <Input
                type="date"
                name="shippedOn"
                defaultValue={await getUserToday(user.id)}
                required
              />
            </label>
          </ConfirmAction>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm print:hidden">{t("dist.waybill.nothing")}</p>
      )}
    </div>
  );
}
