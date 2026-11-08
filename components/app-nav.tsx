"use client";

import {
  Bell,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  Menu,
  Plus,
  Settings,
  SlidersHorizontal,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { savePhoneBarAction } from "@/app/(app)/shell-actions";
import type { Role } from "@/lib/generated/prisma/enums";
import { useT } from "@/components/locale-provider";
import { SearchBar, SearchButton } from "@/components/search/global-search";
import { ThemeButton } from "@/components/theme-button";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { TimerPill } from "@/components/timer-pill";
import {
  IN_PHONE_HEADER,
  moduleForPath,
  modulesForRole,
  PHONE_BAR_SIZE,
  phoneBarItems,
} from "@/modules/core/registry";
import type { RunningTimer } from "@/modules/tasks/time";

// A year-long cookie the server reads on the next page load (the collapsed menu).
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

// «Ещё» groups its sections under the menu's headings; a heading over a single section is noise,
// so such a group joins its neighbour («Работа и торговый маркетинг»).
function sheetGroups(items: NavItem[]) {
  const groups = [...new Set(items.map((item) => item.group))].map((group) => ({
    keys: [group],
    items: items.filter((item) => item.group === group),
  }));
  const merged: typeof groups = [];
  for (const group of groups) {
    const last = merged.at(-1);
    if (last && last.items.length === 1) {
      last.keys.push(...group.keys);
      last.items.push(...group.items);
    } else merged.push(group);
  }
  const tail = merged.at(-1);
  if (merged.length > 1 && tail && tail.items.length === 1) {
    merged.pop();
    merged.at(-1)!.keys.push(...tail.keys);
    merged.at(-1)!.items.push(...tail.items);
  }
  return merged;
}

// «Выбрать разделы для нижней панели»: up to four sections, saved for this person.
function PhoneBarChooser({
  items,
  bar,
  onSaved,
  onCancel,
}: {
  items: NavItem[];
  bar: NavItem[];
  onSaved: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const candidates = items.filter((item) => !IN_PHONE_HEADER.includes(item.id));
  const [picked, setPicked] = useState(() => bar.map((item) => item.id));
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const save = (ids: string[]) =>
    startTransition(async () => {
      try {
        onSaved(await savePhoneBarAction(ids));
      } catch {
        setFailed(true);
      }
    });
  const toggle = (id: string) =>
    setPicked(picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {t("shell.phoneBar.hint", { max: PHONE_BAR_SIZE })}
      </p>
      <ul className="grid grid-cols-2 gap-1.5">
        {candidates.map((item) => {
          const checked = picked.includes(item.id);
          const Icon = item.icon;
          return (
            <li key={item.id}>
              <label
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm",
                  checked ? "border-primary bg-secondary" : "has-[:disabled]:opacity-50",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && picked.length >= PHONE_BAR_SIZE}
                  onChange={() => toggle(item.id)}
                />
                <Icon className="size-4 shrink-0" />
                {t(item.titleKey)}
              </label>
            </li>
          );
        })}
      </ul>
      {failed && (
        <p role="alert" className="text-destructive text-sm">
          {t("shell.phoneBar.error")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending || picked.length === 0}
          onClick={() =>
            save(candidates.filter((item) => picked.includes(item.id)).map((item) => item.id))
          }
        >
          {pending && <Loader2 className="animate-spin" />}
          {t("common.save")}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => save([])}>
          {t("shell.phoneBar.reset")}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

// Sidebar on desktop (grouped, can be collapsed to icons); on phones a bottom bar with four
// sections (the person's choice, or the default) and «Ещё» with the person and every other
// section. Items come from the module registry.
export function AppNav({
  role,
  unreadCount,
  enabled,
  user,
  collapsed: initiallyCollapsed = false,
  phoneBar = [],
}: {
  role: Role;
  unreadCount: number;
  enabled?: string[];
  user: ShellUser;
  collapsed?: boolean;
  phoneBar?: string[];
}) {
  const t = useT();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [moreOpen, setMoreOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState(phoneBar);
  const items = modulesForRole(role, undefined, enabled);
  const current = moduleForPath(pathname, items)?.href;
  const badgeOf = (item: NavItem) =>
    item.id === "notifications" && unreadCount > 0 ? unreadCount : null;
  const bar = phoneBarItems(items, chosen);
  // The bell and the gear sit in the phone's header: «Ещё» doesn't repeat them.
  const more = items.filter((item) => !bar.includes(item) && !IN_PHONE_HEADER.includes(item.id));
  const moreActive = more.some((item) => item.href === current);
  const groups = [...new Set(items.map((item) => item.group))];
  const toggle = () => {
    remember("nav", collapsed ? "open" : "collapsed");
    setCollapsed(!collapsed);
  };
  const closeMore = () => {
    setMoreOpen(false);
    setChoosing(false);
  };

  return (
    <>
      {/* Desktop sidebar */}
      <nav
        aria-label="Main"
        data-print="hide"
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

      {/* Phone bottom bar. The unread counter is on the header's bell only. */}
      <nav
        aria-label="Main mobile"
        data-print="hide"
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
                  onClick={closeMore}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1 px-1 pt-2 pb-1.5 text-center text-[11px] leading-tight",
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
                onClick={() => (moreOpen ? closeMore() : setMoreOpen(true))}
                aria-expanded={moreOpen}
                className={cn(
                  "flex w-full flex-col items-center gap-1 px-1 pt-2 pb-1.5 text-[11px]",
                  moreOpen || moreActive ? "text-primary font-semibold" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full",
                    (moreOpen || moreActive) && "bg-secondary",
                  )}
                >
                  <Menu className="size-5" strokeWidth={moreOpen ? 2.25 : 1.75} />
                </span>
                {t("shell.more")}
              </button>
            </li>
          )}
        </ul>
      </nav>

      {/* «Ещё»: the person (profile and settings), every other section, and the bar chooser. */}
      {moreOpen && (
        <div className="fixed inset-0 z-20 md:hidden" data-print="hide">
          <button
            type="button"
            aria-label={t("shell.close")}
            onClick={closeMore}
            className="absolute inset-0 bg-black/30"
          />
          <div className="bg-card absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold">
                {choosing ? t("shell.phoneBar.title") : t("shell.moreTitle")}
              </span>
              <button
                type="button"
                onClick={closeMore}
                aria-label={t("shell.close")}
                className="text-muted-foreground hover:bg-accent rounded-full p-1.5"
              >
                <X className="size-5" />
              </button>
            </div>
            {choosing ? (
              <PhoneBarChooser
                items={items}
                bar={bar}
                onSaved={(ids) => {
                  setChosen(ids);
                  setChoosing(false);
                }}
                onCancel={() => setChoosing(false)}
              />
            ) : (
              <div className="flex flex-col gap-3">
                <Link
                  href="/settings"
                  onClick={closeMore}
                  className="hover:bg-accent -mx-1 flex items-center gap-3 rounded-xl border-b p-2 pb-3"
                >
                  <Avatar user={user} className="size-11" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-semibold">{user.name}</span>
                    <span className="text-muted-foreground truncate text-sm">
                      {t("shell.profileRow", { role: t(`roles.${user.role}`) })}
                    </span>
                  </span>
                  <ChevronRight className="text-muted-foreground size-4" />
                </Link>
                {sheetGroups(more).map((group) => {
                  const [first, ...rest] = group.keys.map((key) => t(`shell.groups.${key}`));
                  const label = rest.length
                    ? t("shell.groupsJoined", {
                        first: [first, ...rest.slice(0, -1).map((l) => l.toLowerCase())].join(", "),
                        second: rest.at(-1)!.toLowerCase(),
                      })
                    : first;
                  return (
                    <div key={group.keys.join()} className="flex flex-col gap-1">
                      <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                        {label}
                      </span>
                      <ul className="grid grid-cols-2 gap-1.5">
                        {group.items.map((item) => (
                          <li key={item.id}>
                            <NavLink
                              item={item}
                              active={item.href === current}
                              badge={null}
                              collapsed={false}
                              onClick={closeMore}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setChoosing(true)}
                  className="text-primary flex items-center gap-2 self-start py-1 text-sm font-medium"
                >
                  <SlidersHorizontal className="size-4" />
                  {t("shell.phoneBar.choose")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
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

type BarProps = {
  unreadCount: number;
  theme: Theme;
  timer: RunningTimer | null;
  // Extra round icon buttons for the header, placed before the theme button (e.g. the AI help,
  // components/help/help-button.tsx). Size them like the others: size-10 on desktop, size-9 on
  // phones.
  extra?: ReactNode;
};

// Desktop top bar: the search, then the timer, extra buttons, theme, notifications and a small
// «+» for a new task.
export function TopBar({ unreadCount, theme, timer, extra }: BarProps) {
  const t = useT();
  const pathname = usePathname();
  // «Сегодня» and the task pages have their own «Новая задача» in the page header; elsewhere the
  // section's own main button stays the main one, so this is just a small round «+».
  const ownButton = pathname === "/" || pathname.startsWith("/tasks");
  return (
    <div data-print="hide" className="hidden items-center gap-3 md:flex">
      <SearchBar />
      <div className="ml-auto flex min-w-0 items-center gap-2.5">
        {timer && <TimerPill timer={timer} className="max-w-xs" />}
        {extra}
        <ThemeButton theme={theme} />
        <BellLink unreadCount={unreadCount} />
        {!ownButton && (
          <Link
            href="/tasks/new"
            aria-label={t("tasks.newTask")}
            title={t("tasks.newTask")}
            className="bg-card hover:bg-accent text-muted-foreground hover:text-foreground flex size-10 items-center justify-center rounded-full border"
          >
            <Plus className="size-[18px]" />
          </Link>
        )}
      </div>
    </div>
  );
}

// Phone-only top bar: app name, search, extra buttons, theme, settings and the notifications bell
// (the only place with the unread counter on phones).
export function MobileHeader({ unreadCount, theme, timer, extra }: BarProps) {
  const t = useT();
  return (
    <header
      data-print="hide"
      className="bg-card/95 sticky top-0 z-20 border-b backdrop-blur md:hidden"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <BrandMark className="size-8 rounded-lg text-sm" />
          <span className="truncate text-[15px] font-bold tracking-tight max-[380px]:hidden">
            {t("app.name")}
          </span>
        </span>
        <div className="flex items-center gap-1">
          <SearchButton />
          {extra}
          <ThemeButton theme={theme} className="size-9 border-transparent" />
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
