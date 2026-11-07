import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PlanCard } from "@/components/tasks/plan-card";
import { StatusBadge } from "@/components/tasks/task-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { formatDay } from "@/lib/dates";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { displayName } from "@/modules/core/users/display-name";
import { getPlanDetail } from "@/modules/tasks/plan-service";
import { PLAN_LEVELS } from "@/modules/tasks/plans";

import { deletePlanAction, updatePlanAction } from "../../actions";

const summaryClass =
  "hover:bg-accent flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-full px-3 py-1.5 text-sm [&::-webkit-details-marker]:hidden";

export default async function PlanPage({ params, searchParams }: PageProps<"/tasks/plans/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { error, saved } = await searchParams;
  const detail = await getPlanDetail(user, id);
  if (!detail) notFound();
  const { plan, parent, children, tasks, canManage, parentOptions } = detail;

  return (
    <div className="flex flex-col gap-4">
      {typeof error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {error === "plan"
            ? t("plans.errors.parent")
            : error === "forbidden"
              ? t("plans.errors.manage")
              : t(`tasks.errors.${error}` as TranslationKey)}
        </p>
      )}
      {saved === "1" && (
        <p role="status" className="bg-primary/10 rounded-md p-3 text-sm">
          {t("plans.saved")}
        </p>
      )}
      <Card className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{t(`plans.level.${plan.level}`)}</Badge>
          <h2 className="text-xl font-semibold">{plan.title}</h2>
          {plan.isPersonal && <Badge variant="outline">{t("tasks.fields.personalShort")}</Badge>}
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

        {canManage && (
          <div className="flex flex-wrap items-start gap-2">
            <details className="w-full sm:w-auto">
              <summary className={summaryClass}>
                <Pencil className="size-4" />
                {t("plans.edit")}
              </summary>
              <form action={updatePlanAction} className="mt-2 flex flex-col gap-3">
                <input type="hidden" name="planId" value={plan.id} />
                <div className="grid grid-cols-2 gap-3">
                  <Label className="flex-col items-start">
                    {t("plans.fields.level")}
                    <NativeSelect name="level" defaultValue={plan.level} className="w-full">
                      {PLAN_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {t(`plans.level.${level}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Label>
                  <Label className="flex-col items-start">
                    {t("plans.fields.period")}
                    <Input type="date" name="date" required defaultValue={plan.periodStart} />
                  </Label>
                </div>
                <Label className="flex-col items-start">
                  {t("plans.fields.title")}
                  <Input name="title" maxLength={200} defaultValue={plan.title} />
                </Label>
                <Label className="flex-col items-start">
                  {t("plans.fields.parent")}
                  <NativeSelect
                    name="parentId"
                    defaultValue={plan.parentId ?? ""}
                    className="w-full"
                  >
                    <option value="">{t("tasks.fields.none")}</option>
                    {parentOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {t(`plans.level.${p.level}`)}: {p.title}
                      </option>
                    ))}
                  </NativeSelect>
                </Label>
                <Button type="submit" className="self-start">
                  {t("plans.save")}
                </Button>
              </form>
            </details>
            <details className="relative">
              <summary
                className={`${summaryClass} text-muted-foreground hover:text-destructive hover:bg-destructive/10`}
              >
                <Trash2 className="size-4" />
                {t("plans.remove.button")}
              </summary>
              <div className="bg-card shadow-card absolute left-0 z-30 mt-1 flex w-72 flex-col gap-2 rounded-xl border p-3 text-sm">
                <span className="font-medium">{t("plans.remove.title")}</span>
                <span className="text-muted-foreground text-xs">
                  {t("plans.remove.hint", { count: tasks.length })}
                </span>
                <form action={deletePlanAction}>
                  <input type="hidden" name="planId" value={plan.id} />
                  <Button type="submit" variant="destructive" size="sm">
                    {t("plans.remove.yes")}
                  </Button>
                </form>
              </div>
            </details>
          </div>
        )}
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
