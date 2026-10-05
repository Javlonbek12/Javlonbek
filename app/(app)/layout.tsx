import { AppNav, MobileHeader } from "@/components/app-nav";
import { requireUser } from "@/modules/core/auth/current-user";
import { countUnread } from "@/modules/core/notifications/service";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const unreadCount = await countUnread(user.id);

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <MobileHeader unreadCount={unreadCount} />
      <AppNav role={user.role} unreadCount={unreadCount} enabled={user.access.modules} />
      <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 pt-5 pb-28 md:px-10 md:pt-9 md:pb-12">
        {children}
      </main>
    </div>
  );
}
