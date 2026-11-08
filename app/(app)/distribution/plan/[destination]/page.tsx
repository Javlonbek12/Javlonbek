import { FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { fmt } from "@/components/distribution/parts";
import { PrintButton } from "@/components/distribution/print-button";
import { WaybillLines } from "@/components/distribution/waybill-lines";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { t, type TranslationKey } from "@/lib/i18n";
import { formatDate } from "@/lib/time";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { remainder, sumUnits } from "@/modules/distribution/compute";
import { loadDistribution, loadWaybill, waybillsTo } from "@/modules/distribution/service";
import { parseDestination } from "@/modules/distribution/types";

import { shipWaybillAction } from "../../actions";

// The waybill of a region or one of its TSMs. Being prepared: what is left to send, the quantities
// can be lowered for a partial shipment, and recording it gives it a number. Recorded (?n=12): the
// document to print and send with the POSM — number, date, campaign, lines, signatures. A region's
// share covers its TSMs: what went straight to them is not sent to the region again.
export default async function WaybillPage({
  params,
  searchParams,
}: PageProps<"/distribution/plan/[destination]">) {
  const user = await requireUser();
  const destination = decodeURIComponent((await params).destination);
  const query = await searchParams;
  const number = typeof query.n === "string" ? Number(query.n) : null;
  const error = typeof query.error === "string" ? query.error : null;

  const toolbar = (extra?: ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
      <Link href="/distribution/stock" className="text-muted-foreground text-sm hover:underline">
        {t("dist.waybill.backShipping")}
      </Link>
      <div className="flex flex-wrap gap-2">
        {extra}
        <PrintButton />
      </div>
    </div>
  );

  if (number !== null) {
    const waybill = Number.isInteger(number) ? await loadWaybill(number) : null;
    if (!waybill) notFound();
    const total = waybill.lines.reduce((s, l) => s + l.quantity, 0);
    return (
      <div className="flex flex-col gap-4 [&>*]:min-w-0">
        <PrintPage />
        {toolbar(
          <Button asChild variant="outline" size="sm">
            <Link href={`/distribution/plan/${encodeURIComponent(waybill.destination)}`}>
              <FileText />
              {t("dist.waybill.newOne")}
            </Link>
          </Button>,
        )}
        {typeof query.done === "string" && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400 print:hidden">
            {t("dist.waybill.recorded", { number: waybill.number, count: query.done })}
          </p>
        )}
        {waybill.destination !== destination && (
          <p className="text-sm text-amber-700 dark:text-amber-300 print:hidden">
            {t("dist.waybill.notThere")}
          </p>
        )}
        <Document
          title={t("dist.waybill.number", { number: waybill.number })}
          date={t("dist.waybill.dated", { date: formatDate(waybill.shippedOn, "UTC") })}
          campaign={waybill.campaign}
          destination={waybill.destination}
        >
          <div className="-mx-1 overflow-x-auto px-1 print:mx-0 print:overflow-visible print:px-0">
            <table className="w-full text-sm print:text-[11pt]">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs print:text-black">
                  <th className="px-2 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">{t("dist.waybill.posm")}</th>
                  <th className="px-2 py-2 font-medium">{t("dist.waybill.category")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("dist.waybill.quantity")}</th>
                  <th className="hidden w-48 px-2 py-2 font-medium print:table-cell">
                    {t("dist.waybill.received")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {waybill.lines.map((l, i) => (
                  <tr key={l.id} className="border-b last:border-b-0">
                    <td className="text-muted-foreground px-2 py-2">{i + 1}</td>
                    <td className="min-w-40 px-2 py-2">{l.name}</td>
                    <td className="text-muted-foreground px-2 py-2">{l.category}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">
                      {fmt(l.quantity)}
                    </td>
                    <td className="hidden border-l px-2 py-2 print:table-cell" />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="px-2 py-2" colSpan={3}>
                    {t("dist.total")}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(total)}</td>
                  <td className="hidden print:table-cell" />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-muted-foreground text-xs">
            {t("dist.waybill.recordedBy", { name: displayName(waybill.createdBy) })}
          </p>
          <Signatures />
        </Document>
      </div>
    );
  }

  const d = await loadDistribution();
  if (!d.destinations.includes(destination)) notFound();
  const { region, tsm } = parseDestination(destination);
  const units = tsm ? sumUnits(d.tsms.get(region)?.get(tsm)) : sumUnits(d.regions.get(destination));
  const lines = d.plans
    .map((p) => ({
      id: p.item.id,
      name: p.item.name,
      category: p.item.category,
      ...remainder(p, destination, d.shipments),
    }))
    .filter((l) => l.planned > 0 || l.shipped > 0 || l.viaTsm > 0);
  const toSend = lines.reduce((s, l) => s + l.toSend, 0);
  // A region's waybill shows what its TSMs got straight from the central warehouse.
  const viaTsm = !tsm && lines.some((l) => l.viaTsm > 0);
  const history = d.order ? await waybillsTo(destination, d.order.id) : [];

  return (
    <div className="flex flex-col gap-4 [&>*]:min-w-0">
      <PrintPage />
      {toolbar()}
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
      <form action={shipWaybillAction} className="flex flex-col gap-4">
        <input type="hidden" name="destination" value={destination} />
        <input type="hidden" name="orderId" value={d.order?.id ?? ""} />
        <Document
          title={
            <>
              {t("dist.waybill.numberBlank")}{" "}
              <span className="text-muted-foreground text-sm font-normal print:hidden">
                ({t("dist.waybill.numberLater")})
              </span>
            </>
          }
          date={
            <label className="flex flex-wrap items-center gap-2">
              {t("dist.waybill.date")}
              <Input
                type="date"
                name="shippedOn"
                defaultValue={await getUserToday(user.id)}
                required
                className="w-auto print:h-auto print:border-0 print:p-0 print:shadow-none"
              />
            </label>
          }
          campaign={d.order?.name ?? "—"}
          destination={destination}
          note={t("dist.waybill.units", { count: fmt(units) })}
        >
          <WaybillLines lines={lines} viaTsm={viaTsm} />
          {viaTsm && (
            <p className="text-muted-foreground text-xs print:hidden">
              {t("dist.waybill.viaTsmHint")}
            </p>
          )}
          <Signatures />
        </Document>
        {toSend > 0 ? (
          <div className="bg-card flex flex-col items-start gap-2 rounded-2xl border p-4 print:hidden">
            <p className="text-muted-foreground text-sm">{t("dist.waybill.partialHint")}</p>
            <Button type="submit">{t("dist.waybill.record")}</Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm print:hidden">{t("dist.waybill.nothing")}</p>
        )}
      </form>
      {history.length > 0 && (
        <Card className="gap-2 print:hidden">
          <h3 className="text-sm font-semibold">{t("dist.waybill.history")}</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {history.map((w) => (
              <li key={w.number} className="flex flex-wrap items-center gap-x-3">
                <Link
                  href={`/distribution/plan/${encodeURIComponent(destination)}?n=${w.number}`}
                  className="text-primary underline underline-offset-2"
                >
                  {t("dist.waybill.number", { number: w.number })}
                </Link>
                <span className="text-muted-foreground">
                  {t("dist.waybill.dated", { date: formatDate(w.shippedOn, "UTC") })} ·{" "}
                  {t("dist.waybill.lines", { count: w.lines, pieces: fmt(w.pieces) })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// A waybill prints on one A4 sheet turned sideways, so the receiver's column fits; the app's
// menus are hidden by the global print rules.
function PrintPage() {
  return <style>{"@page { size: A4 landscape; margin: 12mm; }"}</style>;
}

function Document({
  title,
  date,
  campaign,
  destination,
  note,
  children,
}: {
  title: ReactNode;
  date: ReactNode;
  campaign: string;
  destination: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-4 print:gap-3 print:border-0 print:p-0 print:shadow-none">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="text-sm">{date}</div>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground print:text-black">{t("dist.waybill.campaign")}</dt>
        <dd className="font-medium break-words">{campaign}</dd>
        <dt className="text-muted-foreground print:text-black">{t("dist.waybill.to")}</dt>
        <dd className="font-medium break-words">
          {destination}
          {note && (
            <span className="text-muted-foreground ml-2 font-normal print:hidden">{note}</span>
          )}
        </dd>
      </dl>
      {children}
    </Card>
  );
}

// Who handed the POSM over and who took it: lines to sign on paper.
function Signatures() {
  return (
    <div className="hidden grid-cols-2 gap-12 pt-8 text-sm print:grid">
      {(["issued", "receivedBy"] as const).map((key) => (
        <div key={key} className="flex flex-col gap-1">
          <span>{t(`dist.waybill.${key}`)}</span>
          <span className="mt-6 border-b border-black" />
          <span className="text-xs">{t("dist.waybill.signature")}</span>
        </div>
      ))}
    </div>
  );
}
