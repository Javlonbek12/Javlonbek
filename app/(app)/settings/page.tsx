import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import { formatTimeOfDay } from "@/lib/time";
import { requireUser } from "@/modules/core/auth/current-user";
import { OPTIONAL_NOTIFICATION_TYPES } from "@/modules/core/notifications/types";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";

import { AiUsageCard } from "@/components/ai-usage-card";
import { todayInTimezone } from "@/lib/dates";

import { saveSettingsAction } from "../actions";

const TIMEZONES = ["Asia/Tashkent", "Asia/Samarkand", "Asia/Almaty", "Europe/Moscow", "UTC"];

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireUser();
  const { saved, error } = await searchParams;
  const settings = await getSettings(user.id);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
      {saved && (
        <p role="status" className="bg-secondary rounded-md p-3 text-sm">
          {t("common.saved")}
        </p>
      )}
      {error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t("errors.generic")}
        </p>
      )}

      <Card>
        <CardTitle>{t("settings.profile")}</CardTitle>
        <CardDescription>
          {displayName(user)}
          {user.telegramUsername && ` · @${user.telegramUsername}`} · {t(`roles.${user.role}`)}
        </CardDescription>
        <form action="/api/auth/logout" method="post">
          <Button type="submit" variant="outline">
            {t("login.logout")}
          </Button>
        </form>
      </Card>

      <form action={saveSettingsAction} className="flex flex-col gap-4">
        <Card>
          <Label className="flex-col items-start">
            {t("settings.timezone")}
            <Input name="timezone" list="timezones" defaultValue={settings.timezone} required />
            <datalist id="timezones">
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
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
            <div className="flex flex-wrap items-center gap-3">
              <Label>
                {t("settings.quietFrom")}
                <Input
                  type="time"
                  name="quietFrom"
                  className="w-28"
                  defaultValue={
                    settings.quietHoursStart === null
                      ? ""
                      : formatTimeOfDay(settings.quietHoursStart)
                  }
                />
              </Label>
              <Label>
                {t("settings.quietTo")}
                <Input
                  type="time"
                  name="quietTo"
                  className="w-28"
                  defaultValue={
                    settings.quietHoursEnd === null ? "" : formatTimeOfDay(settings.quietHoursEnd)
                  }
                />
              </Label>
            </div>
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
          {OPTIONAL_NOTIFICATION_TYPES.map((type) => (
            <Label key={type}>
              <input
                type="checkbox"
                name={`type_${type}`}
                defaultChecked={!settings.disabledTypes.includes(type)}
                className="size-4"
              />
              {t(`notifications.types.${type}`)}
            </Label>
          ))}
        </Card>

        <Button type="submit" className="self-start">
          {t("common.save")}
        </Button>
      </form>

      {user.role === "OWNER" && <AiUsageCard today={todayInTimezone(settings.timezone)} />}
    </div>
  );
}
