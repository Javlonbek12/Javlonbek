import { Badge } from "@/components/ui/badge";
import type { PlanogramStatus } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const COLORS: Record<PlanogramStatus, string> = {
  DRAFT: "bg-secondary text-secondary-foreground",
  PENDING_APPROVAL: "bg-amber-100 text-amber-900",
  APPROVED: "bg-emerald-100 text-emerald-900",
  ARCHIVED: "bg-muted text-muted-foreground",
};

export function PlanogramStatusBadge({ status }: { status: PlanogramStatus }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", COLORS[status])}>
      {t(`planograms.status.${status}`)}
    </Badge>
  );
}
