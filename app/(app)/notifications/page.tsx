import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { listNotifications } from "@/modules/core/notifications/service";
import { getSettings } from "@/modules/core/settings/service";

import { markAllReadAction, markReadAction, sendTestNotificationAction } from "../actions";

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const user = await requireUser();
  const { notice } = await searchParams;
  const [notifications, settings] = await Promise.all([
    listNotifications(user.id),
    getSettings(user.id),
  ]);
  const hasUnread = notifications.some((n) => !n.readAt);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-medium md:text-2xl">{t("notifications.title")}</h1>
      {notice === "testSent" && (
        <p role="status" className="bg-secondary rounded-md p-3 text-sm">
          {t("team.testSent")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <form action={sendTestNotificationAction}>
          <input type="hidden" name="userId" value={user.id} />
          <Button type="submit" variant="outline" size="sm">
            {t("notifications.sendTestToMe")}
          </Button>
        </form>
        {hasUnread && (
          <form action={markAllReadAction}>
            <Button type="submit" variant="ghost" size="sm">
              {t("notifications.markAllRead")}
            </Button>
          </form>
        )}
      </div>

      {notifications.length === 0 && (
        <p className="text-muted-foreground">{t("notifications.empty")}</p>
      )}
      {notifications.map((n) => (
        <Card key={n.id} className={cn("gap-2", !n.readAt && "border-primary/40 bg-accent/40")}>
          <div className="flex items-start justify-between gap-2">
            <p className={cn(!n.readAt && "font-semibold")}>{n.title}</p>
            <span className="text-muted-foreground shrink-0 text-xs">
              {formatDateTime(n.createdAt, settings.timezone)}
            </span>
          </div>
          {n.body && <p className="text-muted-foreground text-sm">{n.body}</p>}
          <div className="flex gap-2">
            {n.link && (
              <Button asChild variant="link" size="sm" className="px-0">
                <Link href={n.link}>{t("notifications.open")}</Link>
              </Button>
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
    </div>
  );
}
