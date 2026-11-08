import { redirect } from "next/navigation";

import { PlanForm } from "@/components/content/plan-form";
import { Card } from "@/components/ui/card";
import { isDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { canAddContent, canPlanContent, listContentAuthors } from "@/modules/content/service";

import { createPlanItemAction } from "../actions";

export default async function NewContentPage({ searchParams }: PageProps<"/content/new">) {
  const user = await requireUser();
  if (!canAddContent(user)) redirect("/content");
  const planner = canPlanContent(user);
  const { date } = await searchParams;
  const today = await getUserToday(user.id);
  const users = planner ? await listContentAuthors() : [];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-medium md:text-2xl">{t("content.newTitle")}</h1>
      <Card>
        <PlanForm
          action={createPlanItemAction}
          values={{
            publishDate: typeof date === "string" && isDateString(date) ? date : today,
            channels: [],
            // Whoever adds the post prepares it, unless a planner picks someone else.
            authorId: user.id,
          }}
          users={users.map((u) => ({ id: u.id, name: displayName(u) }))}
          submit={t("content.actions.create")}
          showAuthor={planner}
        />
      </Card>
    </div>
  );
}
