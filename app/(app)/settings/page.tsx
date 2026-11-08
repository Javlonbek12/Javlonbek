import Link from "next/link";

import { AiUsageCard } from "@/components/ai-usage-card";
import { QuietHours } from "@/components/settings/quiet-hours";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { todayInTimezone } from "@/lib/dates";
import { currentLocale, t, LOCALES } from "@/lib/i18n";
import { formatTimeOfDay } from "@/lib/time";
import { requireUser } from "@/modules/core/auth/current-user";
import { notificationGroupsFor } from "@/modules/core/notifications/groups";
import { invitableRoles } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";
import { timezoneOptions } from "@/modules/core/settings/timezones";
import { displayName } from "@/modules/core/users/display-name";

import { saveSettingsAction, sendTestNotificationAction } from "../actions";

const ERRORS = { quiet: "settings.quietHalf", timezone: "settings.timezoneInvalid" } as const;

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireUser();
  const { saved, error, notice } = await searchParams;
  const settings = await getSettings(user.id);
  const zones = timezoneOptions(currentLocale(), settings.timezone);
  const groups = notificationGroupsFor(user);
  const minutes = (value: number | null) => (value === null ? "" : formatTimeOfDay(value));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-medium md:text-2xl">{t("settings.title")}</h1>
      {user.role === "OWNER" && (
        <Link href="/settings/roles" className="hover:bg-accent/50 rounded-xl border p-4">
          <p className="font-medium">{t("roleAccess.open")} →</p>
          <p className="text-muted-foreground text-sm">{t("roleAccess.openHint")}</p>
        </Link>
      )}
      {invitableRoles(user.role).length > 0 && (
        <Link href="/settings/invites" className="hover:bg-accent/50 rounded-xl border p-4">
          <p className="font-medium">{t("team.invites")} →</p>
          <p className="text-muted-foreground text-sm">{t("team.invitesHint")}</p>
        </Link>
      )}
      {saved && (
        <p role="status" className="bg-secondary rounded-md p-3 text-sm">
          {t("common.saved")}
        </p>
      )}
      {notice === "testSent" && (
        <p role="status" className="bg-secondary rounded-md p-3 text-sm">
          {t("team.testSent")}
        </p>
      )}
      {error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(ERRORS[error as keyof typeof ERRORS] ?? "errors.generic")}
        </p>
      )}

      <Card>
        <CardTitle>{t("settings.profile")}</CardTitle>
        <CardDescription>
          {displayName(user)}
          {user.telegramUsername && ` · @${user.telegramUsername}`} · {t(`roles.${user.role}`)}
        </CardDescription>
        <div className="flex flex-wrap gap-2">
          <form action={sendTestNotificationAction}>
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="back" value="/settings" />
            <Button type="submit" variant="outline">
              {t("notifications.sendTestToMe")}
            </Button>
          </form>
          <form action="/api/auth/logout" method="post">
            <Button type="submit" variant="outline">
              {t("login.logout")}
            </Button>
          </form>
        </div>
      </Card>

      <form action={saveSettingsAction} className="flex flex-col gap-4">
        <Card>
          <CardTitle>{t("settings.language")}</CardTitle>
          <CardDescription>{t("settings.languageHint")}</CardDescription>
          <div className="flex flex-wrap gap-4">
            {LOCALES.map((l) => (
              <Label key={l}>
                <input
                  type="radio"
                  name="locale"
                  value={l}
                  defaultChecked={settings.locale === l}
                  className="size-4"
                />
                {t(`settings.languages.${l}`)}
              </Label>
            ))}
          </div>
        </Card>
        <Card>
          <Label className="flex-col items-start">
            {t("settings.timezone")}
            <NativeSelect
              name="timezone"
              defaultValue={settings.timezone}
              required
              className="w-full max-w-sm"
            >
              <optgroup label={t("settings.zonesCommon")}>
                {zones.common.map((z) => (
                  <option key={z.value} value={z.value}>
                    {z.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("settings.zonesAll")}>
                {zones.all.map((z) => (
                  <option key={z.value} value={z.value}>
                    {z.label}
                  </option>
                ))}
              </optgroup>
            </NativeSelect>
          </Label>
        </Card>

        <Card>
          <CardTitle>{t("settings.telegram")}</CardTitle>
          <Label>
            <input
              type="checkbox"
              name="telegramEnabled"
              defaultChecked={settings.telegramEnabled}
              className="size-4"
            />
            {t("settings.telegramEnabled")}
          </Label>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t("settings.quietHours")}</span>
            <CardDescription>{t("settings.quietHoursHint")}</CardDescription>
            <QuietHours
              from={minutes(settings.quietHoursStart)}
              to={minutes(settings.quietHoursEnd)}
            />
          </div>
        </Card>

        <Card>
          <Label className="flex-col items-start">
            {t("settings.digestTime")}
            <Input
              type="time"
              name="digestTime"
              className="w-28"
              defaultValue={formatTimeOfDay(settings.digestTime)}
            />
          </Label>
        </Card>

        <Card>
          <CardTitle>{t("settings.types")}</CardTitle>
          <CardDescription>{t("settings.typesHint")}</CardDescription>
          {groups.map((group) => (
            <fieldset
              key={group.id}
              className="flex flex-col gap-2 border-t pt-3 first-of-type:border-t-0 first-of-type:pt-0"
            >
              <legend className="contents text-sm font-medium">
                {t(`settings.groups.${group.id}`)}
              </legend>
              {group.types.map((type) => (
                <Label key={type} className="font-normal">
                  {/* Only the types shown here are changed by this form. */}
                  <input type="hidden" name="shownTypes" value={type} />
                  <input
                    type="checkbox"
                    name={`type_${type}`}
                    defaultChecked={!settings.disabledTypes.includes(type)}
                    className="size-4"
                  />
                  {t(`notifications.types.${type}`)}
                </Label>
              ))}
            </fieldset>
          ))}
        </Card>

        {/* Reachable without scrolling to the end: sticks above the menu on a phone. */}
        <div className="bg-card/95 sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-1 rounded-2xl border p-2 shadow-sm backdrop-blur md:bottom-4">
          <Button type="submit">{t("common.save")}</Button>
        </div>
      </form>

      {user.role === "OWNER" && <AiUsageCard today={todayInTimezone(settings.timezone)} />}
    </div>
  );
}
