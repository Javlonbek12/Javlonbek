import { OrderPicker } from "@/components/distribution/order-picker";
import { DistributionTabs } from "@/components/distribution/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { dateFormat, t } from "@/lib/i18n";
import { requireModule } from "@/modules/core/access/guard";
import {
  canManageDistribution,
  currentOrder,
  listOrders,
  orderStageOf,
} from "@/modules/distribution/service";

import { pickOrderAction } from "./actions";

export default async function DistributionLayout({ children }: LayoutProps<"/distribution">) {
  const user = await requireModule("distribution");
  const orders = await listOrders();
  const order = await currentOrder(orders);
  const day = dateFormat({ dateStyle: "medium", timeZone: "UTC" });
  // A draft opens by default only when nothing was ordered: say so, or its numbers read as real.
  const draftOnly =
    order && orderStageOf(order) === "draft" && !orders.some((o) => orderStageOf(o) === "running");
  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <PageHeader
        title={t("dist.title")}
        hint={t("dist.intro")}
        hintClassName="max-w-3xl"
        className="print:hidden"
      />
      <DistributionTabs manage={canManageDistribution(user)} />
      {order && (
        <OrderPicker
          action={pickOrderAction}
          current={order.id}
          note={draftOnly ? t("dist.orders.draftOnly", { name: order.name }) : undefined}
          orders={orders.map((o) => ({
            id: o.id,
            stage: orderStageOf(o),
            label: `${o.name}${o.orderedOn ? ` · ${day.format(o.orderedOn)}` : ""}`,
          }))}
        />
      )}
      {children}
    </div>
  );
}
