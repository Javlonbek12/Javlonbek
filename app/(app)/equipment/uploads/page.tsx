import { redirect } from "next/navigation";

import { Section } from "@/components/connect/parts";
import { fmt } from "@/components/distribution/parts";
import { ControlTable } from "@/components/equipment/control-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dateFormat, t, type TranslationKey } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { equipmentControl } from "@/modules/distribution/control";
import { canManageDistribution, dataSources, pendingImport } from "@/modules/distribution/service";

import {
  importEquipmentAction,
  importOutletsAction,
  resolveImportAction,
} from "../../distribution/actions";

const XLSX = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// The two equipment files that are refreshed regularly (owner and managers): the equipment file
// (quantities, regions) and the outlet base with the responsible TSMs.
export default async function EquipmentUploadsPage({
  searchParams,
}: PageProps<"/equipment/uploads">) {
  const user = await requireUser();
  if (!canManageDistribution(user)) redirect("/equipment");
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : null;
  const q = (key: string) => (typeof query[key] === "string" ? Number(query[key]) : 0);
  const sources = await dataSources();
  const pending = typeof query.pending === "string" ? await pendingImport(query.pending) : null;
  // Right after an upload: the control table of what is now loaded.
  const control = typeof query.equipment === "string" ? await equipmentControl() : null;
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
            {q("noId") > 0 && ` ${t("dist.import.noId", { count: fmt(q("noId")) })}`}
            {q("skipped") > 0 && ` ${t("dist.import.skipped", { count: fmt(q("skipped")) })}`}
          </p>
        )}
        {control && control.rows.length > 0 && <ControlTable rows={control.rows} />}
        {typeof query.dropped === "string" && (
          <p className="text-muted-foreground text-sm">{t("dist.import.dropped")}</p>
        )}
        {pending && (
          <div className="flex flex-col gap-3 rounded-xl border border-red-300 p-3 dark:border-red-900">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">
              {t("dist.import.minus", { rows: fmt(pending.rows) })}
            </p>
            <ControlTable rows={pending.control} />
            <form action={resolveImportAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="id" value={pending.id} />
              <Button type="submit" name="save" value="1" variant="destructive">
                {t("dist.import.saveAnyway")}
              </Button>
              <Button type="submit" name="save" value="0" variant="outline">
                {t("dist.import.drop")}
              </Button>
            </form>
          </div>
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
            })}{" "}
            {t("dist.import.missing", { count: fmt(q("missing")) })}
            {q("mismatched") > 0 &&
              ` ${t("dist.import.mismatched", { count: fmt(q("mismatched")) })}`}
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
