import { ClipboardList } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { t } from "@/lib/i18n";

// Instead of tables of zeros: the campaign has no POSM list yet (or there is no campaign), and
// where to make one.
export function NoList({ order }: { order: { id: string; name: string } | null }) {
  return (
    <Card className="items-start gap-3">
      <p className="text-sm">
        {order ? t("dist.orders.noList", { name: order.name }) : t("dist.empty")}
      </p>
      <Button asChild size="sm" variant="outline">
        <Link href={order ? `/distribution/campaigns/${order.id}#list` : "/distribution/campaigns"}>
          <ClipboardList />
          {order ? t("dist.orders.openList") : t("dist.tabs.orders")}
        </Link>
      </Button>
    </Card>
  );
}
