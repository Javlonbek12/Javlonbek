import Link from "next/link";
import { redirect } from "next/navigation";

import { DirtyForm } from "@/components/settings/dirty-form";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { t } from "@/lib/i18n";
import {
  CONFIGURABLE_MODULES,
  getRoleConfig,
  roleModules,
  TASK_SCOPES,
  type ConfigurableModule,
} from "@/modules/core/access/config";
import { requireUser } from "@/modules/core/auth/current-user";
import { displayName } from "@/modules/core/users/display-name";
import { teamsOfPeople } from "@/modules/org/service";
import { getTaskSettings, listTeamLeads } from "@/modules/tasks/settings";

import { saveAccessAction } from "./actions";

const ROLES = ["MANAGER", "MEMBER", "LAWYER"] as const;
type Role = (typeof ROLES)[number];

// Sections that have no switch of their own: they come with another one (the same rule as the
// menu and the links, modules/core/access/paths.ts).
const AUTO: { key: "equipment" | "contentAnalytics"; with: ConfigurableModule[] }[] = [
  { key: "equipment", with: ["distribution", "planograms"] },
  { key: "contentAnalytics", with: ["content"] },
];

export default async function RolesPage({ searchParams }: PageProps<"/settings/roles">) {
  const user = await requireUser();
  if (user.role !== "OWNER") redirect("/settings");
  const { saved, error } = await searchParams;
  const [config, taskSettings, leads, teams] = await Promise.all([
    getRoleConfig(),
    getTaskSettings(),
    listTeamLeads(),
    teamsOfPeople(),
  ]);
  const cell = "px-2 py-2 text-center";
  // Reports are for managers only; the lawyer always has the content plan.
  const fixed = (role: Role, module: ConfigurableModule) =>
    (role !== "MANAGER" && module === "reports") || (role === "LAWYER" && module === "content");

  return (
    <div className="flex flex-col gap-4">
      <Link href="/settings" className="text-muted-foreground w-fit text-sm hover:underline">
        ← {t("settings.title")}
      </Link>
      <PageHeader title={t("roleAccess.title")} hint={t("roleAccess.intro")} />
      {saved && (
        <p role="status" className="bg-secondary rounded-md p-3 text-sm">
          {t("roleAccess.saved")}
        </p>
      )}
      {error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t("roleAccess.error")}
        </p>
      )}
      <DirtyForm action={saveAccessAction}>
        <Card className="gap-3">
          <CardTitle>{t("roleAccess.sections")}</CardTitle>
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr>
                  <th className="px-2 py-2 text-left font-normal">{t("roleAccess.section")}</th>
                  {ROLES.map((role) => (
                    <th key={role} className={`${cell} font-medium`}>
                      {t(`roleAccess.roleNames.${role}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CONFIGURABLE_MODULES.map((module) => (
                  <tr key={module} className="border-t">
                    <td className="px-2 py-2">{t(`roleAccess.modules.${module}`)}</td>
                    {ROLES.map((role) => (
                      <td key={role} className={cell}>
                        {fixed(role, module) ? (
                          <span className="text-muted-foreground text-xs">
                            {role === "LAWYER" && module === "content"
                              ? t("roleAccess.always")
                              : "—"}
                          </span>
                        ) : (
                          <input
                            type="checkbox"
                            name={`${role}.${module}`}
                            defaultChecked={config[role].modules.includes(module)}
                            aria-label={`${t(`roleAccess.modules.${module}`)} — ${t(`roleAccess.roleNames.${role}`)}`}
                            className="size-4"
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {AUTO.map((auto) => (
                  <tr key={auto.key} className="text-muted-foreground border-t">
                    <td className="px-2 py-2">
                      {t(`roleAccess.auto.${auto.key}`)}
                      <span className="block text-xs">{t(`roleAccess.auto.${auto.key}Hint`)}</span>
                    </td>
                    {ROLES.map((role) => (
                      <td key={role} className={`${cell} text-xs`}>
                        {auto.with.some((m) => roleModules(role, config).includes(m))
                          ? t("roleAccess.auto.on")
                          : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t">
                  <td className="px-2 py-2">{t("roleAccess.taskScope")}</td>
                  {ROLES.map((role) => (
                    <td key={role} className={cell}>
                      {role === "MANAGER" ? (
                        <NativeSelect
                          name="MANAGER.taskScope"
                          defaultValue={config.MANAGER.taskScope}
                          aria-label={t("roleAccess.taskScope")}
                          className="w-full max-w-48 text-xs"
                        >
                          {TASK_SCOPES.map((scope) => (
                            <option key={scope} value={scope}>
                              {t(`roleAccess.scopes.${scope}`)}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : (
                        <>
                          <input type="hidden" name={`${role}.taskScope`} value="own" />
                          <span className="text-muted-foreground text-xs">
                            {t("roleAccess.ownOnly")}
                          </span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <CardDescription className="text-xs">{t("roleAccess.lawyerNote")}</CardDescription>
        </Card>

        <Card className="gap-4">
          <CardTitle>{t("roleAccess.tasks.title")}</CardTitle>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">
              {t("roleAccess.tasks.teamApproval")}
            </legend>
            <CardDescription>{t("roleAccess.tasks.teamApprovalHint")}</CardDescription>
            {leads.map((lead) => (
              <label key={lead.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="teamApproval"
                  value={lead.id}
                  defaultChecked={taskSettings.teamApproval.includes(lead.id)}
                  className="size-4"
                />
                {teams.get(lead.id) || t("roleAccess.tasks.teamOf", { name: displayName(lead) })}
                {teams.get(lead.id) && (
                  <span className="text-muted-foreground text-xs">
                    {t("roleAccess.tasks.led", { name: displayName(lead) })}
                  </span>
                )}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t("roleAccess.tasks.trashDays")}
            <Input
              type="number"
              name="trashDays"
              min={1}
              max={365}
              defaultValue={taskSettings.trashDays}
              className="w-24"
            />
          </label>
        </Card>
      </DirtyForm>
    </div>
  );
}
