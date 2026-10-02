import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { CopyButton } from "@/components/copy-button";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { formatDate } from "@/lib/time";
import { requireUser } from "@/modules/core/auth/current-user";
import { INVITE_TTL_DAYS, listActiveInvites } from "@/modules/core/invites/service";
import { canChangeRole, canSendTestNotification, invitableRoles } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { listUsers } from "@/modules/core/users/service";

import {
  changeRoleAction,
  createInviteAction,
  revokeInviteAction,
  sendTestNotificationAction,
} from "../actions";

export default async function TeamPage({ searchParams }: PageProps<"/team">) {
  const user = await requireUser();
  const { notice } = await searchParams;
  const [users, invites, settings] = await Promise.all([
    listUsers(),
    listActiveInvites(user),
    getSettings(user.id),
  ]);
  const { APP_URL, TELEGRAM_BOT_USERNAME } = getEnv();
  const tz = settings.timezone;
  const roles = invitableRoles(user.role);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("team.title")}</h1>
      {notice === "testSent" && (
        <p role="status" className="bg-secondary rounded-md p-3 text-sm">
          {t("team.testSent")}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t("team.members")}</h2>
        {users.map((member) => {
          const isMe = member.id === user.id;
          const assignable = (["MANAGER", "MEMBER"] as const).filter((role) =>
            canChangeRole(user, member, role),
          );
          return (
            <Card key={member.id} className="gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{displayName(member)}</span>
                {member.telegramUsername && (
                  <span className="text-muted-foreground text-sm">@{member.telegramUsername}</span>
                )}
                <Badge variant={member.role === "OWNER" ? "default" : "secondary"}>
                  {t(`roles.${member.role}`)}
                </Badge>
                {isMe && <span className="text-muted-foreground text-xs">({t("common.you")})</span>}
              </div>
              <p className="text-muted-foreground text-xs">
                {t("team.since", { date: formatDate(member.createdAt, tz) })} ·{" "}
                {member.botChatId ? t("team.botLinked") : t("team.botNotLinked")}
              </p>
              <div className="flex flex-wrap gap-2">
                {assignable.length > 0 && (
                  <form action={changeRoleAction} className="flex gap-2">
                    <input type="hidden" name="userId" value={member.id} />
                    <NativeSelect
                      name="role"
                      defaultValue={member.role}
                      aria-label={t("team.changeRole")}
                    >
                      {assignable.map((role) => (
                        <option key={role} value={role}>
                          {t(`roles.${role}`)}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button type="submit" variant="outline" size="sm">
                      {t("team.changeRole")}
                    </Button>
                  </form>
                )}
                {canSendTestNotification(user, member.id) && (
                  <form action={sendTestNotificationAction}>
                    <input type="hidden" name="userId" value={member.id} />
                    <input type="hidden" name="back" value="/team" />
                    <Button type="submit" variant="outline" size="sm">
                      {t("team.sendTest")}
                    </Button>
                  </form>
                )}
              </div>
            </Card>
          );
        })}
      </section>

      {roles.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">{t("team.invites")}</h2>
          <Card className="gap-3">
            <CardTitle>{t("team.newInvite")}</CardTitle>
            <CardDescription>{t("team.inviteHint", { days: INVITE_TTL_DAYS })}</CardDescription>
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
                    {t("team.inviteExpires", { date: formatDate(invite.expiresAt, tz) })} ·{" "}
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
      )}
    </div>
  );
}
