import Link from "next/link";

import { InviteSection } from "@/components/team/invite-section";
import { LoadChart } from "@/components/team/load-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireModule } from "@/modules/core/access/guard";
import { canUseModule } from "@/modules/core/access/actor";
import { invitableRoles } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { listTeamCards, TEAM_FILTERS, type TeamFilter } from "@/modules/team/service";

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
  const [cards, settings] = await Promise.all([
    listTeamCards(user, filter as TeamFilter, search),
    getSettings(user.id),
  ]);
  const canInvite = invitableRoles(user.role).length > 0;
  const filterHref = (f: string) =>
    `/team?${new URLSearchParams({ filter: f, ...(search ? { q: search } : {}) })}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-medium md:text-2xl">{t("team.title")}</h1>
        <div className="flex flex-wrap gap-2">
          {canUseModule(user, "structure") && (
            <Button asChild size="sm" variant="outline">
              <Link href="/team/structure">{t("team.org.open")}</Link>
            </Button>
          )}
        </div>
      </div>

      {/* Inviting comes first: it is what a manager most often comes here for. */}
      {canInvite && (
        <details className="group">
          <summary className="bg-primary text-primary-foreground inline-flex h-9 cursor-pointer list-none items-center rounded-full px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
            {t("team.invite")}
          </summary>
          <div className="pt-3">
            <InviteSection user={user} timezone={settings.timezone} />
          </div>
        </details>
      )}

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
    </div>
  );
}
