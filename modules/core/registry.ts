import { Bell, House, Settings, Users, type LucideIcon } from "lucide-react";

import type { Role } from "@/lib/generated/prisma/client";
import type { TranslationKey } from "@/lib/i18n";

export type ModuleEntry = {
  id: string;
  titleKey: TranslationKey;
  href: string;
  icon: LucideIcon;
  roles: Role[];
};

const ALL_ROLES: Role[] = ["OWNER", "MANAGER", "MEMBER"];

// Every module registers itself here: name, icon, link and which roles see it.
export const MODULES: ModuleEntry[] = [
  { id: "home", titleKey: "nav.home", href: "/", icon: House, roles: ALL_ROLES },
  { id: "team", titleKey: "nav.team", href: "/team", icon: Users, roles: ALL_ROLES },
  {
    id: "notifications",
    titleKey: "nav.notifications",
    href: "/notifications",
    icon: Bell,
    roles: ALL_ROLES,
  },
  { id: "settings", titleKey: "nav.settings", href: "/settings", icon: Settings, roles: ALL_ROLES },
];

export function modulesForRole(role: Role, modules: ModuleEntry[] = MODULES): ModuleEntry[] {
  return modules.filter((module) => module.roles.includes(role));
}
