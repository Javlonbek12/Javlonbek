import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import Link from "next/link";

import { usd } from "@/components/ai-usage-card";
import { serverSummary } from "@/components/server-status-card";
import { DirtyForm } from "@/components/settings/dirty-form";
import { QuietHours } from "@/components/settings/quiet-hours";
import { Avatar } from "@/components/team/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { db } from "@/lib/db";
import { addMonths, fromDateString, startOfMonth, todayInTimezone } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { currentLocale, t, LOCALES } from "@/lib/i18n";
import { formatTimeOfDay } from "@/lib/time";
import { cn } from "@/lib/utils";
import { canUseModule } from "@/modules/core/access/actor";
import { requireUser } from "@/modules/core/auth/current-user";
import { listActiveInvites } from "@/modules/core/invites/service";
import { notificationGroupsFor } from "@/modules/core/notifications/groups";
import { testResultText } from "@/modules/core/notifications/test-result";
import { invitableRoles } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";
import { timezoneOptions } from "@/modules/core/settings/timezones";
import { displayName } from "@/modules/core/users/display-name";
import { monthlyAiCost } from "@/modules/ops/ai-cost";
import { getServerStatus, serverWarnings } from "@/modules/ops/server-status";

import { saveContactsAction, saveSettingsAction, sendTestNotificationAction } from "../actions";

const ERRORS = {
  quiet: "settings.quietHalf",
  timezone: "settings.timezoneInvalid",
  contacts: "team.profile.errorInvalid",
} as const;

// A row of «Управление командой»: a page of its own, with what is there in one line.
function ManageRow({
  href,
  title,
  hint,
  warn,
}: {
  href: string;
  title: string;
  hint: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className="hover:bg-accent/50 flex items-center gap-3 px-4 py-3 transition-colors"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{title}</span>
          <span
            className={cn(
              "text-sm",
              warn ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
            )}
          >
            {hint}
          </span>
        </span>
        <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
      </Link>
    </li>
  );
}

// The owner's and managers' part: each row leads to its own page.
async function TeamManagement({ user }: { user: Awaited<ReturnType<typeof requireUser>> }) {
  const owner = user.role === "OWNER";
  const invites = invitableRoles(user.role).length > 0;
  if (!owner && !invites) return null;
  const { timezone } = await getSettings(user.id);
  const month = startOfMonth(todayInTimezone(timezone));
  const [openInvites, ai, server] = await Promise.all([
    invites ? listActiveInvites(user) : Promise.resolve([]),
    owner
      ? monthlyAiCost(
          fromDateString(month),
          fromDateString(addMonths(month, 1)),
          fromDateString(addMonths(month, -1)),
        )
      : null,
    owner ? getServerStatus() : null,
  ]);
  const health = server ? serverSummary(server, serverWarnings(server)) : null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">{t("settings.manage.title")}</h2>
      <ul className="bg-card divide-y overflow-hidden rounded-xl border">
        {owner && (
          <ManageRow
            href="/settings/roles"
            title={t("roleAccess.open")}
            hint={t("roleAccess.openHint")}
          />
        )}
        {invites && (
          <ManageRow
            href="/settings/invites"
            title={t("team.invites")}
            hint={t("settings.manage.invites", { count: openInvites.length })}
          />
        )}
        {ai && (
          <ManageRow
            href="/settings/ai"
            title={t("settings.manage.ai")}
            hint={t("settings.manage.aiHint", { sum: usd(ai.total.cost) })}
          />
        )}
        {health && (
          <ManageRow
            href="/settings/server"
            title={t("settings.server.title")}
            hint={
              <span className="inline-flex items-center gap-1">
                {health.ok ? (
                  <CheckCircle2 className="size-3.5" aria-hidden />
                ) : (
                  <AlertTriangle className="size-3.5" aria-hidden />
                )}
                {health.text}
              </span>
            }
            warn={!health.ok}
          />
        )}
      </ul>
    </section>
  );
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireUser();
  const { saved, error, notice, tg } = await searchParams;
  const [settings, manager] = await Promise.all([
    getSettings(user.id),
    user.managerId
      ? db.user.findUnique({
          where: { id: user.managerId },
          select: { id: true, firstName: true, lastName: true },
        })
      : null,
  ]);
  const zones = timezoneOptions(currentLocale(), settings.timezone);
  const groups = notificationGroupsFor(user);
  const minutes = (value: number | null) => (value === null ? "" : formatTimeOfDay(value));
  const linked = user.botChatId !== null;
  const { TELEGRAM_BOT_USERNAME } = getEnv();
  // People with the Team or the chart section see their manager's card from here.
  const seesCards = canUseModule(user, "team") || canUseModule(user, "structure");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[22px] font-medium md:text-2xl">{t("settings.title")}</h1>
      {saved && (
        <p role="status" className="bg-secondary rounded-md p-3 text-sm">
          {saved === "contacts" ? t("team.profile.saved") : t("common.saved")}
        </p>
      )}
      {notice === "testSent" && (
        <p role="status" className="bg-secondary rounded-md p-3 text-sm">
          {testResultText(tg)}
        </p>
      )}
      {error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(ERRORS[error as keyof typeof ERRORS] ?? "errors.generic")}
        </p>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">{t("settings.personal")}</h2>
        <Card className="gap-4">
          <div className="flex items-start gap-3">
            <Avatar name={displayName(user)} size="lg" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <CardTitle>{displayName(user)}</CardTitle>
              <CardDescription>
                {t(`roles.${user.role}`)}
                {user.position && ` · ${user.position}`}
                {user.telegramUsername && ` · @${user.telegramUsername}`}
              </CardDescription>
              {manager && (
                <CardDescription>
                  {t("team.profile.manager")}:{" "}
                  {seesCards ? (
                    <Link href={`/team/${manager.id}`} className="underline">
                      {displayName(manager)}
                    </Link>
                  ) : (
                    displayName(manager)
                  )}
                </CardDescription>
              )}
            </div>
          </div>

          {/* Without the bot nothing reaches Telegram: the most common «уведомления не приходят». */}
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-3 text-sm",
              !linked && "border-amber-500/40 bg-amber-500/10",
            )}
          >
            {linked ? (
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            ) : (
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
            )}
            <span className="font-medium">
              {t(linked ? "settings.bot.linked" : "settings.bot.notLinked")}
            </span>
            {!linked && TELEGRAM_BOT_USERNAME && (
              <Button asChild size="sm" className="ml-auto">
                <a href={`https://t.me/${TELEGRAM_BOT_USERNAME}`} target="_blank" rel="noreferrer">
                  {t("settings.bot.connect")}
                </a>
              </Button>
            )}
            {!linked && (
              <span className="text-muted-foreground basis-full text-xs">
                {t("settings.bot.connectHint")}
              </span>
            )}
          </div>

          <form action={saveContactsAction} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Label className="flex-col items-start">
                {t("team.profile.phone")}
                <Input name="phone" type="tel" maxLength={40} defaultValue={user.phone ?? ""} />
              </Label>
              <Label className="flex-col items-start">
                {t("team.profile.email")}
                <Input name="email" type="email" maxLength={200} defaultValue={user.email ?? ""} />
              </Label>
            </div>
            <Button type="submit" size="sm" variant="outline" className="self-start">
              {t("settings.saveContacts")}
            </Button>
          </form>
        </Card>

        <DirtyForm action={saveSettingsAction}>
          <Card className="gap-4">
            <CardTitle>{t("settings.languageAndTime")}</CardTitle>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t("settings.language")}</span>
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
              <CardDescription>{t("settings.languageHint")}</CardDescription>
            </div>
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

          <Card className="gap-4">
            <CardTitle>{t("settings.telegram")}</CardTitle>
            <div className="flex flex-col gap-1">
              <Label className={cn(!linked && "text-muted-foreground")}>
                {linked && <input type="hidden" name="telegramShown" value="1" />}
                <input
                  type="checkbox"
                  name="telegramEnabled"
                  defaultChecked={linked && settings.telegramEnabled}
                  disabled={!linked}
                  className="size-4"
                />
                {t("settings.telegramEnabled")}
              </Label>
              {!linked && (
                <CardDescription className="text-xs">
                  {t("settings.bot.firstConnect")}
                </CardDescription>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t("settings.quietHours")}</span>
              <CardDescription>{t("settings.quietHoursHint")}</CardDescription>
              <QuietHours
                from={minutes(settings.quietHoursStart)}
                to={minutes(settings.quietHoursEnd)}
              />
            </div>
            <Label className="flex-col items-start">
              {t("settings.digestTime")}
              <Input
                type="time"
                name="digestTime"
                className="w-32"
                defaultValue={formatTimeOfDay(settings.digestTime)}
              />
            </Label>
          </Card>

          <Card id="telegram-types" className="scroll-mt-20 gap-3">
            <CardTitle>{t("settings.types")}</CardTitle>
            <CardDescription>{t("settings.typesHint")}</CardDescription>
            {groups.map((group) => (
              <fieldset key={group.id} className="flex flex-col gap-2 border-t pt-3">
                <legend className="float-left mb-1 w-full text-sm font-medium">
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
        </DirtyForm>

        <div className="flex flex-wrap gap-2">
          <form action={sendTestNotificationAction}>
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="back" value="/settings" />
            <Button type="submit" variant="outline" size="sm">
              {t("notifications.sendTestToMe")}
            </Button>
          </form>
        </div>
      </section>

      <TeamManagement user={user} />

      <form action="/api/auth/logout" method="post" className="border-t pt-4">
        <Button type="submit" variant="ghost">
          {t("login.logout")}
        </Button>
      </form>
    </div>
  );
}
