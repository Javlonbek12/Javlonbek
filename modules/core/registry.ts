import {
  Activity,
  BarChart3,
  Bell,
  CalendarClock,
  Factory,
  FolderKanban,
  House,
  LayoutGrid,
  Megaphone,
  PieChart,
  ListTodo,
  MapPinned,
  Network,
  Settings,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/lib/generated/prisma/client";
import type { TranslationKey } from "@/lib/i18n";

export type ModuleGroup = "work" | "trade" | "content" | "team" | "system";

export type ModuleEntry = {
  id: string;
  titleKey: TranslationKey;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  // The heading it sits under in the desktop menu and the phone's «Ещё».
  group: ModuleGroup;
  // The role-settings section(s) that switch it (default: its own id); with several, any of
  // them shows it.
  access?: string | string[];
  // Where all its pages live, when the link opens one of them (default: href).
  base?: string;
};

const ALL_ROLES: Role[] = ["OWNER", "MANAGER", "MEMBER", "LAWYER"];

// Every module registers itself here: name, icon, link, group and which roles see it. The order
// is the menu's order; the phone's bottom bar takes the first few of PHONE_BAR.
export const MODULES: ModuleEntry[] = [
  { id: "home", titleKey: "nav.home", href: "/", icon: House, roles: ALL_ROLES, group: "work" },
  {
    id: "tasks",
    titleKey: "nav.tasks",
    href: "/tasks",
    icon: ListTodo,
    roles: ALL_ROLES,
    group: "work",
  },
  {
    id: "meetings",
    titleKey: "nav.meetings",
    href: "/meetings",
    icon: CalendarClock,
    roles: ALL_ROLES,
    group: "work",
  },
  {
    id: "projects",
    titleKey: "nav.projects",
    href: "/projects",
    icon: FolderKanban,
    roles: ALL_ROLES,
    group: "work",
  },
  {
    id: "planograms",
    titleKey: "nav.planograms",
    href: "/planograms",
    icon: LayoutGrid,
    roles: ALL_ROLES,
    group: "trade",
  },
  // The equipment: a map of Uzbekistan, types, planogram models, sizes, quantities, uploads.
  // Shared by the planograms and the distribution: shown with either.
  {
    id: "equipment",
    titleKey: "nav.equipment",
    href: "/equipment",
    icon: MapPinned,
    roles: ALL_ROLES,
    group: "trade",
    access: ["distribution", "planograms"],
  },
  // POSM distribution by region and TSM, stock and shipments; the work starts from campaigns.
  {
    id: "distribution",
    titleKey: "nav.distribution",
    href: "/distribution/campaigns",
    icon: Truck,
    roles: ALL_ROLES,
    group: "trade",
    base: "/distribution",
  },
  // Content plan for the company's bots.
  {
    id: "content",
    titleKey: "nav.content",
    href: "/content",
    icon: Megaphone,
    roles: ALL_ROLES,
    group: "content",
  },
  {
    id: "contentAnalytics",
    titleKey: "nav.contentAnalytics",
    href: "/content-analytics",
    icon: PieChart,
    roles: ALL_ROLES,
    group: "content",
    access: "content",
  },
  // Connect bot analytics (imported exports).
  {
    id: "connect",
    titleKey: "nav.connect",
    href: "/connect",
    icon: Activity,
    roles: ALL_ROLES,
    group: "content",
  },
  // S&OP: the monthly workbook of production orders, shipments, sales and stocks. Off for every
  // role until the owner switches it on.
  {
    id: "sop",
    titleKey: "nav.sop",
    href: "/sop",
    icon: Factory,
    roles: ALL_ROLES,
    group: "content",
  },
  // Management report: owner and managers.
  {
    id: "reports",
    titleKey: "nav.reports",
    href: "/reports",
    icon: BarChart3,
    roles: ["OWNER", "MANAGER"],
    group: "content",
  },
  { id: "team", titleKey: "nav.team", href: "/team", icon: Users, roles: ALL_ROLES, group: "team" },
  {
    id: "structure",
    titleKey: "nav.structure",
    href: "/team/structure",
    icon: Network,
    roles: ALL_ROLES,
    group: "team",
  },
  // On phones the bell and the gear also sit in the header.
  {
    id: "notifications",
    titleKey: "nav.notifications",
    href: "/notifications",
    icon: Bell,
    roles: ALL_ROLES,
    group: "system",
  },
  {
    id: "settings",
    titleKey: "nav.settings",
    href: "/settings",
    icon: Settings,
    roles: ALL_ROLES,
    group: "system",
  },
];

// The phone's bottom bar by default: the first four of these the person has; everything else is
// in «Ещё». Each person can choose their own four (User.phoneBar).
export const PHONE_BAR = ["home", "tasks", "meetings", "planograms", "team"];
export const PHONE_BAR_SIZE = 4;
// On phones these sit in the header (the bell and the gear): «Ещё» and the bar leave them out.
export const IN_PHONE_HEADER = ["notifications", "settings"];

// The person's bottom bar: their own choice (in menu order) of the sections they have, else the
// default.
export function phoneBarItems(items: ModuleEntry[], chosen: string[] = []): ModuleEntry[] {
  const own = items.filter((item) => chosen.includes(item.id));
  if (own.length) return own.slice(0, PHONE_BAR_SIZE);
  return PHONE_BAR.map((id) => items.find((item) => item.id === id))
    .filter((item): item is ModuleEntry => Boolean(item))
    .slice(0, PHONE_BAR_SIZE);
}

// A choice to store: known sections that may sit in the bar, each once, at most four.
export function cleanPhoneBar(ids: string[]): string[] {
  const allowed = MODULES.filter((m) => !IN_PHONE_HEADER.includes(m.id)).map((m) => m.id);
  return [...new Set(ids)].filter((id) => allowed.includes(id)).slice(0, PHONE_BAR_SIZE);
}

const under = (pathname: string, path: string) =>
  path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);

// The section a page belongs to: the most specific one whose pages it is under
// (/team/structure → «Оргструктура», not «Команда»).
export function moduleForPath(
  pathname: string,
  modules: ModuleEntry[] = MODULES,
): ModuleEntry | undefined {
  const path = (module: ModuleEntry) => module.base ?? module.href;
  return modules
    .filter((module) => under(pathname, path(module)))
    .sort((a, b) => path(b).length - path(a).length)[0];
}

// Sections the owner can switch on/off per role (Settings → Roles); the rest are always shown.
const SWITCHABLE = new Set([
  "meetings",
  "team",
  "structure",
  "planograms",
  "projects",
  "content",
  "reports",
  "connect",
  "distribution",
  "sop",
]);

export function modulesForRole(
  role: Role,
  modules: ModuleEntry[] = MODULES,
  // Sections enabled for this person by the role settings; undefined = all.
  enabled?: string[],
): ModuleEntry[] {
  return modules.filter(
    (module) =>
      module.roles.includes(role) &&
      (role === "OWNER" ||
        !enabled ||
        [module.access ?? module.id].flat().some((m) => !SWITCHABLE.has(m) || enabled.includes(m))),
  );
}
