import { OrderPicker } from "@/components/distribution/order-picker";
import { DistributionTabs } from "@/components/distribution/tabs";
import { dateFormat, t } from "@/lib/i18n";
import { requireModule } from "@/modules/core/access/guard";
import { canManageDistribution, currentOrder, listOrders } from "@/modules/distribution/service";

import { pickOrderAction } from "./actions";

export default async function DistributionLayout({ children }: LayoutProps<"/distribution">) {
  const user = await requireModule("distribution");
  const orders = await listOrders();
  const order = await currentOrder(orders);
  const day = dateFormat({ dateStyle: "medium", timeZone: "UTC" });
  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex flex-col gap-1 print:hidden">
        <h1 className="text-[22px] font-medium md:text-2xl">{t("dist.title")}</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">{t("dist.intro")}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DistributionTabs manage={canManageDistribution(user)} />
        {order && (
          <OrderPicker
            action={pickOrderAction}
            current={order.id}
            orders={orders.map((o) => ({
              id: o.id,
              label: `${o.name}${o.orderedOn ? ` · ${day.format(o.orderedOn)}` : ""}${o.closed ? ` · ${t("dist.orders.closed")}` : ""}`,
            }))}
          />
        )}
      </div>
      {children}
    </div>
  );
}
