import { redirect } from "next/navigation";

import { DevLoginForm } from "@/components/dev-login-form";
import { AuthShell } from "@/components/auth-shell";
import { LoginError } from "@/components/login-error";
import { TelegramLoginButton } from "@/components/telegram-login-button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getEnv, isDevLoginEnabled } from "@/lib/env";
import { t } from "@/lib/i18n";
import { formatDate } from "@/lib/time";
import { getCurrentUser } from "@/modules/core/auth/current-user";
import { findInviteByCode, getInviteStatus } from "@/modules/core/invites/service";

export default async function InvitePage({ params, searchParams }: PageProps<"/invite/[code]">) {
  if (await getCurrentUser()) redirect("/");
  const { code } = await params;
  const { error } = await searchParams;
  const { TELEGRAM_BOT_USERNAME, TELEGRAM_BOT_TOKEN, APP_URL, DEFAULT_TIMEZONE } = getEnv();

  const invite = await findInviteByCode(code);
  const status = getInviteStatus(invite);

  return (
    <AuthShell>
      <Card>
        <CardTitle className="font-display text-xl font-medium">{t("invite.title")}</CardTitle>
        {invite && status === "valid" ? (
          <>
            <CardDescription>
              {t("invite.description", { role: t(`roles.${invite.role}`) })}
            </CardDescription>
            <p className="text-muted-foreground text-xs">
              {t("invite.validUntil", { date: formatDate(invite.expiresAt, DEFAULT_TIMEZONE) })}
            </p>
            <LoginError error={typeof error === "string" ? error : undefined} />
            {TELEGRAM_BOT_USERNAME && TELEGRAM_BOT_TOKEN && (
              <>
                <TelegramLoginButton
                  botUsername={TELEGRAM_BOT_USERNAME}
                  authUrl={`${APP_URL}/api/auth/telegram?invite=${encodeURIComponent(code)}`}
                />
                <p className="text-sm">
                  {t("invite.orBot")}{" "}
                  <a
                    className="text-primary underline"
                    href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${encodeURIComponent(code)}`}
                  >
                    @{TELEGRAM_BOT_USERNAME}
                  </a>
                </p>
              </>
            )}
          </>
        ) : (
          <LoginError error={status} />
        )}
      </Card>
      {isDevLoginEnabled() && status === "valid" && <DevLoginForm inviteCode={code} />}
    </AuthShell>
  );
}
