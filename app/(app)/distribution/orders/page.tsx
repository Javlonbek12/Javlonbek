import Link from "next/link";

import { Section } from "@/components/connect/parts";
import { fmt, Matrix } from "@/components/distribution/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { dateFormat, t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { canManageDistribution, currentOrder, listOrders } from "@/modules/distribution/service";

import {
  createOrderAction,
  deleteOrderAction,
  importPosmAction,
  pickOrderAction,
  setOrderClosedAction,
} from "../actions";

const XLSX = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// POSM orders are versions of the list: old orders keep their items, plan and shipments; a new
// order comes from a POSM list file or from the previous order.
export default async function DistributionOrdersPage({
  searchParams,
}: PageProps<"/distribution/orders">) {
  const user = await requireUser();
  const manage = canManageDistribution(user);
  const query = await searchParams;
  const orders = await listOrders();
  const current = await currentOrder(orders);
  const day = dateFormat({ dateStyle: "medium", timeZone: "UTC" });
  const error = typeof query.error === "string" ? query.error : null;
  const done =
    query.created !== undefined
      ? t("dist.orders.created")
      : typeof query.posm === "string"
        ? t("dist.orders.posmDone", { count: query.posm })
        : query.deleted !== undefined
          ? t("dist.orders.deleted")
          : query.posmDeleted !== undefined
            ? t("dist.orders.posmDeleted")
            : null;
  const open = orders.filter((o) => !o.closed);

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      {done && <p className="text-sm text-emerald-700 dark:text-emerald-400">{done}</p>}
      {error && (
        <p className="text-destructive text-sm">{t(`dist.errors.${error}` as TranslationKey)}</p>
      )}

      <Section title={t("dist.orders.title")} hint={t("dist.orders.hint")}>
        {orders.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("dist.orders.empty")}</p>
        ) : (
          <Matrix
            text={[1, 5]}
            head={[
              t("dist.orders.name"),
              t("dist.orders.date"),
              t("dist.orders.items"),
              t("dist.orders.shipped"),
              t("dist.orders.status"),
              "",
            ]}
            rows={orders.map((o) => ({
              key: o.id,
              muted: o.closed,
              cells: [
                <span key="n" className="flex flex-col">
                  <span className={o.id === current?.id ? "font-semibold" : ""}>{o.name}</span>
                  {o.note && <span className="text-muted-foreground text-xs">{o.note}</span>}
                </span>,
                day.format(o.orderedOn),
                fmt(o.items),
                fmt(o.shipped),
                o.closed ? t("dist.orders.closed") : t("dist.orders.openState"),
                <span key="a" className="flex flex-wrap items-center gap-2">
                  {o.id !== current?.id && (
                    <form action={pickOrderAction}>
                      <input type="hidden" name="orderId" value={o.id} />
                      <input type="hidden" name="back" value="/distribution" />
                      <Button type="submit" size="sm" variant="outline">
                        {t("dist.orders.open")}
                      </Button>
                    </form>
                  )}
                  {manage && (
                    <form action={setOrderClosedAction}>
                      <input type="hidden" name="orderId" value={o.id} />
                      <input type="hidden" name="closed" value={o.closed ? "0" : "1"} />
                      <Button type="submit" size="sm" variant="ghost">
                        {o.closed ? t("dist.orders.reopen") : t("dist.orders.close")}
                      </Button>
                    </form>
                  )}
                  {manage && o.shipped === 0 && (
                    <form action={deleteOrderAction}>
                      <input type="hidden" name="orderId" value={o.id} />
                      <Button type="submit" size="sm" variant="ghost" className="text-destructive">
                        {t("dist.orders.delete")}
                      </Button>
                    </form>
                  )}
                </span>,
              ],
            }))}
          />
        )}
      </Section>

      {manage && open.length > 0 && (
        <Section title={t("dist.orders.updateTitle")} hint={t("dist.orders.updateHint")}>
          <form action={importPosmAction} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t("dist.orders.order")}
              <NativeSelect
                name="orderId"
                defaultValue={current && !current.closed ? current.id : open[0]!.id}
              >
                {open.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("dist.orders.file")}
              <Input type="file" name="file" required accept={XLSX} />
            </label>
            <Button type="submit">{t("dist.orders.upload")}</Button>
          </form>
        </Section>
      )}

      {manage && (
        <Section title={t("dist.orders.new")} hint={t("dist.orders.newHint")}>
          <form action={createOrderAction} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.orders.name")}
                <Input
                  name="name"
                  required
                  maxLength={120}
                  defaultValue={t("dist.orders.defaultName", { n: orders.length + 1 })}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.orders.date")}
                <Input
                  type="date"
                  name="orderedOn"
                  required
                  defaultValue={await getUserToday(user.id)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                {t("dist.orders.note")}
                <Input name="note" maxLength={500} />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.orders.fromFile")}
                <Input type="file" name="file" accept={XLSX} />
              </label>
              {orders.length > 0 && (
                <label className="flex flex-col gap-1 text-sm">
                  {t("dist.orders.copyFrom")}
                  <NativeSelect name="copyFrom" defaultValue={current?.id ?? ""}>
                    <option value="">—</option>
                    {orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              )}
            </div>
            <p className="text-muted-foreground text-xs">{t("dist.orders.sourceHint")}</p>
            <div>
              <Button type="submit">{t("dist.orders.create")}</Button>
            </div>
          </form>
        </Section>
      )}

      {!manage && orders.length > 0 && (
        <p className="text-muted-foreground text-sm">
          <Link href="/distribution" className="hover:underline">
            {t("dist.posm.back")}
          </Link>
        </p>
      )}
    </div>
  );
}
