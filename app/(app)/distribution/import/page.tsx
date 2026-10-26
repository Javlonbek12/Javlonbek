import { redirect } from "next/navigation";

import { Section } from "@/components/connect/parts";
import { fmt } from "@/components/distribution/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dateFormat, t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManageDistribution, dataSources } from "@/modules/distribution/service";

import { importEquipmentAction, importOutletsAction } from "../actions";

const XLSX = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// The two files that are refreshed regularly (owner and managers): the equipment counts and the
// outlet base with the responsible TSMs. POSM lists go into orders.
export default async function DistributionImportPage({
  searchParams,
}: PageProps<"/distribution/import">) {
  const user = await requireUser();
  if (!canManageDistribution(user)) redirect("/distribution");
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : null;
  const q = (key: string) => (typeof query[key] === "string" ? Number(query[key]) : 0);
  const sources = await dataSources();
  const at = dateFormat({ dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      {error && (
        <p className="text-destructive text-sm">{t(`dist.errors.${error}` as TranslationKey)}</p>
      )}

      <Section title={t("dist.import.equipmentTitle")} hint={t("dist.import.equipmentHint")}>
        {typeof query.equipment === "string" && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            {t("dist.import.equipmentDone", {
              rows: fmt(q("equipment")),
              units: fmt(q("units")),
              stock: fmt(q("stock")),
            })}
            {q("skipped") > 0 && ` ${t("dist.import.skipped", { count: fmt(q("skipped")) })}`}
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          {sources.equipment
            ? t("dist.import.loaded", {
                date: at.format(sources.equipment.at),
                count: fmt(sources.equipment.units),
              })
            : t("dist.import.notLoaded")}
        </p>
        <form action={importEquipmentAction} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t("dist.import.file")}
            <Input type="file" name="file" required accept={XLSX} />
          </label>
          <Button type="submit">{t("dist.import.submit")}</Button>
        </form>
      </Section>

      <Section title={t("dist.import.outletsTitle")} hint={t("dist.import.outletsHint")}>
        {typeof query.outlets === "string" && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            {t("dist.import.outletsDone", {
              outlets: fmt(q("outlets")),
              withTsm: fmt(q("withTsm")),
              units: fmt(q("units")),
              unitsWithTsm: fmt(q("unitsWithTsm")),
            })}
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          {sources.outlets
            ? t("dist.import.loaded", {
                date: at.format(sources.outlets.at),
                count: fmt(sources.outlets.count),
              })
            : t("dist.import.notLoaded")}
        </p>
        <form action={importOutletsAction} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t("dist.import.file")}
            <Input type="file" name="file" required accept={XLSX} />
          </label>
          <Button type="submit">{t("dist.import.submit")}</Button>
        </form>
      </Section>
    </div>
  );
}
