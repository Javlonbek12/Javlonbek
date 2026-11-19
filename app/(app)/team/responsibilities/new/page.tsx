import { redirect } from "next/navigation";

import { ResponsibilityForm } from "@/components/team/responsibility-form";
import { PageHeader } from "@/components/ui/page-header";
import { t } from "@/lib/i18n";
import { deniedHref } from "@/modules/core/access/guard";
import { requireUser } from "@/modules/core/auth/current-user";
import { canAddDuties } from "@/modules/team/responsibilities";

import { saveDutyAction } from "../actions";
import { formBack, formChoices } from "../form-data";

// «Добавить обязанность»: from «Команда» → «Обязанности» or an employee card (?person=…).
export default async function NewResponsibilityPage({
  searchParams,
}: PageProps<"/team/responsibilities/new">) {
  const user = await requireUser();
  if (!canAddDuties(user)) redirect(deniedHref("team"));
  const query = await searchParams;
  const back = formBack(query.back);
  const choices = await formChoices(user, []);
  // The person the card was opened for, or the editor themselves.
  const wanted = typeof query.person === "string" ? query.person : user.id;
  const responsible = choices.people.some((p) => p.id === wanted) ? wanted : "";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("team.duties.newTitle")} />
      <ResponsibilityForm
        action={saveDutyAction}
        initial={{ title: "", description: "", responsible, deputyId: "", module: "" }}
        {...choices}
        back={back}
        submitLabel={t("team.duties.create")}
      />
    </div>
  );
}
