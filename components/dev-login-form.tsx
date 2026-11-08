import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";

export function DevLoginForm({ inviteCode, next }: { inviteCode?: string; next?: string | null }) {
  return (
    <Card className="border-dashed">
      <CardTitle>{t("login.devTitle")}</CardTitle>
      <CardDescription>{t("login.devHint")}</CardDescription>
      <form action="/api/auth/dev-login" method="post" className="flex flex-col gap-3">
        {inviteCode && <input type="hidden" name="invite" value={inviteCode} />}
        {next && <input type="hidden" name="next" value={next} />}
        <Label className="flex-col items-start">
          {t("login.devTelegramId")}
          <Input
            name="telegramId"
            inputMode="numeric"
            pattern="\d{1,15}"
            defaultValue="1000001"
            required
          />
        </Label>
        <Label className="flex-col items-start">
          {t("login.devFirstName")}
          <Input name="firstName" defaultValue="Тестовый сотрудник 1" required maxLength={64} />
        </Label>
        <Button type="submit" variant="secondary">
          {t("login.devSubmit")}
        </Button>
      </form>
    </Card>
  );
}
