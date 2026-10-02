import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";

export default async function HomePage() {
  const user = await requireUser();
  const botUsername = getEnv().TELEGRAM_BOT_USERNAME;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold md:text-3xl">
        {t("home.greeting", { name: user.firstName })}
      </h1>
      <p className="text-muted-foreground">{t("home.role", { role: t(`roles.${user.role}`) })}</p>
      <Card>
        <CardTitle>Telegram</CardTitle>
        {user.botChatId ? (
          <CardDescription>{t("home.botLinked")}</CardDescription>
        ) : (
          <CardDescription>
            {t("home.botNotLinked")}{" "}
            {botUsername && (
              <a className="text-primary underline" href={`https://t.me/${botUsername}?start`}>
                {t("home.openBot")} @{botUsername}
              </a>
            )}
          </CardDescription>
        )}
      </Card>
      <p className="text-muted-foreground text-sm">{t("home.subtitle")}</p>
    </div>
  );
}
