"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Role } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { modulesForRole } from "@/modules/core/registry";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

// Bottom bar on phones, sidebar on desktop. Items come from the module registry.
export function AppNav({ role, unreadCount }: { role: Role; unreadCount: number }) {
  const pathname = usePathname();
  const items = modulesForRole(role);

  return (
    <nav
      aria-label="Main"
      className="bg-background fixed inset-x-0 bottom-0 z-10 border-t pb-[env(safe-area-inset-bottom)] md:static md:w-56 md:shrink-0 md:border-t-0 md:border-r md:pb-0"
    >
      <div className="hidden px-4 py-5 text-lg font-semibold md:block">{t("app.name")}</div>
      <ul className="flex justify-around md:flex-col md:gap-1 md:px-2">
        {items.map(({ id, href, icon: Icon, titleKey, mobile }) => {
          const active = isActive(pathname, href);
          const badge = id === "notifications" && unreadCount > 0 ? unreadCount : null;
          return (
            <li
              key={id}
              className={cn("flex-1 md:flex-none", mobile === false && "hidden md:block")}
            >
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 px-1 py-2 text-[11px] md:flex-row md:gap-3 md:rounded-md md:px-3 md:text-sm",
                  active ? "text-foreground md:bg-accent font-medium" : "text-muted-foreground",
                )}
              >
                <span className="relative">
                  <Icon className="size-5" />
                  {badge && (
                    <span className="bg-destructive absolute -top-1.5 -right-2.5 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 text-white">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
                {t(titleKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// Phone-only top bar: app name and the notifications bell.
export function MobileHeader({ unreadCount }: { unreadCount: number }) {
  return (
    <header className="bg-background/95 sticky top-0 z-10 flex items-center justify-between border-b px-4 py-2 backdrop-blur md:hidden">
      <span className="font-semibold">{t("app.name")}</span>
      <Link href="/notifications" aria-label={t("nav.notifications")} className="relative p-1">
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="bg-destructive absolute -top-0.5 -right-1 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Link>
    </header>
  );
}
