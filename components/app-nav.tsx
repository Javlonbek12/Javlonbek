"use client";

import {
  Bell,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import type { Role } from "@/lib/generated/prisma/enums";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { modulesForRole } from "@/modules/core/registry";

function matches(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

// The most specific matching item is active (/team/structure → "Оргструктура", not "Команда").
function activeHref(pathname: string, hrefs: string[]) {
  return hrefs.filter((href) => matches(pathname, href)).sort((a, b) => b.length - a.length)[0];
}

// A year-long cookie the server reads on the next page load (theme, collapsed menu).
function remember(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

// The app's mark: a rounded tile with the initial.
function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary flex size-9 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white shadow-[0_6px_16px_-6px_var(--primary)]",
        className,
      )}
    >
      A
    </span>
  );
}

export type ShellUser = {
  name: string;
  role: Role;
  photoUrl: string | null;
};

function Avatar({ user, className }: { user: ShellUser; className?: string }) {
  if (user.photoUrl)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Telegram profile picture
      <img
        src={user.photoUrl}
        alt=""
        className={cn("size-9 shrink-0 rounded-full object-cover", className)}
      />
    );
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--series-1)] to-[var(--series-7)] text-sm font-semibold text-white",
        className,
      )}
    >
      {user.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function Badge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        "bg-destructive min-w-5 rounded-full px-1.5 text-center text-[10px] leading-5 font-semibold text-white",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

// Bottom bar on phones, sidebar on desktop (can be collapsed to icons). Items come from the
// module registry.
export function AppNav({
  role,
  unreadCount,
  enabled,
  user,
  collapsed: initiallyCollapsed = false,
}: {
  role: Role;
  unreadCount: number;
  enabled?: string[];
  user: ShellUser;
  collapsed?: boolean;
}) {
  const t = useT();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const items = modulesForRole(role, undefined, enabled);
  const current = activeHref(
    pathname,
    items.map((item) => item.href),
  );
  const toggle = () => {
    remember("nav", collapsed ? "open" : "collapsed");
    setCollapsed(!collapsed);
  };

  return (
    <nav
      aria-label="Main"
      className={cn(
        "bg-card/95 fixed inset-x-0 bottom-0 z-20 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur",
        "md:bg-sidebar md:text-sidebar-foreground md:sticky md:top-0 md:flex md:h-dvh md:shrink-0 md:flex-col md:border-t-0 md:border-r md:pb-0 md:backdrop-blur-none",
        collapsed ? "md:w-[76px]" : "md:w-64",
      )}
    >
      <div
        className={cn(
          "hidden items-center gap-2.5 pt-5 pb-6 md:flex",
          collapsed ? "flex-col px-3" : "px-5",
        )}
      >
        <BrandMark />
        {!collapsed && (
          <span className="text-foreground text-lg font-bold tracking-tight">{t("app.name")}</span>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? t("shell.expand") : t("shell.collapse")}
          title={collapsed ? t("shell.expand") : t("shell.collapse")}
          className={cn(
            "text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg p-1.5",
            !collapsed && "ml-auto",
          )}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>
      </div>
      <ul
        className={cn(
          "flex justify-around px-1 md:flex-1 md:flex-col md:justify-start md:gap-1 md:overflow-y-auto",
          collapsed ? "md:px-3" : "md:px-3.5",
        )}
      >
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
                title={collapsed ? t(titleKey) : undefined}
                className={cn(
                  "group flex flex-col items-center gap-1 px-1 pt-2 pb-1.5 text-[11px] transition-colors md:flex-row md:gap-3 md:rounded-xl md:py-2.5 md:text-sm",
                  collapsed ? "md:justify-center md:px-0" : "md:px-3.5",
                  active
                    ? "text-primary md:bg-sidebar-active font-semibold md:text-white md:shadow-[0_8px_18px_-8px_var(--sidebar-active)]"
                    : "text-muted-foreground md:text-sidebar-foreground md:hover:bg-accent md:hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "relative flex h-7 w-12 items-center justify-center rounded-full transition-colors md:h-auto md:w-auto md:rounded-none md:bg-transparent",
                    active && "bg-secondary md:bg-transparent",
                  )}
                >
                  <Icon className="size-5 md:size-[19px]" strokeWidth={active ? 2.25 : 1.75} />
                  {badge && (
                    <Badge
                      count={badge}
                      className={cn(
                        "absolute -top-1 right-1 md:-top-2 md:-right-3",
                        !collapsed && "md:hidden",
                      )}
                    />
                  )}
                </span>
                <span className={cn(collapsed && "md:hidden")}>{t(titleKey)}</span>
                {badge && !collapsed && <Badge count={badge} className="ml-auto hidden md:block" />}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="hidden p-3 md:block">
        <Link
          href="/settings"
          title={t("shell.profile")}
          className={cn(
            "hover:bg-accent flex items-center gap-3 rounded-xl border p-2.5",
            collapsed && "justify-center border-transparent p-1.5",
          )}
        >
          <Avatar user={user} />
          {!collapsed && (
            <>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-foreground truncate text-sm font-semibold">{user.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {t(`roles.${user.role}`)}
                </span>
              </span>
              <ChevronRight className="text-muted-foreground size-4" />
            </>
          )}
        </Link>
      </div>
    </nav>
  );
}

function ThemeButton({ dark: initiallyDark, className }: { dark: boolean; className?: string }) {
  const t = useT();
  const [dark, setDark] = useState(initiallyDark);
  const toggle = () => {
    // From the page itself: the phone and desktop bars each have a button.
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    remember("theme", next ? "dark" : "light");
    setDark(next);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? t("shell.themeLight") : t("shell.themeDark")}
      title={dark ? t("shell.themeLight") : t("shell.themeDark")}
      className={cn(
        "bg-card hover:bg-accent text-muted-foreground hover:text-foreground flex size-10 items-center justify-center rounded-full border",
        className,
      )}
    >
      {dark ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
    </button>
  );
}

function BellLink({ unreadCount, className }: { unreadCount: number; className?: string }) {
  const t = useT();
  return (
    <Link
      href="/notifications"
      aria-label={t("nav.notifications")}
      className={cn(
        "bg-card hover:bg-accent text-muted-foreground hover:text-foreground relative flex size-10 items-center justify-center rounded-full border",
        className,
      )}
    >
      <Bell className="size-[18px]" />
      {unreadCount > 0 && <Badge count={unreadCount} className="absolute -top-1 -right-1.5" />}
    </Link>
  );
}

// Desktop top bar: search over tasks, theme, notifications and a new task.
export function TopBar({ unreadCount, dark }: { unreadCount: number; dark: boolean }) {
  const t = useT();
  const router = useRouter();
  return (
    <div className="hidden items-center gap-3 md:flex">
      <form
        role="search"
        className="relative max-w-xl flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          const q = new FormData(event.currentTarget).get("q")?.toString().trim();
          router.push(q ? `/tasks?q=${encodeURIComponent(q)}` : "/tasks");
        }}
      >
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2" />
        <input
          name="q"
          type="search"
          placeholder={t("shell.search")}
          aria-label={t("shell.searchLabel")}
          className="bg-card focus-visible:ring-ring/40 h-11 w-full rounded-full border pr-4 pl-11 text-sm shadow-[0_1px_2px_oklch(0_0_0/0.03)] outline-none focus-visible:ring-[3px]"
        />
      </form>
      <div className="ml-auto flex items-center gap-2.5">
        <ThemeButton dark={dark} />
        <BellLink unreadCount={unreadCount} />
        <Button asChild className="h-10 rounded-full px-5 shadow-[0_8px_18px_-8px_var(--primary)]">
          <Link href="/tasks/new">
            <Plus />
            {t("tasks.newTask")}
          </Link>
        </Button>
      </div>
    </div>
  );
}

// Phone-only top bar: app name, theme, settings and the notifications bell.
export function MobileHeader({ unreadCount, dark }: { unreadCount: number; dark: boolean }) {
  const t = useT();
  return (
    <header className="bg-card/95 sticky top-0 z-20 flex items-center justify-between border-b px-4 py-2 backdrop-blur md:hidden">
      <span className="flex items-center gap-2">
        <BrandMark className="size-8 rounded-lg text-sm" />
        <span className="text-[15px] font-bold tracking-tight">{t("app.name")}</span>
      </span>
      <div className="flex items-center gap-1.5">
        <ThemeButton dark={dark} className="size-9 border-transparent" />
        <Link
          href="/settings"
          aria-label={t("nav.settings")}
          className="text-muted-foreground flex size-9 items-center justify-center rounded-full"
        >
          <Settings className="size-[18px]" />
        </Link>
        <BellLink unreadCount={unreadCount} className="size-9 border-transparent" />
      </div>
    </header>
  );
}
