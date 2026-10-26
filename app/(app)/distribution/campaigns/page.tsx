import Link from "next/link";

import { Section } from "@/components/connect/parts";
import { fmt, Matrix } from "@/components/distribution/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/db";
import { dateFormat, t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { canManageDistribution, currentOrder, listOrders } from "@/modules/distribution/service";

import {
  createCampaignAction,
  createOrderAction,
  deleteOrderAction,
  importPosmAction,
  setOrderClosedAction,
} from "../actions";

const XLSX = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// POSM campaigns: each one goes from the concept to the replacement in the shops (its own page).
// Old campaigns keep their list, plan and shipments.
export default async function DistributionCampaignsPage({
  searchParams,
}: PageProps<"/distribution/campaigns">) {
  const user = await requireUser();
  const manage = canManageDistribution(user);
  const query = await searchParams;
  const [orders, projects] = await Promise.all([
    listOrders(),
    manage
      ? db.project.findMany({
          where: { archived: false },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
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
            text={[1, 4, 5]}
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
                <Link
                  key="n"
                  href={`/distribution/campaigns/${o.id}`}
                  className="flex flex-col hover:underline"
                >
                  <span className={o.id === current?.id ? "font-semibold" : "font-medium"}>
                    {o.name}
                  </span>
                  {(o.description || o.note) && (
                    <span className="text-muted-foreground line-clamp-1 text-xs">
                      {o.description || o.note}
                    </span>
                  )}
                </Link>,
                o.orderedOn ? day.format(o.orderedOn) : "—",
                fmt(o.items),
                fmt(o.shipped),
                o.closed
                  ? t("dist.orders.closed")
                  : o.orderedOn
                    ? t("dist.orders.orderedState")
                    : t("dist.orders.preparing"),
                <span key="a" className="flex flex-wrap items-center gap-2">
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

      {manage && (
        <Section title={t("dist.orders.new")} hint={t("dist.orders.newHint")}>
          <form action={createCampaignAction} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                {t("dist.orders.name")}
                <Input name="name" required maxLength={120} placeholder="Pine Purple 4 SKU" />
              </label>
              {projects.length > 0 && (
                <label className="flex flex-col gap-1 text-sm">
                  {t("dist.campaign.project")}
                  <NativeSelect name="projectId" defaultValue="">
                    <option value="">—</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              )}
            </div>
            <label className="flex flex-col gap-1 text-sm">
              {t("dist.campaign.description")}
              <Textarea name="description" rows={2} maxLength={2000} />
            </label>
            <div>
              <Button type="submit">{t("dist.orders.create")}</Button>
            </div>
          </form>

          <details className="border-t pt-3">
            <summary className="text-muted-foreground cursor-pointer text-sm">
              {t("dist.orders.other")}
            </summary>
            <div className="mt-3 flex flex-col gap-4">
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
                  <Button type="submit" variant="outline">
                    {t("dist.orders.create")}
                  </Button>
                </div>
              </form>
              {open.length > 0 && (
                <form
                  action={importPosmAction}
                  className="flex flex-wrap items-end gap-3 border-t pt-3"
                >
                  <label className="flex flex-col gap-1 text-sm">
                    {t("dist.orders.updateTitle")}
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
                  <Button type="submit" variant="outline">
                    {t("dist.orders.upload")}
                  </Button>
                </form>
              )}
            </div>
          </details>
        </Section>
      )}
    </div>
  );
}
