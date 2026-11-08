import { createInviteAction, revokeInviteAction } from "@/app/(app)/actions";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { formatDate } from "@/lib/time";
import { INVITE_TTL_DAYS, listActiveInvites } from "@/modules/core/invites/service";
import { invitableRoles, type Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";

// Creating and revoking invitations. On the team page, and in Settings → Приглашения for managers
// whose role has no Team section (by default managers don't): they invite their own people.
export async function InviteSection({ user, timezone }: { user: Actor; timezone: string }) {
  const roles = invitableRoles(user.role);
  if (roles.length === 0) return null;
  const invites = await listActiveInvites(user);
  const { APP_URL, TELEGRAM_BOT_USERNAME } = getEnv();

  return (
    <section id="invites" className="flex scroll-mt-20 flex-col gap-3">
      <Card className="gap-3">
        <CardTitle>{t("team.newInvite")}</CardTitle>
        <CardDescription>
          {t("team.inviteHint", { days: INVITE_TTL_DAYS })}
          {user.role === "MANAGER" && ` ${t("team.inviteManagerHint")}`}
        </CardDescription>
        <form action={createInviteAction} className="flex flex-wrap items-center gap-2">
          <NativeSelect name="role" defaultValue="MEMBER" aria-label={t("team.inviteRole")}>
            {roles.map((role) => (
              <option key={role} value={role}>
                {t(`roles.${role}`)}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit">{t("team.createInvite")}</Button>
        </form>
      </Card>
      {invites.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("team.noInvites")}</p>
      )}
      {invites.map((invite) => {
        const link = `${APP_URL}/invite/${invite.code}`;
        return (
          <Card key={invite.id} className="gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{t(`roles.${invite.role}`)}</Badge>
              <span className="text-muted-foreground text-xs">
                {t("team.inviteExpires", { date: formatDate(invite.expiresAt, timezone) })} ·{" "}
                {displayName(invite.createdBy)}
              </span>
            </div>
            <p className="text-sm break-all">
              {t("team.inviteLink")}: {link}
            </p>
            {TELEGRAM_BOT_USERNAME && (
              <p className="text-sm break-all">
                {t("team.inviteBotLink")}: https://t.me/{TELEGRAM_BOT_USERNAME}?start=
                {invite.code}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <CopyButton value={link} />
              <form action={revokeInviteAction}>
                <input type="hidden" name="inviteId" value={invite.id} />
                <Button type="submit" variant="ghost" size="sm">
                  {t("team.revoke")}
                </Button>
              </form>
            </div>
          </Card>
        );
      })}
    </section>
  );
}
