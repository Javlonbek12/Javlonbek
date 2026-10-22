import { cookies } from "next/headers";

import { AppNav, MobileHeader, TopBar } from "@/components/app-nav";
import { requireUser } from "@/modules/core/auth/current-user";
import { countUnread } from "@/modules/core/notifications/service";
import { displayName } from "@/modules/core/users/display-name";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const [unreadCount, jar] = await Promise.all([countUnread(user.id), cookies()]);
  const dark = jar.get("theme")?.value === "dark";

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <MobileHeader unreadCount={unreadCount} dark={dark} />
      <AppNav
        role={user.role}
        unreadCount={unreadCount}
        enabled={user.access.modules}
        user={{ name: displayName(user), role: user.role, photoUrl: user.photoUrl }}
        collapsed={jar.get("nav")?.value === "collapsed"}
      />
      <div className="flex w-full min-w-0 flex-1 flex-col gap-6 px-4 pt-5 pb-28 md:px-8 md:pt-6 md:pb-12 2xl:px-10">
        <TopBar unreadCount={unreadCount} dark={dark} />
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
