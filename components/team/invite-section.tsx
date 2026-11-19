import { createInviteAction, revokeInviteAction } from "@/app/(app)/actions";
import { CopyButton } from "@/components/copy-button";
import { ShareButton } from "@/components/team/share-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { INVITE_TTL_DAYS, listActiveInvites } from "@/modules/core/invites/service";
import { invitableRoles, type Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";

export const inviteLink = (code: string) => `${getEnv().APP_URL}/invite/${code}`;

// Straight to the bot with the code: Start there lets the newcomer in even when the sign-in button
// on the site does not work. Null when the bot is not set up.
export function inviteBotLink(code: string) {
  const { TELEGRAM_BOT_USERNAME } = getEnv();
  return TELEGRAM_BOT_USERNAME ? `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}` : null;
}

// The message to send with an invite: what to do, the link, and the bot link as a way round.
export function inviteMessage(code: string, forName?: string | null) {
  const text = t("team.shareText", { name: forName ? `${forName}, ` : "", link: inviteLink(code) });
  const bot = inviteBotLink(code);
  return bot ? `${text}\n\n${t("team.shareBotText", { link: bot })}` : text;
}

// Creating and cancelling invitations. On the team page, and in Settings → Приглашения for managers
// whose role has no Team section (by default managers don't): they invite their own people.
export async function InviteSection({
  user,
  timezone,
  from = "team",
  fresh,
}: {
  user: Actor;
  timezone: string;
  from?: "team" | "settings";
  // The invite just made: shown first and marked «Новое».
  fresh?: string;
}) {
  const roles = invitableRoles(user.role);
  if (roles.length === 0) return null;
  const invites = await listActiveInvites(user);

  return (
    <section id="invites" className="flex scroll-mt-20 flex-col gap-3">
      <Card className="gap-3">
        <CardTitle>{t("team.newInvite")}</CardTitle>
        <CardDescription>
          {t("team.inviteHint", { days: INVITE_TTL_DAYS })}
          {user.role === "MANAGER" && ` ${t("team.inviteManagerHint")}`}
        </CardDescription>
        <form action={createInviteAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="from" value={from} />
          <Input
            name="forName"
            maxLength={80}
            placeholder={t("team.inviteForPlaceholder")}
            aria-label={t("team.inviteFor")}
            className="w-full sm:w-56"
          />
          {/* A manager invites employees only: no choice to make. */}
          {roles.length === 1 ? (
            <input type="hidden" name="role" value={roles[0]} />
          ) : (
            <NativeSelect name="role" defaultValue="MEMBER" aria-label={t("team.inviteRole")}>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {t(`roles.${role}`)}
                </option>
              ))}
            </NativeSelect>
          )}
          <Button type="submit">{t("team.createInvite")}</Button>
        </form>
      </Card>
      {invites.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("team.noInvites")}</p>
      )}
      {invites.map((invite) => {
        const link = inviteLink(invite.code);
        const botLink = inviteBotLink(invite.code);
        const isNew = invite.id === fresh;
        return (
          <Card
            key={invite.id}
            className={cn("gap-2", isNew && "border-primary ring-primary/20 ring-2")}
          >
            <div className="flex flex-wrap items-center gap-2">
              {isNew && <Badge>{t("team.inviteNew")}</Badge>}
              <span className="font-medium">{invite.forName ?? t("team.inviteNoName")}</span>
              <Badge variant="secondary">{t(`roles.${invite.role}`)}</Badge>
              <span className="text-muted-foreground text-xs">
                {t("team.inviteExpires", { date: formatDate(invite.expiresAt, timezone) })} ·{" "}
                {displayName(invite.createdBy)}
              </span>
            </div>
            <p className="text-muted-foreground text-sm break-all">{link}</p>
            <div className="flex flex-wrap gap-2">
              <ShareButton text={inviteMessage(invite.code, invite.forName)} />
              <CopyButton value={link} label={t("team.copyLink")} />
              <form action={revokeInviteAction}>
                <input type="hidden" name="inviteId" value={invite.id} />
                <Button type="submit" variant="ghost" size="sm">
                  {t("team.revoke")}
                </Button>
              </form>
            </div>
            {botLink && (
              <div className="bg-muted/40 flex flex-col gap-1.5 rounded-lg p-2.5 text-xs">
                <span className="text-muted-foreground">{t("team.inviteBotLinkHint")}</span>
                <span className="break-all">{botLink}</span>
                <div>
                  <CopyButton value={botLink} label={t("team.copyBotLink")} />
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </section>
  );
}
