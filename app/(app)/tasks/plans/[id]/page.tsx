import Link from "next/link";
import { notFound } from "next/navigation";

import { PlanCard } from "@/components/tasks/plan-card";
import { StatusBadge } from "@/components/tasks/task-badges";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { displayName } from "@/modules/core/users/display-name";
import { getPlanDetail } from "@/modules/tasks/plan-service";

export default async function PlanPage({ params }: PageProps<"/tasks/plans/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await getPlanDetail(user, id);
  if (!detail) notFound();
  const { plan, parent, children, tasks } = detail;

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{t(`plans.level.${plan.level}`)}</Badge>
          <h2 className="text-xl font-semibold">{plan.title}</h2>
        </div>
        <p className="text-muted-foreground text-sm">
          {plan.period}
          {parent && (
            <>
              {" · "}
              <Link className="underline" href={`/tasks/plans/${parent.id}`}>
                {parent.title}
              </Link>
            </>
          )}
        </p>
        <Progress value={plan.progress.percent} />
        <p className="text-sm">{t("plans.progress", plan.progress)}</p>
      </Card>

      {children.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium">{t("plans.children")}</h3>
          {children.map((child) => (
            <PlanCard key={child.id} plan={child} />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-medium">{t("plans.tasks")}</h3>
        {tasks.length === 0 && <p className="text-muted-foreground text-sm">{t("tasks.empty")}</p>}
        {tasks.map((task) => (
          <Link
            key={task.id}
            href={`/tasks/${task.id}`}
            className="bg-card hover:bg-accent/50 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
          >
            <span className="font-medium">{task.title}</span>
            <StatusBadge status={task.status} />
            <span className="text-muted-foreground text-xs">
              {displayName(task.assignee)}
              {task.dueDate && ` · ${formatDay(task.dueDate)}`}
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
}
