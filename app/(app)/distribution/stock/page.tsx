import { FileText, Trash2 } from "lucide-react";
import Link from "next/link";

import { Section } from "@/components/connect/parts";
import { NoList } from "@/components/distribution/no-list";
import { fmt, Matrix, N } from "@/components/distribution/parts";
import { ShipmentForm } from "@/components/distribution/shipment-form";
import { AutoSubmitForm } from "@/components/ui/auto-submit-form";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay, toDateString } from "@/lib/dates";
import { t, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { displayName } from "@/modules/core/users/display-name";
import { getUserToday } from "@/modules/core/settings/service";
import { remainder, shippingRows, type ShippingRow } from "@/modules/distribution/compute";
import { canManageDistribution, loadDistribution } from "@/modules/distribution/service";
import { destinationLabel, parseDestination, regionLabel } from "@/modules/distribution/types";

import { addShipmentAction, deleteShipmentAction } from "../actions";

const FILTERS = ["all", "left", "over"] as const;
type Filter = (typeof FILTERS)[number];

// Shipments on one screen: who still needs what (each region and TSM with its plan, what went
// there and what is left, and its waybill), a single line typed in, the central warehouse and
// the log grouped by waybill.
export default async function DistributionStockPage({
  searchParams,
}: PageProps<"/distribution/stock">) {
  const user = await requireUser();
  const query = await searchParams;
  const d = await loadDistribution();
  if (d.items.length === 0) return <NoList order={d.order} />;
  const manage = canManageDistribution(user);
  const q = (key: string) => (typeof query[key] === "string" ? String(query[key]) : "");
  const filter: Filter = (FILTERS as readonly string[]).includes(q("show"))
    ? (q("show") as Filter)
    : "all";
  const to = d.destinations.includes(q("to")) ? q("to") : "";
  const error = q("error") || null;
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

  const rows = shippingRows(d.plans, d.shipments, d.destinations);
  const shown = rows.filter((r) =>
    filter === "left" ? r.left > 0 : filter === "over" ? r.over : true,
  );
  const regionRows = rows.filter((r) => r.tsm === null);
  const href = (next: { show?: Filter; to?: string }) => {
    const params = new URLSearchParams();
    const show = next.show ?? filter;
    const dest = next.to ?? to;
    if (show !== "all") params.set("show", show);
    if (dest) params.set("to", dest);
    const text = params.toString();
    return `/distribution/stock${text ? `?${text}` : ""}`;
  };

  // What the plan still leaves for every item and place: the form shows it as you choose.
  const left: Record<string, number> = {};
  for (const p of d.plans)
    for (const dest of d.destinations)
      left[`${p.item.id}\n${dest}`] = remainder(p, dest, d.shipments).toSend;
  const tsms = d.destinations.filter((dest) => parseDestination(dest).tsm !== null);
  const regions = d.destinations.filter((dest) => parseDestination(dest).tsm === null);

  // The log: one group per waybill, or per day, place and person for lines typed one by one.
  const logged = d.shipments.filter((s) => !to || s.destination === to);
  const groups = new Map<string, typeof logged>();
  for (const s of logged) {
    const key =
      s.waybill !== null
        ? `w${s.waybill}`
        : `${toDateString(s.shippedOn)}|${s.destination}|${s.createdById}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const shippedTo = (destination: string, posmId: string) =>
    sum(
      d.shipments
        .filter((s) => s.destination === destination && s.posmId === posmId)
        .map((s) => s.quantity),
    );
  const used = d.destinations.filter((dest) => d.shipments.some((s) => s.destination === dest));

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      {(query.added || query.deleted) && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {query.added ? t("dist.stock.added") : t("dist.stock.deleted")}
        </p>
      )}
      {error && error !== "overPlan" && (
        <p className="text-destructive text-sm">{t(`dist.errors.${error}` as TranslationKey)}</p>
      )}

      <Section title={t("dist.shipping.title")} hint={t("dist.shipping.hint")}>
        <nav className="flex flex-wrap gap-1 text-sm">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={href({ show: f })}
              aria-current={filter === f ? "true" : undefined}
              className={cn(
                "rounded-full border px-3 py-1",
                filter === f && "bg-primary text-primary-foreground border-primary",
              )}
            >
              {t(
                f === "all"
                  ? "dist.shipping.filterAll"
                  : f === "left"
                    ? "dist.shipping.filterLeft"
                    : "dist.shipping.filterOver",
              )}
            </Link>
          ))}
        </nav>
        {shown.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("dist.shipping.none")}</p>
        ) : (
          <>
            {/* Phone: one card per place, the waybill a full button. */}
            <ul className="flex flex-col gap-2 md:hidden">
              {shown.map((r) => (
                <li
                  key={r.destination}
                  className={cn("flex flex-col gap-2 rounded-xl border p-3", r.tsm && "ml-3")}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 font-medium break-words">
                      {r.tsm ?? regionLabel(r.destination)}
                    </span>
                    <StatusChip row={r} />
                  </div>
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {t("dist.shipping.card", {
                      planned: fmt(r.planned),
                      shipped: fmt(r.shipped),
                      left: fmt(r.left),
                    })}
                  </span>
                  <WaybillButton destination={r.destination} />
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Matrix
                head={[
                  t("dist.shipping.destination"),
                  t("dist.shipping.planned"),
                  t("dist.shipping.shipped"),
                  t("dist.shipping.left"),
                  t("dist.shipping.status"),
                  "",
                ]}
                text={[4]}
                rows={shown.map((r) => ({
                  key: r.destination,
                  cells: [
                    r.tsm ? (
                      <span key="d" className="pl-4">
                        {r.tsm}
                      </span>
                    ) : (
                      <strong key="d">{regionLabel(r.destination)}</strong>
                    ),
                    fmt(r.planned),
                    <N key="s" value={r.shipped} />,
                    <strong key="l">{fmt(r.left)}</strong>,
                    <StatusChip key="st" row={r} />,
                    <WaybillButton key="w" destination={r.destination} />,
                  ],
                }))}
                foot={
                  filter === "all"
                    ? [
                        t("dist.shipping.total"),
                        fmt(sum(regionRows.map((r) => r.planned))),
                        fmt(sum(regionRows.map((r) => r.shipped))),
                        fmt(sum(regionRows.map((r) => r.left))),
                        "",
                        "",
                      ]
                    : undefined
                }
              />
            </div>
          </>
        )}
      </Section>

      <div id="add" className="scroll-mt-24">
        <Section title={t("dist.stock.add")}>
          <ShipmentForm
            action={addShipmentAction}
            items={d.items.map((i) => ({ id: i.id, name: i.name }))}
            tsms={tsms}
            regions={regions}
            labels={Object.fromEntries(
              d.destinations.map((dest) => [dest, destinationLabel(dest)]),
            )}
            left={left}
            values={{
              posmId: q("posmId"),
              destination: d.destinations.includes(q("destination")) ? q("destination") : "",
              quantity: q("quantity"),
              shippedOn: q("shippedOn") || (await getUserToday(user.id)),
              note: q("note"),
              overPlan: q("overPlan") === "1",
            }}
            error={error === "overPlan" ? t("dist.errors.overPlan") : undefined}
          />
        </Section>
      </div>

      <Section title={t("dist.stock.title")} hint={t("dist.stock.hint")}>
        <Matrix
          head={[
            t("dist.stock.posm"),
            t("dist.stock.available"),
            t("dist.stock.planned"),
            t("dist.stock.shipped"),
            t("dist.stock.onHand"),
            t("dist.stock.toSend"),
          ]}
          rows={d.stock.map((s) => ({
            key: s.item.id,
            cells: [
              s.item.name,
              fmt(s.available),
              fmt(s.planned),
              <N key="s" value={s.shipped} />,
              <strong key="h">{fmt(s.onHand)}</strong>,
              <N key="t" value={s.toSend} />,
            ],
          }))}
          foot={[
            t("dist.total"),
            fmt(sum(d.stock.map((s) => s.available))),
            fmt(sum(d.stock.map((s) => s.planned))),
            fmt(sum(d.stock.map((s) => s.shipped))),
            fmt(sum(d.stock.map((s) => s.onHand))),
            fmt(sum(d.stock.map((s) => s.toSend))),
          ]}
        />
        {used.length > 0 && (
          <details>
            <summary className="text-primary cursor-pointer text-sm">
              {t("dist.shipping.byItem")}
            </summary>
            <Matrix
              dense
              head={[t("dist.stock.posm"), ...used.map((dest) => destinationLabel(dest))]}
              rows={d.items
                .filter((i) => used.some((dest) => shippedTo(dest, i.id) > 0))
                .map((i) => ({
                  key: i.id,
                  cells: [
                    i.name,
                    ...used.map((dest) => <N key={dest} value={shippedTo(dest, i.id)} />),
                  ],
                }))}
            />
          </details>
        )}
      </Section>

      <div id="history" className="scroll-mt-24">
        <Section title={t("dist.stock.history")}>
          {used.length > 0 && (
            // The choice applies at once; the page keeps its scroll, so the journal stays in view.
            <AutoSubmitForm action="/distribution/stock" className="flex flex-wrap items-end gap-2">
              {filter !== "all" && <input type="hidden" name="show" value={filter} />}
              <label className="flex min-w-0 flex-col gap-1 text-sm">
                {t("dist.shipping.journalFilter")}
                <NativeSelect name="to" defaultValue={to}>
                  <option value="">{t("dist.shipping.journalAll")}</option>
                  {used.map((dest) => (
                    <option key={dest} value={dest}>
                      {destinationLabel(dest)}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </AutoSubmitForm>
          )}
          {groups.size === 0 ? (
            <p className="text-muted-foreground text-sm">{t("dist.stock.empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-xl border">
              {[...groups.values()].slice(0, 100).map((lines) => {
                const first = lines[0]!;
                return (
                  <li key={first.id}>
                    <details className="group">
                      <summary className="hover:bg-accent/40 flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                        <span className="tabular-nums">
                          {formatDay(toDateString(first.shippedOn))}
                        </span>
                        <span className="min-w-0 font-medium break-words">
                          {destinationLabel(first.destination)}
                        </span>
                        {first.waybill !== null ? (
                          <Link
                            href={`/distribution/plan/${encodeURIComponent(first.destination)}?n=${first.waybill}`}
                            className="text-primary underline underline-offset-2"
                          >
                            {t("dist.shipping.waybillShort", { number: first.waybill })}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            {t("dist.shipping.single")}
                          </span>
                        )}
                        <span className="text-muted-foreground text-xs">
                          {t("dist.waybill.lines", {
                            count: lines.length,
                            pieces: fmt(sum(lines.map((l) => l.quantity))),
                          })}
                        </span>
                        <span className="text-muted-foreground ml-auto text-xs">
                          {displayName(first.createdBy)}
                        </span>
                      </summary>
                      <ul className="bg-muted/30 flex flex-col gap-1 px-3 py-2 text-sm">
                        {lines.map((s) => (
                          <li key={s.id} className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 break-words">
                              {s.posm.name}
                              {s.note && (
                                <span className="text-muted-foreground block text-xs">
                                  {s.note}
                                </span>
                              )}
                            </span>
                            <span className="tabular-nums">{fmt(s.quantity)}</span>
                            {manage || s.createdById === user.id ? (
                              <ConfirmAction
                                label={<span className="sr-only">{t("dist.stock.delete")}</span>}
                                icon={<Trash2 className="size-4" />}
                                title={t("dist.stock.deleteTitle")}
                                hint={t("dist.stock.deleteHint")}
                                confirm={t("dist.stock.deleteConfirm")}
                                action={deleteShipmentAction}
                                hidden={{ id: s.id }}
                                align="right"
                                floating
                              />
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function StatusChip({ row }: { row: ShippingRow }) {
  return (
    <span className="flex flex-wrap gap-1">
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-xs whitespace-nowrap",
          row.status === "done"
            ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
            : row.status === "partial"
              ? "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300"
              : "bg-muted text-muted-foreground",
        )}
      >
        {t(`dist.shipping.statuses.${row.status}`)}
      </span>
      {row.over && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs whitespace-nowrap text-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {t("dist.shipping.over")}
        </span>
      )}
    </span>
  );
}

function WaybillButton({ destination }: { destination: string }) {
  return (
    <Button asChild size="sm" variant="outline" className="self-start">
      <Link href={`/distribution/plan/${encodeURIComponent(destination)}`}>
        <FileText />
        {t("dist.shipping.waybill")}
      </Link>
    </Button>
  );
}
