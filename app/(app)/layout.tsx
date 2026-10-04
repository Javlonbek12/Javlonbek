import { AppNav, MobileHeader } from "@/components/app-nav";
import { requireUser } from "@/modules/core/auth/current-user";
import { countUnread } from "@/modules/core/notifications/service";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const unreadCount = await countUnread(user.id);

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <MobileHeader unreadCount={unreadCount} />
      <AppNav role={user.role} unreadCount={unreadCount} />
      <main className="mx-auto w-full max-w-5xl min-w-0 flex-1 p-4 pb-24 md:p-8">{children}</main>
    </div>
  );
}
