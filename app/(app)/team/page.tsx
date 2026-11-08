import { BellOff } from "lucide-react";
import Link from "next/link";

import { Avatar } from "@/components/team/avatar";
import { InviteSection } from "@/components/team/invite-section";
import { LoadChart } from "@/components/team/load-chart";
import { onTimeText, StatLinks } from "@/components/team/stat-links";
import { TeamSearch } from "@/components/team/team-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireModule } from "@/modules/core/access/guard";
import { canUseModule } from "@/modules/core/access/actor";
import { invitableRoles } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { listTeam, TEAM_FILTERS, type TeamFilter } from "@/modules/team/service";

const FILTER_LABELS = {
  all: "team.filterAll",
  mine: "team.filterMine",
  overdue: "team.filterOverdue",
  nobot: "team.filterNoBot",
  deactivated: "team.filterDeactivated",
} as const;

type Card = Awaited<ReturnType<typeof listTeam>>["cards"][number];

// Who acts on «бот не подключён»: the owner and managers (they invite and follow up).
const seesBot = (role: string) => role === "OWNER" || role === "MANAGER";

function NameLine({ card, viewerId }: { card: Card; viewerId: string }) {
  const { user: member } = card;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Link href={`/team/${member.id}`} className="font-medium hover:underline">
        {displayName(member)}
      </Link>
      {member.role !== "MEMBER" && (
        <Badge variant={member.role === "OWNER" ? "default" : "secondary"}>
          {t(`roles.${member.role}`)}
        </Badge>
      )}
      {member.id === viewerId && (
        <span className="text-muted-foreground text-xs">({t("common.you")})</span>
      )}
      {member.deactivatedAt && <Badge variant="outline">{t("team.deactivation.badge")}</Badge>}
    </span>
  );
}

function Subtitle({ card }: { card: Card }) {
  const { user: member, manager } = card;
  return (
    <span className="text-muted-foreground line-clamp-2 text-xs">
      {member.position ?? t("team.noPosition")}
      {member.responsibility && ` · ${member.responsibility}`}
      {manager && ` · ${t("team.profile.manager").toLowerCase()}: ${displayName(manager)}`}
    </span>
  );
}

function BotOff() {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <BellOff className="size-3.5" aria-hidden />
      {t("team.botNotLinked")}
    </span>
  );
}

// A short row: who, what they do, their numbers (links to their tasks).
function Row({ card, viewerId, showBot }: { card: Card; viewerId: string; showBot: boolean }) {
  const { user: member, stats } = card;
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <Avatar name={displayName(member)} muted={!!member.deactivatedAt} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <NameLine card={card} viewerId={viewerId} />
        <Subtitle card={card} />
        {(stats || (showBot && !member.botChatId)) && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {stats && !member.deactivatedAt && <StatLinks userId={member.id} stats={stats} />}
            {showBot && !member.botChatId && !member.deactivatedAt && <BotOff />}
          </span>
        )}
      </div>
    </li>
  );
}

// The bigger card with the weekly chart («Карточками»).
function CardView({ card, viewerId, showBot }: { card: Card; viewerId: string; showBot: boolean }) {
  const { user: member, stats } = card;
  const onTime = stats ? onTimeText(stats.onTime30) : null;
  return (
    <div className="bg-card flex flex-col gap-2 rounded-xl border p-4">
      <span className="flex items-start gap-3">
        <Avatar name={displayName(member)} muted={!!member.deactivatedAt} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <NameLine card={card} viewerId={viewerId} />
          <Subtitle card={card} />
        </span>
      </span>
      {showBot && !member.botChatId && !member.deactivatedAt && <BotOff />}
      {stats && !member.deactivatedAt && (
        <>
          <span className="flex flex-wrap items-center gap-x-3">
            <StatLinks userId={member.id} stats={stats} />
            {onTime && (
              <span className="text-xs">
                {t("team.stats.onTime30")}: <b>{onTime}</b>
              </span>
            )}
          </span>
          <LoadChart weeks={stats.load} compact />
        </>
      )}
    </div>
  );
}

// Groups by team from the org chart, in a stable order: the top of the chart, the teams by name,
// then the people the chart doesn't have yet.
function groupByTeam(cards: Card[]) {
  const groups = new Map<string | null, Card[]>();
  for (const card of cards) groups.set(card.team, [...(groups.get(card.team) ?? []), card]);
  const rank = (team: string | null) => (team === "" ? 0 : team === null ? 2 : 1);
  return [...groups.entries()].sort(
    ([a], [b]) => rank(a) - rank(b) || (a ?? "").localeCompare(b ?? ""),
  );
}

export default async function TeamPage({ searchParams }: PageProps<"/team">) {
  const user = await requireModule("team");
  const params = await searchParams;
  const filter: TeamFilter = TEAM_FILTERS.find((f) => f === params.filter) ?? "all";
  const view = params.view === "cards" ? "cards" : "list";
  const search = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const [{ cards, counts, hasChart }, settings] = await Promise.all([
    listTeam(user, filter, search),
    getSettings(user.id),
  ]);
  const showBot = seesBot(user.role);
  // «Отключённые» appears once somebody is deactivated; «Бот не подключён» for those who act on it.
  const filters = TEAM_FILTERS.filter((f) => {
    if (f === filter) return true;
    if (f === "deactivated") return counts.deactivated > 0;
    return f !== "nobot" || showBot;
  });
  const canInvite = invitableRoles(user.role).length > 0;
  const href = (next: { filter?: string; view?: string }) => {
    const query = new URLSearchParams();
    const f = next.filter ?? filter;
    const v = next.view ?? view;
    if (f !== "all") query.set("filter", f);
    if (v !== "list") query.set("view", v);
    if (search) query.set("q", search);
    return `/team${query.size ? `?${query}` : ""}`;
  };
  const grouped = view === "list" && hasChart && filter !== "deactivated";

  return (
    <div className="flex flex-col gap-5">
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
        <details className="group" open={params.invite === "1"}>
          <summary className="bg-primary text-primary-foreground inline-flex h-9 cursor-pointer list-none items-center rounded-full px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
            {t("team.invite")}
          </summary>
          <div className="pt-3">
            <InviteSection
              user={user}
              timezone={settings.timezone}
              fresh={typeof params.new === "string" ? params.new : undefined}
            />
          </div>
        </details>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <TeamSearch
            q={search}
            hidden={{
              ...(filter !== "all" ? { filter } : {}),
              ...(view !== "list" ? { view } : {}),
            }}
          />
          <div className="bg-secondary/70 inline-flex gap-0.5 rounded-full p-1 text-sm">
            {(["list", "cards"] as const).map((v) => (
              <Link
                key={v}
                href={href({ view: v })}
                className={cn(
                  "rounded-full px-3.5 py-1",
                  v === view ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
                )}
              >
                {t(v === "list" ? "team.viewList" : "team.viewCards")}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1 text-sm">
          {filters.map((f) => (
            <Link
              key={f}
              href={href({ filter: f })}
              className={cn(
                "rounded-full border px-3 py-1",
                f === filter ? "bg-primary text-primary-foreground" : "",
              )}
            >
              {t(FILTER_LABELS[f])} <span className="opacity-70">{counts[f]}</span>
            </Link>
          ))}
        </div>
        {cards.length === 0 && <p className="text-muted-foreground text-sm">{t("team.empty")}</p>}
        {view === "cards" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <CardView key={card.user.id} card={card} viewerId={user.id} showBot={showBot} />
            ))}
          </div>
        ) : (
          (grouped ? groupByTeam(cards) : ([[undefined, cards]] as const)).map(([team, list]) => (
            <div key={team ?? "-"} className="flex flex-col gap-1.5">
              {team !== undefined && (
                <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {team === null ? t("team.groupOutside") : team || t("team.groupTop")}{" "}
                  <span className="font-normal">· {list.length}</span>
                </h2>
              )}
              <ul className="bg-card divide-y rounded-xl border">
                {list.map((card) => (
                  <Row key={card.user.id} card={card} viewerId={user.id} showBot={showBot} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
