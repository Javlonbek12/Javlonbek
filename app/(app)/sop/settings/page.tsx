import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { t } from "@/lib/i18n";
import { loadSopSettings } from "@/modules/sop/service";
import {
  DEFAULT_SOP_SETTINGS,
  isDefaultSopSettings,
  SOP_SETTING_FIELDS,
  SOP_SETTING_GROUPS,
} from "@/modules/sop/settings";

import { saveSopSettingsAction } from "../actions";

// «Настройки»: the norms the file is checked against, with what each of them does.
export default async function SopSettingsPage({ searchParams }: PageProps<"/sop/settings">) {
  const [params, settings] = await Promise.all([searchParams, loadSopSettings()]);
  const invalid = (typeof params.invalid === "string" ? params.invalid.split(",") : [])
    .map((key) => SOP_SETTING_FIELDS.find((field) => field.key === key))
    .filter((field) => field !== undefined);
  const shown = (value: string | number | null) =>
    value === null || value === "" ? t("sop.settings.notSet") : String(value);
  return (
    <div className="flex max-w-3xl flex-col gap-5 [&>*]:min-w-0">
      <p className="text-muted-foreground text-sm">{t("sop.settings.intro")}</p>
      {params.error === "forbidden" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t("sop.uploads.errors.forbidden")}
        </p>
      )}
      {invalid.length > 0 && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t("sop.settings.invalid", {
            fields: invalid.map((f) => `«${t(`sop.settings.field.${f.key}`)}»`).join(", "),
          })}
        </p>
      )}
      {(params.saved || params.reset) && (
        <p role="status" className="rounded-md bg-emerald-500/10 p-3 text-sm">
          {t(params.reset ? "sop.settings.resetDone" : "sop.settings.saved")}
        </p>
      )}

      <form action={saveSopSettingsAction} className="flex flex-col gap-5">
        {SOP_SETTING_GROUPS.map((group) => (
          <Card key={group} className="gap-4">
            <div className="flex flex-col gap-1">
              <CardTitle>{t(`sop.settings.group.${group}`)}</CardTitle>
              <CardDescription>{t(`sop.settings.groupHint.${group}`)}</CardDescription>
            </div>
            {SOP_SETTING_FIELDS.filter((field) => field.group === group).map((field) => {
              const unit = t(`sop.settings.unit.${field.kind}`);
              const value = settings[field.key];
              return (
                <div
                  key={field.key}
                  className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                >
                  <label
                    htmlFor={`sop-${field.key}`}
                    className="flex min-w-0 flex-1 flex-col gap-0.5"
                  >
                    <span className="text-sm font-medium">
                      {t(`sop.settings.field.${field.key}`)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {t(`sop.settings.fieldHint.${field.key}`)}
                    </span>
                  </label>
                  <div className="flex shrink-0 flex-col items-start gap-0.5 sm:items-end">
                    <span className="flex items-center gap-1.5">
                      <Input
                        id={`sop-${field.key}`}
                        name={field.key}
                        inputMode={field.kind === "text" ? "text" : "decimal"}
                        required={field.key !== "kaShare"}
                        maxLength={40}
                        defaultValue={value === null ? "" : String(value)}
                        className={field.kind === "text" ? "w-44" : "w-24 text-right tabular-nums"}
                      />
                      {unit && <span className="text-muted-foreground w-8 text-sm">{unit}</span>}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {t("sop.settings.standard", {
                        value: shown(DEFAULT_SOP_SETTINGS[field.key]),
                      })}
                    </span>
                  </div>
                </div>
              );
            })}
          </Card>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit">{t("sop.settings.save")}</Button>
          <span className="text-muted-foreground text-xs">
            {t(isDefaultSopSettings(settings) ? "sop.settings.standardNow" : "sop.settings.custom")}
          </span>
        </div>
      </form>
      {!isDefaultSopSettings(settings) && (
        <form action={saveSopSettingsAction}>
          <input type="hidden" name="reset" value="1" />
          <Button type="submit" variant="outline">
            {t("sop.settings.reset")}
          </Button>
        </form>
      )}
    </div>
  );
}
