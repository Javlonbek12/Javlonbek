import { cookies } from "next/headers";
import { Suspense } from "react";

import { AppNav, MobileHeader, TopBar } from "@/components/app-nav";
import { DocumentTitle } from "@/components/document-title";
import { HelpButton } from "@/components/help/help-button";
import { NavigationProgress } from "@/components/navigation-progress";
import { readTheme, THEME_COOKIE } from "@/lib/theme";
import { requireUser } from "@/modules/core/auth/current-user";
import { countUnread } from "@/modules/core/notifications/service";
import { displayName } from "@/modules/core/users/display-name";
import { getRunningTimer } from "@/modules/tasks/time";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const [unreadCount, jar, timer] = await Promise.all([
    countUnread(user.id),
    cookies(),
    getRunningTimer(user.id),
  ]);
  const theme = readTheme(jar.get(THEME_COOKIE)?.value);
  const bars = { unreadCount, theme, timer };

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <Suspense>
        <NavigationProgress />
      </Suspense>
      <DocumentTitle />
      <MobileHeader {...bars} extra={<HelpButton className="size-9 border-transparent" />} />
      <AppNav
        role={user.role}
        unreadCount={unreadCount}
        enabled={user.access.modules}
        user={{ name: displayName(user), role: user.role, photoUrl: user.photoUrl }}
        collapsed={jar.get("nav")?.value === "collapsed"}
        phoneBar={user.phoneBar}
      />
      <div
        data-print="page"
        className="flex w-full min-w-0 flex-1 flex-col gap-6 px-4 pt-5 pb-28 md:px-8 md:pt-6 md:pb-12 2xl:px-10"
      >
        <TopBar {...bars} extra={<HelpButton className="size-10" />} />
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
