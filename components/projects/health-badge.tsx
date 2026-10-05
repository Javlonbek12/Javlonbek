import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Health } from "@/modules/projects/progress";

const STYLES: Record<Health, string> = {
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  onTrack: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  risk: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  late: "bg-destructive/15 text-destructive",
  empty: "bg-muted text-muted-foreground",
};

export function HealthBadge({ health }: { health: Health }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        STYLES[health],
      )}
    >
      {t(`projects.health.${health}`)}
    </span>
  );
}
