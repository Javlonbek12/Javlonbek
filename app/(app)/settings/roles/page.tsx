import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { CONFIGURABLE_MODULES, getRoleConfig, TASK_SCOPES } from "@/modules/core/access/config";
import { requireUser } from "@/modules/core/auth/current-user";

import { saveRolesAction } from "./actions";

export default async function RolesPage({ searchParams }: PageProps<"/settings/roles">) {
  const user = await requireUser();
  if (user.role !== "OWNER") redirect("/settings");
  const { saved, error } = await searchParams;
  const config = await getRoleConfig();

  return (
    <form action={saveRolesAction} className="flex flex-col gap-4">
      <h1 className="text-[22px] font-medium md:text-2xl">{t("roleAccess.title")}</h1>
      <p className="text-muted-foreground text-sm">{t("roleAccess.intro")}</p>
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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(["MANAGER", "MEMBER", "LAWYER"] as const).map((role) => (
          <Card key={role} className="gap-4">
            <CardTitle>{t(`roleAccess.roleNames.${role}`)}</CardTitle>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t("roleAccess.sections")}</legend>
              {CONFIGURABLE_MODULES.filter((m) => role === "MANAGER" || m !== "reports").map(
                (module) => (
                  <label key={module} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name={`${role}.${module}`}
                      defaultChecked={
                        config[role].modules.includes(module) ||
                        (role === "LAWYER" && module === "content")
                      }
                      disabled={role === "LAWYER" && module === "content"}
                      className="size-4"
                    />
                    {t(`roleAccess.modules.${module}`)}
                  </label>
                ),
              )}
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t("roleAccess.taskScope")}</legend>
              {role === "MANAGER" ? (
                TASK_SCOPES.map((scope) => (
                  <label key={scope} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="MANAGER.taskScope"
                      value={scope}
                      defaultChecked={config.MANAGER.taskScope === scope}
                      className="size-4"
                    />
                    {t(`roleAccess.scopes.${scope}`)}
                  </label>
                ))
              ) : (
                <>
                  <input type="hidden" name={`${role}.taskScope`} value="own" />
                  <CardDescription>{t("roleAccess.memberScope")}</CardDescription>
                  {role === "LAWYER" && (
                    <CardDescription>{t("roleAccess.lawyerNote")}</CardDescription>
                  )}
                </>
              )}
            </fieldset>
          </Card>
        ))}
      </div>
      <Button type="submit" className="self-start">
        {t("roleAccess.save")}
      </Button>
    </form>
  );
}
