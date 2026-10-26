import { Trash2 } from "lucide-react";

import { Section } from "@/components/connect/parts";
import { fmt, Matrix, N, pct } from "@/components/distribution/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay, toDateString } from "@/lib/dates";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { displayName } from "@/modules/core/users/display-name";
import { getUserToday } from "@/modules/core/settings/service";
import { plannedFor } from "@/modules/distribution/compute";
import { canManageDistribution, loadDistribution } from "@/modules/distribution/service";

import { addShipmentAction, deleteShipmentAction } from "../actions";

// The central warehouse: what is available, planned, shipped and still on hand; where the POSM
// went (against the plan of each destination); recording a shipment and the log.
export default async function DistributionStockPage({
  searchParams,
}: PageProps<"/distribution/stock">) {
  const user = await requireUser();
  const query = await searchParams;
  const d = await loadDistribution();
  const manage = canManageDistribution(user);
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const shippedTo = (destination: string, posmId?: string) =>
    sum(
      d.shipments
        .filter((s) => s.destination === destination && (!posmId || s.posmId === posmId))
        .map((s) => s.quantity),
    );
  const used = d.destinations.filter((dest) => shippedTo(dest) > 0);
  const error = typeof query.error === "string" ? query.error : null;

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      {(query.added || query.deleted || error) && (
        <p
          className={
            error ? "text-destructive text-sm" : "text-sm text-emerald-700 dark:text-emerald-400"
          }
        >
          {error
            ? t(`dist.errors.${error}` as TranslationKey)
            : query.added
              ? t("dist.stock.added")
              : t("dist.stock.deleted")}
        </p>
      )}

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
      </Section>

      <Section title={t("dist.stock.add")}>
        <form action={addShipmentAction} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <label className="flex flex-col gap-1 text-sm xl:col-span-2">
            {t("dist.stock.posm")}
            <NativeSelect name="posmId" required>
              {d.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("dist.stock.destination")}
            <NativeSelect name="destination" required>
              {d.destinations.map((dest) => (
                <option key={dest} value={dest}>
                  {dest}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("dist.stock.quantity")}
            <Input type="number" name="quantity" min={1} step={1} required />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("dist.stock.date")}
            <Input
              type="date"
              name="shippedOn"
              defaultValue={await getUserToday(user.id)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("dist.stock.note")}
            <Input name="note" maxLength={200} />
          </label>
          <div className="xl:col-span-6">
            <Button type="submit">{t("dist.stock.save")}</Button>
          </div>
        </form>
      </Section>

      <Section title={t("dist.stock.where")} hint={t("dist.stock.whereHint")}>
        {used.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("dist.stock.empty")}</p>
        ) : (
          <>
            <Matrix
              head={[t("dist.stock.destination"), t("dist.stock.plan"), t("dist.stock.fact"), "%"]}
              rows={used.map((dest) => {
                const plan = sum(d.plans.map((p) => plannedFor(p, dest)));
                const fact = shippedTo(dest);
                return {
                  key: dest,
                  cells: [dest, fmt(plan), fmt(fact), plan ? pct(fact / plan) : "—"],
                };
              })}
            />
            <Matrix
              dense
              head={[t("dist.stock.posm"), ...used]}
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
          </>
        )}
      </Section>

      <Section title={t("dist.stock.history")}>
        {d.shipments.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("dist.stock.empty")}</p>
        ) : (
          <Matrix
            dense
            text={[1, 2, 4]}
            head={[
              t("dist.stock.date"),
              t("dist.stock.posm"),
              t("dist.stock.destination"),
              t("dist.stock.quantity"),
              t("dist.stock.who"),
              "",
            ]}
            rows={d.shipments.slice(0, 200).map((s) => ({
              key: s.id,
              cells: [
                formatDay(toDateString(s.shippedOn)),
                <span key="p" className="whitespace-normal">
                  {s.posm.name}
                  {s.note && <span className="text-muted-foreground block text-xs">{s.note}</span>}
                </span>,
                s.destination,
                fmt(s.quantity),
                <span key="w" className="text-muted-foreground text-xs">
                  {displayName(s.createdBy)}
                </span>,
                manage || s.createdById === user.id ? (
                  <form key="d" action={deleteShipmentAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      aria-label={t("dist.stock.delete")}
                    >
                      <Trash2 />
                    </Button>
                  </form>
                ) : (
                  ""
                ),
              ],
            }))}
          />
        )}
      </Section>
    </div>
  );
}
