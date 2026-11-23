import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { trendTone, type Change } from "@/modules/connect/trend";

// A share against the previous period: ▲ / ▼ and the difference in percentage points, green when
// it got better and red when worse (for some shares lower is better). Nothing when there is no
// number to compare with.
export function Trend({
  change,
  lowerIsBetter = false,
  className,
}: {
  change: Change | undefined;
  lowerIsBetter?: boolean;
  className?: string;
}) {
  if (!change) return null;
  const tone = trendTone(change.delta, lowerIsBetter);
  const arrow = change.delta > 0 ? "▲" : change.delta < 0 ? "▼" : "";
  return (
    <span
      title={t("connect.trend.was", { value: change.was })}
      className={cn(
        "text-xs font-medium whitespace-nowrap tabular-nums",
        tone === "better" && "text-emerald-700 dark:text-emerald-400",
        tone === "worse" && "text-red-600 dark:text-red-400",
        tone === "same" && "text-muted-foreground",
        className,
      )}
    >
      {arrow} {Math.abs(change.delta)} {t("connect.trend.pp")}
    </span>
  );
}
