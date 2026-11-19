import { notFound } from "next/navigation";

import { ResponsibilityForm } from "@/components/team/responsibility-form";
import { PageHeader } from "@/components/ui/page-header";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getDutyForEdit, KEEP_PLACE, ownerText } from "@/modules/team/responsibilities";

import { saveDutyAction } from "../actions";
import { formBack, formChoices } from "../form-data";

// «Изменить» a responsibility (only for those who may change it).
export default async function EditResponsibilityPage({
  params,
  searchParams,
}: PageProps<"/team/responsibilities/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const found = await getDutyForEdit(user, id);
  if (!found) notFound();
  const { duty, row } = found;
  const query = await searchParams;
  const back = formBack(query.back);
  const { owner } = duty;
  const current = owner.kind === "person" ? owner.person.id : null;
  const choices = await formChoices(user, [current, row.deputyId]);
  // A place no app user holds keeps its item unless another person is chosen.
  const keepPlace =
    owner.kind === "place"
      ? {
          value: KEEP_PLACE,
          label: t("team.duties.keepPlace", {
            title: owner.title ?? "—",
            who: owner.personName ?? t("team.duties.vacancy").toLowerCase(),
          }),
        }
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("team.duties.editTitle")}>{ownerText(owner)}</PageHeader>
      <ResponsibilityForm
        action={saveDutyAction}
        dutyId={duty.id}
        initial={{
          title: duty.title,
          description: duty.description ?? "",
          responsible: keepPlace ? KEEP_PLACE : (current ?? ""),
          deputyId: row.deputyId ?? "",
          module: duty.module ?? "",
        }}
        {...choices}
        keepPlace={keepPlace}
        suggested={duty.status === "SUGGESTED"}
        back={back}
        submitLabel={t("team.duties.save")}
      />
    </div>
  );
}
