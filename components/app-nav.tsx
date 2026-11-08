"use client";

import {
  Bell,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import type { Role } from "@/lib/generated/prisma/enums";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TimerPill } from "@/components/timer-pill";
import { modulesForRole, PHONE_BAR } from "@/modules/core/registry";
import type { RunningTimer } from "@/modules/tasks/running-timer";

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

type NavItem = ReturnType<typeof modulesForRole>[number];

// One menu item: a row in the desktop sidebar, a tile in the phone's «Ещё».
function NavLink({
  item,
  active,
  badge,
  collapsed,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  badge: number | null;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const t = useT();
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={collapsed ? t(item.titleKey) : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-xl py-2 text-sm transition-colors",
        collapsed ? "justify-center px-0" : "px-3.5",
        active
          ? "bg-sidebar-active font-semibold text-white shadow-[0_8px_18px_-8px_var(--sidebar-active)]"
          : "text-sidebar-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <span className="relative flex items-center justify-center">
        <Icon className="size-[19px]" strokeWidth={active ? 2.25 : 1.75} />
        {badge && collapsed && <Badge count={badge} className="absolute -top-2 -right-3" />}
      </span>
      <span className={cn(collapsed && "hidden")}>{t(item.titleKey)}</span>
      {badge && !collapsed && <Badge count={badge} className="ml-auto" />}
    </Link>
  );
}

// Sidebar on desktop (grouped, can be collapsed to icons); on phones a bottom bar with the main
// four sections and «Ещё» that opens every other section. Items come from the module registry.
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
  const [moreOpen, setMoreOpen] = useState(false);
  const items = modulesForRole(role, undefined, enabled);
  const current = activeHref(
    pathname,
    items.map((item) => item.href),
  );
  const badgeOf = (item: NavItem) =>
    item.id === "notifications" && unreadCount > 0 ? unreadCount : null;
  const bar = PHONE_BAR.map((id) => items.find((item) => item.id === id))
    .filter((item): item is NavItem => Boolean(item))
    .slice(0, 4);
  const more = items.filter((item) => !bar.includes(item));
  const moreActive = more.some((item) => item.href === current);
  const groups = [...new Set(items.map((item) => item.group))];
  const toggle = () => {
    remember("nav", collapsed ? "open" : "collapsed");
    setCollapsed(!collapsed);
  };

  return (
    <>
      {/* Desktop sidebar */}
      <nav
        aria-label="Main"
        className={cn(
          "bg-sidebar text-sidebar-foreground sticky top-0 hidden h-dvh shrink-0 flex-col border-r md:flex",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2.5 pt-5 pb-3",
            collapsed ? "flex-col px-3" : "px-5",
          )}
        >
          <BrandMark />
          {!collapsed && (
            <span className="text-foreground text-lg font-bold tracking-tight">
              {t("app.name")}
            </span>
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
        <div
          className={cn(
            "flex flex-1 flex-col gap-2 overflow-y-auto pb-2",
            collapsed ? "px-3" : "px-3.5",
          )}
        >
          {groups.map((group) => (
            <div key={group} className="flex flex-col gap-0.5">
              {!collapsed && (
                <span className="text-muted-foreground px-3.5 pb-0.5 text-[11px] font-semibold tracking-wide uppercase">
                  {t(`shell.groups.${group}`)}
                </span>
              )}
              <ul className="flex flex-col gap-0.5">
                {items
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <li key={item.id}>
                      <NavLink
                        item={item}
                        active={item.href === current}
                        badge={badgeOf(item)}
                        collapsed={collapsed}
                      />
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="p-3">
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
                  <span className="text-foreground truncate text-sm font-semibold">
                    {user.name}
                  </span>
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

      {/* Phone bottom bar */}
      <nav
        aria-label="Main mobile"
        className="bg-card/95 fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="flex justify-around px-1">
          {bar.map((item) => {
            const active = item.href === current && !moreOpen;
            const Icon = item.icon;
            return (
              <li key={item.id} className="flex-1">
                <Link
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1 px-1 pt-2 pb-1.5 text-[11px]",
                    active ? "text-primary font-semibold" : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-12 items-center justify-center rounded-full",
                      active && "bg-secondary",
                    )}
                  >
                    <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} />
                  </span>
                  {t(item.titleKey)}
                </Link>
              </li>
            );
          })}
          {more.length > 0 && (
            <li className="flex-1">
              <button
                type="button"
                onClick={() => setMoreOpen(!moreOpen)}
                aria-expanded={moreOpen}
                className={cn(
                  "flex w-full flex-col items-center gap-1 px-1 pt-2 pb-1.5 text-[11px]",
                  moreOpen || moreActive ? "text-primary font-semibold" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "relative flex h-7 w-12 items-center justify-center rounded-full",
                    (moreOpen || moreActive) && "bg-secondary",
                  )}
                >
                  <Menu className="size-5" strokeWidth={moreOpen ? 2.25 : 1.75} />
                  {unreadCount > 0 && (
                    <Badge count={unreadCount} className="absolute -top-1 right-1" />
                  )}
                </span>
                {t("shell.more")}
              </button>
            </li>
          )}
        </ul>
      </nav>

      {/* «Ещё»: every other section, grouped, above the bottom bar. */}
      {moreOpen && (
        <div className="fixed inset-0 z-20 md:hidden">
          <button
            type="button"
            aria-label={t("shell.close")}
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          <div className="bg-card absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold">{t("shell.moreTitle")}</span>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label={t("shell.close")}
                className="text-muted-foreground hover:bg-accent rounded-full p-1.5"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {groups
                .filter((group) => more.some((item) => item.group === group))
                .map((group) => (
                  <div key={group} className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                      {t(`shell.groups.${group}`)}
                    </span>
                    <ul className="grid grid-cols-2 gap-1.5">
                      {more
                        .filter((item) => item.group === group)
                        .map((item) => (
                          <li key={item.id}>
                            <NavLink
                              item={item}
                              active={item.href === current}
                              badge={badgeOf(item)}
                              collapsed={false}
                              onClick={() => setMoreOpen(false)}
                            />
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </>
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
export function TopBar({
  unreadCount,
  dark,
  timer,
}: {
  unreadCount: number;
  dark: boolean;
  timer: RunningTimer | null;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  // "Today" and the task pages have their own "New task" button in the page header.
  const ownButton = pathname === "/" || pathname.startsWith("/tasks");
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
      <div className="ml-auto flex min-w-0 items-center gap-2.5">
        {timer && <TimerPill timer={timer} className="max-w-xs" />}
        <ThemeButton dark={dark} />
        <BellLink unreadCount={unreadCount} />
        {!ownButton && (
          <Button
            asChild
            className="h-10 rounded-full px-5 shadow-[0_8px_18px_-8px_var(--primary)]"
          >
            <Link href="/tasks/new">
              <Plus />
              {t("tasks.newTask")}
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

// Phone-only top bar: app name, theme, settings and the notifications bell.
export function MobileHeader({
  unreadCount,
  dark,
  timer,
}: {
  unreadCount: number;
  dark: boolean;
  timer: RunningTimer | null;
}) {
  const t = useT();
  return (
    <header className="bg-card/95 sticky top-0 z-20 border-b backdrop-blur md:hidden">
      <div className="flex items-center justify-between px-4 py-2">
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
      </div>
      {timer && <TimerPill timer={timer} className="mx-3 mb-2" />}
    </header>
  );
}
