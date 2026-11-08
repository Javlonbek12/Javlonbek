import { redirect } from "next/navigation";

import { DevLoginForm } from "@/components/dev-login-form";
import { AuthShell } from "@/components/auth-shell";
import { LoginError } from "@/components/login-error";
import { TelegramLoginButton } from "@/components/telegram-login-button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getEnv, isDevLoginEnabled } from "@/lib/env";
import { t } from "@/lib/i18n";
import { getCurrentUser, getViewerLocale } from "@/modules/core/auth/current-user";
import { safeNextPath } from "@/modules/core/auth/next-path";

export async function generateMetadata() {
  await getViewerLocale();
  return { title: t("login.tabTitle") };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error, next: nextParam } = await searchParams;
  // The page the person came for (a link from a notification): back there after signing in.
  const next = safeNextPath(nextParam);
  if (await getCurrentUser()) redirect(next ?? "/");
  await getViewerLocale();
  const { TELEGRAM_BOT_USERNAME, TELEGRAM_BOT_TOKEN, APP_URL } = getEnv();
  const authUrl = `${APP_URL}/api/auth/telegram${next ? `?${new URLSearchParams({ next })}` : ""}`;

  return (
    <AuthShell>
      <Card>
        <CardTitle className="font-display text-xl font-medium">{t("login.title")}</CardTitle>
        <CardDescription>{t("login.subtitle")}</CardDescription>
        <LoginError error={typeof error === "string" ? error : undefined} />
        {TELEGRAM_BOT_USERNAME && TELEGRAM_BOT_TOKEN ? (
          <TelegramLoginButton botUsername={TELEGRAM_BOT_USERNAME} authUrl={authUrl} />
        ) : (
          <p className="text-muted-foreground text-sm">{t("login.widgetNotConfigured")}</p>
        )}
        <p className="text-muted-foreground text-sm">{t("login.noInvite")}</p>
      </Card>
      {isDevLoginEnabled() && <DevLoginForm next={next} />}
    </AuthShell>
  );
}
