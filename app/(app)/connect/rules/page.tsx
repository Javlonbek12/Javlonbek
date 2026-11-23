import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { t } from "@/lib/i18n";
import {
  DEFAULT_RULES,
  isDefaultRules,
  RULE_FIELDS,
  RULE_GROUPS,
  type ConnectRules,
} from "@/modules/connect/rules";
import { canSetConnectRules, loadConnectRules } from "@/modules/connect/service";
import { requireUser } from "@/modules/core/auth/current-user";

import { saveConnectRulesAction } from "../actions";

// «Нормы»: the owner sets the targets of «Маршруты и дисциплина» and the lines of «Требует
// внимания» the whole analytics is counted against. Everyone else is sent back to the analytics.
export default async function ConnectRulesPage({ searchParams }: PageProps<"/connect/rules">) {
  const user = await requireUser();
  if (!canSetConnectRules(user)) redirect("/connect");
  const [params, rules] = await Promise.all([searchParams, loadConnectRules()]);
  const invalid = (typeof params.invalid === "string" ? params.invalid.split(",") : [])
    .map((key) => RULE_FIELDS.find((field) => field.key === key))
    .filter((field) => field !== undefined);
  const value = (key: keyof ConnectRules, number: number) =>
    `${number}${RULE_FIELDS.find((f) => f.key === key)!.percent ? "%" : ""}`;

  return (
    <div className="flex max-w-3xl flex-col gap-5 [&>*]:min-w-0">
      <Link
        href="/connect"
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        {t("connect.rules.back")}
      </Link>
      <PageHeader title={t("connect.rules.title")} hint={t("connect.rules.intro")} />

      {params.error === "forbidden" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t("connect.rules.forbidden")}
        </p>
      )}
      {invalid.length > 0 && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t("connect.rules.invalid", {
            fields: invalid.map((f) => `«${t(`connect.rules.field.${f.key}`)}»`).join(", "),
          })}
        </p>
      )}
      {(params.saved || params.reset) && (
        <p role="status" className="rounded-md bg-emerald-500/10 p-3 text-sm">
          {t(params.reset ? "connect.rules.resetDone" : "connect.rules.saved")}{" "}
          <Link href="/connect" className="text-primary underline underline-offset-2">
            {t("connect.rules.back")}
          </Link>
        </p>
      )}

      <form action={saveConnectRulesAction} className="flex flex-col gap-5">
        {RULE_GROUPS.map((group) => (
          <Card key={group} className="gap-4">
            <div className="flex flex-col gap-1">
              <CardTitle>{t(`connect.rules.group.${group}`)}</CardTitle>
              <CardDescription>{t(`connect.rules.groupHint.${group}`)}</CardDescription>
            </div>
            {RULE_FIELDS.filter((field) => field.group === group).map((field) => (
              <div
                key={field.key}
                className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
              >
                <label
                  htmlFor={`rule-${field.key}`}
                  className="flex min-w-0 flex-1 flex-col gap-0.5"
                >
                  <span className="text-sm font-medium">
                    {t(`connect.rules.field.${field.key}`)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t(`connect.rules.fieldHint.${field.key}`)}
                  </span>
                </label>
                <div className="flex shrink-0 flex-col items-start gap-0.5 sm:items-end">
                  <span className="flex items-center gap-1.5">
                    <Input
                      id={`rule-${field.key}`}
                      name={field.key}
                      type="number"
                      inputMode="numeric"
                      required
                      min={field.min}
                      max={field.max}
                      step={1}
                      defaultValue={rules[field.key]}
                      className="w-20 text-right tabular-nums"
                    />
                    <span className="text-muted-foreground w-6 text-sm">
                      {t(`connect.rules.unit.${field.percent ? "percent" : "count"}`)}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("connect.rules.range", { min: field.min, max: field.max })} ·{" "}
                    {t("connect.rules.standard", {
                      value: value(field.key, DEFAULT_RULES[field.key]),
                    })}
                  </span>
                </div>
              </div>
            ))}
          </Card>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit">{t("connect.rules.save")}</Button>
          <span className="text-muted-foreground text-xs">
            {t(isDefaultRules(rules) ? "connect.rules.standardNow" : "connect.rules.custom")}
          </span>
        </div>
      </form>
      {!isDefaultRules(rules) && (
        <form action={saveConnectRulesAction}>
          <input type="hidden" name="reset" value="1" />
          <Button type="submit" variant="outline">
            {t("connect.rules.reset")}
          </Button>
        </form>
      )}
    </div>
  );
}
