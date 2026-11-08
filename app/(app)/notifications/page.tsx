import { Settings2 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { addDays, formatDayLong, todayInTimezone } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { canOpenPath } from "@/modules/core/access/paths";
import { requireUser } from "@/modules/core/auth/current-user";
import {
  inAppDecisions,
  settleDecided,
  type InAppDecision,
} from "@/modules/core/notifications/decisions";
import { notificationGroupsFor } from "@/modules/core/notifications/groups";
import { countUnread, listNotifications } from "@/modules/core/notifications/service";
import { getSettings } from "@/modules/core/settings/service";

import {
  decideCoAssigneeFromNotificationAction,
  decideFromNotificationAction,
  markAllReadAction,
  markGroupReadAction,
  markReadAction,
  openNotificationAction,
} from "../actions";
import { NotificationIcon } from "./type-icon";

type Item = Awaited<ReturnType<typeof listNotifications>>["items"][number];

function Dot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("mt-1.5 size-2 shrink-0 rounded-full", on ? "bg-primary" : "bg-transparent")}
    />
  );
}

// The answer in one press; returning or declining needs a reason and opens the decision panel.
function DecisionButtons({ id, decision }: { id: string; decision: InAppDecision }) {
  if (decision.kind === "coAssignee")
    return (
      <div className="flex flex-wrap gap-2">
        {(["1", "0"] as const).map((approve) => (
          <form key={approve} action={decideCoAssigneeFromNotificationAction}>
            <input type="hidden" name="notificationId" value={id} />
            <input type="hidden" name="requestId" value={decision.requestId} />
            <input type="hidden" name="approve" value={approve} />
            <Button type="submit" size="sm" variant={approve === "1" ? "default" : "outline"}>
              {t(approve === "1" ? "notifications.coAdd" : "notifications.coDecline")}
            </Button>
          </form>
        ))}
      </div>
    );
  return (
    <div className="flex flex-wrap gap-2">
      <form action={decideFromNotificationAction}>
        <input type="hidden" name="notificationId" value={id} />
        <input type="hidden" name="taskId" value={decision.taskId} />
        <input type="hidden" name="to" value={decision.kind === "approve" ? "APPROVED" : "DONE"} />
        <Button type="submit" size="sm">
          {t(
            decision.kind === "accept"
              ? "notifications.accept"
              : decision.takeOn
                ? "notifications.takeOn"
                : "notifications.approve",
          )}
        </Button>
      </form>
      <Button asChild size="sm" variant="outline">
        <Link href={`/tasks/decide?task=${encodeURIComponent(decision.taskId)}`}>
          {t("notifications.giveBack")}
        </Link>
      </Button>
    </div>
  );
}

// A short row: icon, title and one line of text (a press opens it and marks it read), the time.
function Row({
  item,
  decision,
  canOpen,
  timezone,
}: {
  item: Item;
  decision?: InAppDecision;
  canOpen: boolean;
  timezone: string;
}) {
  const unread = !item.readAt;
  const text = (
    <>
      <span className={cn("block truncate text-sm", unread ? "font-semibold" : "font-medium")}>
        {item.title}
      </span>
      {item.body && <span className="text-muted-foreground line-clamp-2 text-sm">{item.body}</span>}
    </>
  );
  return (
    <li className="flex items-start gap-2 px-3 py-2.5">
      <Dot on={unread} />
      <NotificationIcon type={item.type} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Opening marks it read; a section the person can't open gets no link. */}
        {canOpen || unread ? (
          <form action={canOpen ? openNotificationAction : markReadAction}>
            <input type="hidden" name="notificationId" value={item.id} />
            <button type="submit" className="w-full text-left hover:underline">
              {text}
            </button>
          </form>
        ) : (
          <div>{text}</div>
        )}
        {decision && unread && <DecisionButtons id={item.id} decision={decision} />}
      </div>
      <span className="text-muted-foreground shrink-0 pt-0.5 text-xs tabular-nums">
        {formatTime(item.createdAt, timezone)}
      </span>
    </li>
  );
}

// Several alike on one day («Пост на проверку» ×4): one row with the count, opened on press.
function GroupRow({
  items,
  canOpen,
  timezone,
}: {
  items: Item[];
  canOpen: (item: Item) => boolean;
  timezone: string;
}) {
  const first = items[0]!;
  const unread = items.filter((n) => !n.readAt);
  return (
    <li className="px-3 py-2.5">
      <details>
        <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
          <Dot on={unread.length > 0} />
          <NotificationIcon type={first.type} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span
              className={cn("truncate text-sm", unread.length ? "font-semibold" : "font-medium")}
            >
              {first.title}{" "}
              <span className="text-muted-foreground font-normal">· {items.length}</span>
            </span>
            <span className="text-muted-foreground text-sm">
              {t("notifications.groupMore", { count: items.length })}
            </span>
          </span>
          <span className="text-muted-foreground shrink-0 pt-0.5 text-xs tabular-nums">
            {formatTime(first.createdAt, timezone)}
          </span>
        </summary>
        <ul className="mt-2 ml-6 divide-y rounded-lg border">
          {items.map((item) => (
            <Row key={item.id} item={item} canOpen={canOpen(item)} timezone={timezone} />
          ))}
        </ul>
        {unread.length > 0 && (
          <form action={markGroupReadAction} className="mt-1 ml-6">
            {unread.map((n) => (
              <input key={n.id} type="hidden" name="notificationId" value={n.id} />
            ))}
            <Button type="submit" variant="ghost" size="sm">
              {t("notifications.markGroupRead")}
            </Button>
          </form>
        )}
      </details>
    </li>
  );
}

// A day's notifications: alike ones (same kind and title, nothing to decide) are put together.
function collapse(items: Item[], decisions: Map<string, InAppDecision>) {
  const out: Item[][] = [];
  const byKey = new Map<string, Item[]>();
  for (const item of items) {
    if (decisions.has(item.id)) {
      out.push([item]);
      continue;
    }
    const key = `${item.type}\u0000${item.title}`;
    const group = byKey.get(key);
    if (group) group.push(item);
    else {
      const fresh = [item];
      byKey.set(key, fresh);
      out.push(fresh);
    }
  }
  return out;
}

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const user = await requireUser();
  const params = await searchParams;
  const unreadOnly = params.filter === "unread";
  const page = Math.max(1, Number(params.page) || 1);
  const groups = notificationGroupsFor(user);
  const group = groups.find((g) => g.id === params.group) ?? null;
  // Notifications already decided read themselves first; the rest may get their buttons.
  const pending = await settleDecided(user.id);
  const [{ items, more }, unread, settings, decisions] = await Promise.all([
    listNotifications(user.id, { unreadOnly, page, types: group?.types }),
    countUnread(user.id, { settle: false }),
    getSettings(user.id),
    inAppDecisions(user, pending),
  ]);
  const today = todayInTimezone(settings.timezone);
  const href = (next: { unread?: boolean; page?: number; group?: string | null }) => {
    const query = new URLSearchParams();
    if (next.unread ?? unreadOnly) query.set("filter", "unread");
    const g = next.group === undefined ? group?.id : next.group;
    if (g) query.set("group", g);
    if ((next.page ?? 1) > 1) query.set("page", String(next.page));
    return `/notifications${query.size ? `?${query}` : ""}`;
  };
  const dayLabel = (day: string) =>
    day === today
      ? t("notifications.today")
      : day === addDays(today, -1)
        ? t("notifications.yesterday")
        : `${formatDayLong(day)}${day.slice(0, 4) !== today.slice(0, 4) ? ` ${day.slice(0, 4)}` : ""}`;
  const days = new Map<string, Item[]>();
  for (const item of items) {
    const day = todayInTimezone(settings.timezone, item.createdAt);
    days.set(day, [...(days.get(day) ?? []), item]);
  }
  const canOpen = (item: Item) => !!item.link && canOpenPath(user, item.link);
  const chip = (active: boolean) =>
    cn(
      "rounded-full px-3.5 py-1",
      active ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-medium md:text-2xl">{t("notifications.title")}</h1>
        <Link
          href="/settings#telegram-types"
          className="text-muted-foreground inline-flex items-center gap-1.5 text-sm hover:underline"
        >
          <Settings2 className="size-4" aria-hidden />
          {t("notifications.whatToSend")}
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-secondary/70 inline-flex gap-0.5 rounded-full p-1 text-sm">
          {[false, true].map((only) => (
            <Link
              key={String(only)}
              href={href({ unread: only, page: 1 })}
              className={chip(only === unreadOnly)}
            >
              {only ? t("notifications.unread", { count: unread }) : t("notifications.all")}
            </Link>
          ))}
        </div>
        {unread > 0 && (
          <form action={markAllReadAction}>
            <Button type="submit" variant="ghost" size="sm">
              {t("notifications.markAllRead")}
            </Button>
          </form>
        )}
      </div>
      {groups.length > 1 && (
        <div className="flex flex-wrap gap-1 text-sm">
          {[null, ...groups.map((g) => g.id)].map((id) => (
            <Link
              key={id ?? "all"}
              href={href({ group: id, page: 1 })}
              className={cn(
                "rounded-full border px-3 py-1",
                (group?.id ?? null) === id ? "bg-primary text-primary-foreground" : "",
              )}
            >
              {id ? t(`settings.groups.${id}`) : t("notifications.allKinds")}
            </Link>
          ))}
        </div>
      )}

      {items.length === 0 && (
        <p className="text-muted-foreground">
          {unreadOnly ? t("notifications.noUnread") : t("notifications.empty")}
        </p>
      )}
      {[...days].map(([day, list]) => (
        <section key={day} className="flex flex-col gap-1.5">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {dayLabel(day)}
          </h2>
          <ul className="bg-card divide-y rounded-xl border">
            {collapse(list, decisions).map((set) =>
              set.length > 1 ? (
                <GroupRow
                  key={set[0]!.id}
                  items={set}
                  canOpen={canOpen}
                  timezone={settings.timezone}
                />
              ) : (
                <Row
                  key={set[0]!.id}
                  item={set[0]!}
                  decision={decisions.get(set[0]!.id)}
                  canOpen={canOpen(set[0]!)}
                  timezone={settings.timezone}
                />
              ),
            )}
          </ul>
        </section>
      ))}

      {(page > 1 || more) && (
        <div className="flex flex-wrap gap-2">
          {page > 1 && (
            <Button asChild variant="outline" size="sm">
              <Link href={href({ page: page - 1 })}>{t("notifications.newer")}</Link>
            </Button>
          )}
          {more && (
            <Button asChild variant="outline" size="sm">
              <Link href={href({ page: page + 1 })}>{t("notifications.older")}</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
