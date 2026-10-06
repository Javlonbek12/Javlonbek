import { redirect } from "next/navigation";

import { PlanForm } from "@/components/content/plan-form";
import { Card } from "@/components/ui/card";
import { isDateString } from "@/lib/dates";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { canPlanContent, listContentAuthors } from "@/modules/content/service";

import { createPlanItemAction } from "../actions";

export default async function NewContentPage({ searchParams }: PageProps<"/content/new">) {
  const user = await requireUser();
  if (!canPlanContent(user)) redirect("/content");
  const { date, error } = await searchParams;
  const today = await getUserToday(user.id);
  const users = await listContentAuthors();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-medium md:text-2xl">{t("content.newTitle")}</h1>
      {typeof error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`content.errors.${error}` as TranslationKey, { mb: 20 })}
        </p>
      )}
      <Card>
        <PlanForm
          action={createPlanItemAction}
          values={{
            publishDate: typeof date === "string" && isDateString(date) ? date : today,
            channels: [],
          }}
          users={users.map((u) => ({ id: u.id, name: displayName(u) }))}
          submit={t("content.actions.create")}
        />
      </Card>
    </div>
  );
}
