import { cookies } from "next/headers";
import { Suspense } from "react";

import { AppNav, MobileHeader, TopBar } from "@/components/app-nav";
import { DocumentTitle } from "@/components/document-title";
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
  // Extra round buttons for both headers (e.g. the AI help): pass them as `extra` to MobileHeader
  // and TopBar.
  const bars = { unreadCount, theme, timer };

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <Suspense>
        <NavigationProgress />
      </Suspense>
      <DocumentTitle />
      <MobileHeader {...bars} />
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
        <TopBar {...bars} />
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
