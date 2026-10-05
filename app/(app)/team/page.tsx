import Link from "next/link";

import { LoadChart } from "@/components/team/load-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { CopyButton } from "@/components/copy-button";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { requireModule } from "@/modules/core/access/guard";
import { canUseModule } from "@/modules/core/access/actor";
import { INVITE_TTL_DAYS, listActiveInvites } from "@/modules/core/invites/service";
import { invitableRoles } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { listTeamCards, TEAM_FILTERS, type TeamFilter } from "@/modules/team/service";

import { createInviteAction, revokeInviteAction } from "../actions";

const FILTER_LABELS = {
  all: "team.filterAll",
  mine: "team.filterMine",
  overdue: "team.filterOverdue",
} as const;

export default async function TeamPage({ searchParams }: PageProps<"/team">) {
  const user = await requireModule("team");
  const params = await searchParams;
  const filter = TEAM_FILTERS.find((f) => f === params.filter) ?? "all";
  const search = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const [cards, invites, settings] = await Promise.all([
    listTeamCards(user, filter as TeamFilter, search),
    listActiveInvites(user),
    getSettings(user.id),
  ]);
  const { APP_URL, TELEGRAM_BOT_USERNAME } = getEnv();
  const tz = settings.timezone;
  const roles = invitableRoles(user.role);
  const filterHref = (f: string) =>
    `/team?${new URLSearchParams({ filter: f, ...(search ? { q: search } : {}) })}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("team.title")}</h1>
        {canUseModule(user, "structure") && (
          <Button asChild size="sm" variant="outline">
            <Link href="/team/structure">{t("team.org.open")}</Link>
          </Button>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <form className="flex gap-2">
          <input type="hidden" name="filter" value={filter} />
          <Input name="q" defaultValue={search} placeholder={t("team.search")} className="flex-1" />
          <Button type="submit" variant="secondary">
            {t("tasks.filters.apply")}
          </Button>
        </form>
        <div className="flex flex-wrap gap-1 text-sm">
          {TEAM_FILTERS.map((f) => (
            <Link
              key={f}
              href={filterHref(f)}
              className={cn(
                "rounded-full border px-3 py-1",
                f === filter ? "bg-primary text-primary-foreground" : "",
              )}
            >
              {t(FILTER_LABELS[f])}
            </Link>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ user: member, stats, manager }) => (
            <Link
              key={member.id}
              href={`/team/${member.id}`}
              className="bg-card hover:bg-accent/40 flex flex-col gap-2 rounded-xl border p-4 transition-colors"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{displayName(member)}</span>
                <Badge variant={member.role === "OWNER" ? "default" : "secondary"}>
                  {t(`roles.${member.role}`)}
                </Badge>
                {member.id === user.id && (
                  <span className="text-muted-foreground text-xs">({t("common.you")})</span>
                )}
              </span>
              <span className="text-muted-foreground text-xs">
                {member.position ?? t("team.noPosition")}
                {member.responsibility && ` · ${member.responsibility}`}
                {manager &&
                  ` · ${t("team.profile.manager").toLowerCase()}: ${displayName(manager)}`}
              </span>
              {stats && (
                <>
                  <span className="flex gap-3 text-xs">
                    <span>
                      {t("team.stats.active")}: <b>{stats.active}</b>
                    </span>
                    <span className={cn(stats.overdue > 0 && "text-destructive")}>
                      {t("team.stats.overdue")}: <b>{stats.overdue}</b>
                    </span>
                    {stats.onTime30.percent !== null && (
                      <span>
                        {t("team.stats.onTime30")}: <b>{stats.onTime30.percent}%</b>
                      </span>
                    )}
                  </span>
                  <LoadChart weeks={stats.load} compact />
                </>
              )}
            </Link>
          ))}
        </div>
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
