import { redirect } from "next/navigation";

import { DevLoginForm } from "@/components/dev-login-form";
import { AuthShell } from "@/components/auth-shell";
import { LoginError } from "@/components/login-error";
import { TelegramLoginButton } from "@/components/telegram-login-button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getEnv, isDevLoginEnabled } from "@/lib/env";
import { t } from "@/lib/i18n";
import { getCurrentUser, getViewerLocale } from "@/modules/core/auth/current-user";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getCurrentUser()) redirect("/");
  await getViewerLocale();
  const { error } = await searchParams;
  const { TELEGRAM_BOT_USERNAME, TELEGRAM_BOT_TOKEN, APP_URL } = getEnv();

  return (
    <AuthShell>
      <Card>
        <CardTitle className="font-display text-xl font-medium">{t("login.title")}</CardTitle>
        <CardDescription>{t("login.subtitle")}</CardDescription>
        <LoginError error={typeof error === "string" ? error : undefined} />
        {TELEGRAM_BOT_USERNAME && TELEGRAM_BOT_TOKEN ? (
          <TelegramLoginButton
            botUsername={TELEGRAM_BOT_USERNAME}
            authUrl={`${APP_URL}/api/auth/telegram`}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t("login.widgetNotConfigured")}</p>
        )}
      </Card>
      {isDevLoginEnabled() && <DevLoginForm />}
    </AuthShell>
  );
}
