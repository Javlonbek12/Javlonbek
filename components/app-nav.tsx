"use client";

import { Bell, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Role } from "@/lib/generated/prisma/enums";
import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";
import { modulesForRole } from "@/modules/core/registry";

function matches(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

// The most specific matching item is active (/team/structure → "Оргструктура", not "Команда").
function activeHref(pathname: string, hrefs: string[]) {
  return hrefs.filter((href) => matches(pathname, href)).sort((a, b) => b.length - a.length)[0];
}

// The app's mark: a rounded tile with the initial in the display face.
function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "font-display flex size-8 items-center justify-center rounded-[10px] bg-[oklch(0.62_0.15_268)] text-sm font-semibold text-white shadow-[0_1px_0_oklch(1_0_0/0.25)_inset]",
        className,
      )}
    >
      A
    </span>
  );
}

// Bottom bar on phones, sidebar on desktop. Items come from the module registry.
export function AppNav({
  role,
  unreadCount,
  enabled,
}: {
  role: Role;
  unreadCount: number;
  enabled?: string[];
}) {
  const t = useT();
  const pathname = usePathname();
  const items = modulesForRole(role, undefined, enabled);
  const current = activeHref(
    pathname,
    items.map((item) => item.href),
  );

  return (
    <nav
      aria-label="Main"
      className="bg-card/95 md:bg-sidebar md:text-sidebar-foreground fixed inset-x-0 bottom-0 z-20 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:overflow-y-auto md:border-t-0 md:pb-0 md:backdrop-blur-none"
    >
      <div className="hidden items-center gap-2.5 px-5 pt-6 pb-7 md:flex">
        <BrandMark />
        <span className="font-display text-[15px] font-semibold tracking-tight text-white">
          {t("app.name")}
        </span>
      </div>
      <ul className="flex justify-around px-1 md:flex-col md:gap-0.5 md:px-3">
        {items.map(({ id, href, icon: Icon, titleKey, mobile }) => {
          const active = href === current;
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
                  "group flex flex-col items-center gap-1 px-1 pt-2 pb-1.5 text-[11px] transition-colors md:flex-row md:gap-3 md:rounded-xl md:px-3 md:py-2.5 md:text-sm",
                  active
                    ? "text-primary md:bg-sidebar-active font-semibold md:text-white"
                    : "text-muted-foreground md:text-sidebar-foreground md:hover:bg-white/5 md:hover:text-white",
                )}
              >
                <span
                  className={cn(
                    "relative flex h-7 w-12 items-center justify-center rounded-full transition-colors md:h-auto md:w-auto md:rounded-none md:bg-transparent",
                    active && "bg-secondary md:bg-transparent",
                  )}
                >
                  <Icon className="size-5 md:size-[18px]" strokeWidth={active ? 2.25 : 1.75} />
                  {badge && (
                    <span className="bg-destructive absolute -top-1 right-1 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold text-white md:-top-1.5 md:-right-2.5">
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
  const t = useT();
  return (
    <header className="bg-sidebar text-sidebar-foreground sticky top-0 z-20 flex items-center justify-between px-4 py-2.5 md:hidden">
      <span className="flex items-center gap-2">
        <BrandMark className="size-7 rounded-lg text-xs" />
        <span className="font-display text-sm font-semibold tracking-tight text-white">
          {t("app.name")}
        </span>
      </span>
      <div className="flex items-center gap-1">
        <Link
          href="/settings"
          aria-label={t("nav.settings")}
          className="rounded-full p-2 hover:bg-white/10"
        >
          <Settings className="size-5" strokeWidth={1.75} />
        </Link>
        <Link
          href="/notifications"
          aria-label={t("nav.notifications")}
          className="relative rounded-full p-2 hover:bg-white/10"
        >
          <Bell className="size-5" strokeWidth={1.75} />
          {unreadCount > 0 && (
            <span className="bg-destructive absolute top-0.5 right-0.5 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
