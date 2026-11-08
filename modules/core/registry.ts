import {
  Activity,
  BarChart3,
  Bell,
  CalendarClock,
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

// The phone's bottom bar: the first four of these the person has; everything else is in «Ещё».
export const PHONE_BAR = ["home", "tasks", "meetings", "planograms", "team"];

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
