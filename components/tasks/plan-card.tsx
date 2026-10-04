import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { PlanWithProgress } from "@/modules/tasks/plan-service";

export function PlanCard({ plan, className }: { plan: PlanWithProgress; className?: string }) {
  return (
    <Link
      href={`/tasks/plans/${plan.id}`}
      className={cn(
        "bg-card hover:bg-accent/50 flex flex-col gap-2 rounded-lg border p-3",
        className,
      )}
    >
      <span className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{t(`plans.level.${plan.level}`)}</Badge>
        <span className="font-medium">{plan.title}</span>
        {plan.title !== plan.period && (
          <span className="text-muted-foreground text-xs">{plan.period}</span>
        )}
        {plan.isPersonal && <Badge variant="outline">{t("tasks.fields.personalShort")}</Badge>}
      </span>
      <Progress value={plan.progress.percent} />
      <span className="text-muted-foreground text-xs">{t("plans.progress", plan.progress)}</span>
    </Link>
  );
}

// Year → months → weeks as an indented tree.
export function PlanTree({
  plans,
  parentId = null,
  depth = 0,
}: {
  plans: PlanWithProgress[];
  parentId?: string | null;
  depth?: number;
}) {
  const level = plans.filter((p) => p.parentId === parentId);
  return (
    <div className={cn("flex flex-col gap-2", depth > 0 && "border-l pl-3 md:pl-5")}>
      {level.map((plan) => (
        <div key={plan.id} className="flex flex-col gap-2">
          <PlanCard plan={plan} />
          {plans.some((p) => p.parentId === plan.id) && (
            <PlanTree plans={plans} parentId={plan.id} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  );
}
