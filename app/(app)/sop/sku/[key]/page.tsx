import { SopEmpty } from "@/components/sop/empty";
import { SkuCardView } from "@/components/sop/sku-card";
import { Card, CardDescription } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { skuHref, skuKeyOf } from "@/modules/sop/links";
import { loadSopData } from "@/modules/sop/load";
import { skuCard } from "@/modules/sop/sku";

import { markSopFindingAction } from "../../actions";

// One SKU of the upload on screen.
export default async function SopSkuPage({ params }: PageProps<"/sop/sku/[key]">) {
  const user = await requireUser();
  const [data, { timezone }, { key }] = await Promise.all([
    loadSopData(),
    getSettings(user.id),
    params,
  ]);
  const { report, upload } = data;
  if (!report || !upload) return <SopEmpty broken={data.broken} />;
  const skuKey = skuKeyOf(key);
  const card = skuKey ? skuCard(report, skuKey) : null;
  if (!card || !skuKey)
    return (
      <Card>
        <CardDescription>{t("sop.sku.notFound")}</CardDescription>
      </Card>
    );
  return (
    <SkuCardView
      card={card}
      settings={data.settings}
      marks={data.marks}
      cycle={upload.cycle}
      back={skuHref(skuKey)}
      markAction={markSopFindingAction}
      timeZone={timezone}
    />
  );
}
