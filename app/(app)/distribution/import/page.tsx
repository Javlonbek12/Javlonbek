import Link from "next/link";
import { redirect } from "next/navigation";

import { Section } from "@/components/connect/parts";
import { fmt } from "@/components/distribution/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { canManageDistribution } from "@/modules/distribution/service";

import { importTemplateAction } from "../actions";

const XLSX = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// The POSM launch template (owner and managers). The equipment file and the outlet base are
// uploaded in the equipment section.
export default async function DistributionImportPage({
  searchParams,
}: PageProps<"/distribution/import">) {
  const user = await requireUser();
  if (!canManageDistribution(user)) redirect("/distribution");
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : null;
  const q = (key: string) => (typeof query[key] === "string" ? Number(query[key]) : 0);
  const today = await getUserToday(user.id);

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      {error && (
        <p className="text-destructive text-sm">{t(`dist.errors.${error}` as TranslationKey)}</p>
      )}

      <p className="text-muted-foreground text-sm">
        {t("dist.import.movedToEquipment")}{" "}
        <Link href="/equipment/uploads" className="text-primary hover:underline">
          {t("dist.import.movedLink")}
        </Link>
      </p>
      <div id="template" />
      <Section title={t("dist.import.templateTitle")} hint={t("dist.import.templateHint")}>
        {typeof query.template === "string" && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            {t("dist.import.templateDone", {
              purchases: fmt(q("template")),
              bought: fmt(q("bought")),
              sizes: fmt(q("sizes")),
              elements: fmt(q("elements")),
            })}
            {q("noSize") > 0 && ` ${t("dist.import.templateNoSize", { count: fmt(q("noSize")) })}`}{" "}
            <Link href="/equipment/control" className="text-primary hover:underline">
              {t("dist.import.templateControl")}
            </Link>
          </p>
        )}
        <form action={importTemplateAction} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t("dist.import.file")}
            <Input type="file" name="file" required accept={XLSX} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("dist.import.templateDate")}
            <Input type="date" name="date" required defaultValue={today} />
          </label>
          <Button type="submit">{t("dist.import.submit")}</Button>
        </form>
      </Section>
    </div>
  );
}
