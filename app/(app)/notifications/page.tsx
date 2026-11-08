import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { canOpenPath } from "@/modules/core/access/paths";
import { requireUser } from "@/modules/core/auth/current-user";
import { countUnread, listNotifications } from "@/modules/core/notifications/service";
import { getSettings } from "@/modules/core/settings/service";

import { markAllReadAction, markReadAction, openNotificationAction } from "../actions";

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const user = await requireUser();
  const params = await searchParams;
  const unreadOnly = params.filter === "unread";
  const page = Math.max(1, Number(params.page) || 1);
  const [{ items, more }, unread, settings] = await Promise.all([
    listNotifications(user.id, { unreadOnly, page }),
    countUnread(user.id),
    getSettings(user.id),
  ]);
  const href = (next: { unread?: boolean; page?: number }) => {
    const query = new URLSearchParams();
    if (next.unread ?? unreadOnly) query.set("filter", "unread");
    if ((next.page ?? 1) > 1) query.set("page", String(next.page));
    return `/notifications${query.size ? `?${query}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-medium md:text-2xl">{t("notifications.title")}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-secondary/70 inline-flex gap-0.5 rounded-full p-1 text-sm">
          {[false, true].map((only) => (
            <Link
              key={String(only)}
              href={href({ unread: only, page: 1 })}
              className={cn(
                "rounded-full px-3.5 py-1",
                only === unreadOnly ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
              )}
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

      {items.length === 0 && (
        <p className="text-muted-foreground">
          {unreadOnly ? t("notifications.noUnread") : t("notifications.empty")}
        </p>
      )}
      {items.map((n) => (
        <Card key={n.id} className={cn("gap-2", !n.readAt && "border-primary/40 bg-accent/40")}>
          <div className="flex items-start justify-between gap-2">
            <p className={cn(!n.readAt && "font-semibold")}>{n.title}</p>
            <span className="text-muted-foreground shrink-0 text-xs">
              {formatDateTime(n.createdAt, settings.timezone)}
            </span>
          </div>
          {n.body && <p className="text-muted-foreground text-sm">{n.body}</p>}
          <div className="flex gap-2">
            {/* Opening marks it read; a section the person can't open gets no link. */}
            {n.link && canOpenPath(user, n.link) && (
              <form action={openNotificationAction}>
                <input type="hidden" name="notificationId" value={n.id} />
                <Button type="submit" variant="link" size="sm" className="px-0">
                  {t("notifications.open")}
                </Button>
              </form>
            )}
            {!n.readAt && (
              <form action={markReadAction}>
                <input type="hidden" name="notificationId" value={n.id} />
                <Button type="submit" variant="ghost" size="sm">
                  {t("notifications.markRead")}
                </Button>
              </form>
            )}
          </div>
        </Card>
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
