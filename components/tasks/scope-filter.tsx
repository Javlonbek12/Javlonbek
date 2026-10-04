import { NativeSelect } from "@/components/ui/native-select";
import { t } from "@/lib/i18n";
import type { Scope } from "@/modules/tasks/filters";

export function ScopeSelect({ value }: { value: Scope }) {
  return (
    <NativeSelect name="scope" defaultValue={value} aria-label={t("tasks.filters.scope")}>
      <option value="mine">{t("tasks.filters.scopeMine")}</option>
      <option value="created">{t("tasks.filters.scopeCreated")}</option>
      <option value="team">{t("tasks.filters.scopeTeam")}</option>
    </NativeSelect>
  );
}
