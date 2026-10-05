import {
  BarChart3,
  Bell,
  CalendarClock,
  FolderKanban,
  House,
  LayoutGrid,
  ListTodo,
  Network,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/lib/generated/prisma/client";
import type { TranslationKey } from "@/lib/i18n";

export type ModuleEntry = {
  id: string;
  titleKey: TranslationKey;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  // false = not in the phone's bottom bar (shown elsewhere, e.g. the bell in the header).
  mobile?: boolean;
};

const ALL_ROLES: Role[] = ["OWNER", "MANAGER", "MEMBER"];

// Every module registers itself here: name, icon, link and which roles see it.
export const MODULES: ModuleEntry[] = [
  { id: "home", titleKey: "nav.home", href: "/", icon: House, roles: ALL_ROLES },
  { id: "tasks", titleKey: "nav.tasks", href: "/tasks", icon: ListTodo, roles: ALL_ROLES },
  {
    id: "meetings",
    titleKey: "nav.meetings",
    href: "/meetings",
    icon: CalendarClock,
    roles: ALL_ROLES,
  },
  { id: "team", titleKey: "nav.team", href: "/team", icon: Users, roles: ALL_ROLES },
  // On phones the structure opens from the "Команда" screen.
  {
    id: "structure",
    titleKey: "nav.structure",
    href: "/team/structure",
    icon: Network,
    roles: ALL_ROLES,
    mobile: false,
  },
  {
    id: "planograms",
    titleKey: "nav.planograms",
    href: "/planograms",
    icon: LayoutGrid,
    roles: ALL_ROLES,
  },
  // Projects: on phones they open from the "Tasks" screen.
  {
    id: "projects",
    titleKey: "nav.projects",
    href: "/projects",
    icon: FolderKanban,
    roles: ALL_ROLES,
    mobile: false,
  },
  // Management report: owner and managers; on phones it opens from the "Today" screen.
  {
    id: "reports",
    titleKey: "nav.reports",
    href: "/reports",
    icon: BarChart3,
    roles: ["OWNER", "MANAGER"],
    mobile: false,
  },
  {
    id: "notifications",
    titleKey: "nav.notifications",
    href: "/notifications",
    icon: Bell,
    roles: ALL_ROLES,
    mobile: false,
  },
  // On phones settings sit behind the gear in the header, so the bottom bar keeps 5 items.
  {
    id: "settings",
    titleKey: "nav.settings",
    href: "/settings",
    icon: Settings,
    roles: ALL_ROLES,
    mobile: false,
  },
];

// Sections the owner can switch on/off per role (Settings → Roles); the rest are always shown.
const SWITCHABLE = new Set(["meetings", "team", "structure", "planograms", "projects", "reports"]);

export function modulesForRole(
  role: Role,
  modules: ModuleEntry[] = MODULES,
  // Sections enabled for this person by the role settings; undefined = all.
  enabled?: string[],
): ModuleEntry[] {
  return modules.filter(
    (module) =>
      module.roles.includes(role) &&
      (role === "OWNER" || !enabled || !SWITCHABLE.has(module.id) || enabled.includes(module.id)),
  );
}
