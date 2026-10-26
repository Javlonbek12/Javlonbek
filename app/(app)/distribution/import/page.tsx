import { redirect } from "next/navigation";

import { Section } from "@/components/connect/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManageDistribution } from "@/modules/distribution/service";

import { importDistributionAction } from "../actions";

// Uploading the distribution workbook (owner and managers).
export default async function DistributionImportPage({
  searchParams,
}: PageProps<"/distribution/import">) {
  const user = await requireUser();
  if (!canManageDistribution(user)) redirect("/distribution");
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : null;
  return (
    <Section title={t("dist.import.title")} hint={t("dist.import.hint")}>
      {typeof query.posm === "string" && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {t("dist.import.done", { counts: String(query.counts ?? 0), posm: query.posm })}
        </p>
      )}
      {error && (
        <p className="text-destructive text-sm">{t(`dist.errors.${error}` as TranslationKey)}</p>
      )}
      <form action={importDistributionAction} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t("dist.import.file")}
          <Input
            type="file"
            name="file"
            required
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          />
        </label>
        <Button type="submit">{t("dist.import.submit")}</Button>
      </form>
    </Section>
  );
}
