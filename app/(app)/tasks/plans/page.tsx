import { PlanTree } from "@/components/tasks/plan-card";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { isApprover } from "@/modules/tasks/access";
import { listPlansWithProgress } from "@/modules/tasks/plan-service";
import { PLAN_LEVELS } from "@/modules/tasks/plans";

import { createPlanAction } from "../actions";

export default async function PlansPage({ searchParams }: PageProps<"/tasks/plans">) {
  const user = await requireUser();
  const { error, deleted } = await searchParams;
  const [plans, today] = await Promise.all([listPlansWithProgress(user), getUserToday(user.id)]);
  const canTeam = isApprover(user.role);
  // Plans whose parent is not visible are shown at the top level.
  const ids = new Set(plans.map((p) => p.id));
  const tree = plans.map((p) =>
    p.parentId && !ids.has(p.parentId) ? { ...p, parentId: null } : p,
  );

  return (
    <div className="flex flex-col gap-4">
      {typeof error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {error === "plan"
            ? t("plans.errors.parent")
            : error === "forbidden"
              ? t("plans.errors.forbidden")
              : t(`tasks.errors.${error}` as TranslationKey)}
        </p>
      )}
      {typeof deleted === "string" && (
        <p role="status" className="bg-primary/10 rounded-md p-3 text-sm">
          {t("plans.deleted", { count: Number(deleted) || 0 })}
        </p>
      )}
      {plans.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("plans.empty")}</p>
      ) : (
        <PlanTree plans={tree} />
      )}

      <Card className="gap-3">
        <CardTitle>{t("plans.newPlan")}</CardTitle>
        <form action={createPlanAction} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Label className="flex-col items-start">
              {t("plans.fields.level")}
              <NativeSelect name="level" defaultValue="MONTH" className="w-full">
                {PLAN_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(`plans.level.${level}`)}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Label className="flex-col items-start">
              {t("plans.fields.period")}
              <Input type="date" name="date" required defaultValue={today} />
            </Label>
          </div>
          <Label className="flex-col items-start">
            {t("plans.fields.title")}
            <Input name="title" maxLength={200} placeholder={t("plans.titlePlaceholder")} />
          </Label>
          <Label className="flex-col items-start">
            {t("plans.fields.parent")}
            <NativeSelect name="parentId" defaultValue="" className="w-full">
              <option value="">{t("tasks.fields.none")}</option>
              {plans
                .filter((p) => p.level !== "WEEK")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {t(`plans.level.${p.level}`)}: {p.title}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label>
            <input
              type="checkbox"
              name="isPersonal"
              className="size-4"
              defaultChecked={!canTeam}
              disabled={!canTeam}
            />
            {t("plans.fields.personal")}
            {!canTeam && <input type="hidden" name="isPersonal" value="on" />}
          </Label>
          <Button type="submit" className="self-start">
            {t("plans.create")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
