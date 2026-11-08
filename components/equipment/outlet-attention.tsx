import { Download, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { reviewCount, type OutletReview } from "@/modules/distribution/control";

// On the map: outlets someone has to fix in the outlet base or the file, with the way to the list
// and an Excel to send to whoever keeps the base. Nothing when all is in order.
export function OutletAttention({ review }: { review: OutletReview }) {
  if (reviewCount(review) === 0) return null;
  const parts = [
    review.missing.length > 0 && t("equip.attention.missing", { count: review.missing.length }),
    review.noId.length > 0 && t("equip.attention.noId", { count: review.noId.length }),
    review.skipped.length > 0 && t("equip.attention.skipped", { count: review.skipped.length }),
    review.mismatches.length > 0 &&
      t("equip.attention.mismatches", { count: review.mismatches.length }),
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/60 bg-amber-500/5 px-3 py-2 text-sm">
      <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="min-w-0 flex-1 basis-60">
        <span className="font-medium">{t("equip.attention.title")}</span> {parts.join(" · ")}
      </span>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href="/equipment/outlets">{t("equip.attention.open")}</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href="/api/distribution/outlet-review">
            <Download />
            {t("equip.attention.excel")}
          </a>
        </Button>
      </div>
    </div>
  );
}
