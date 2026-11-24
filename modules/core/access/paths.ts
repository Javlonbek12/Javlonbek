import type { Role } from "@/lib/generated/prisma/enums";

import type { Access } from "./actor";
import type { ConfigurableModule } from "./config";

// Whether the person has a role-settings section. No database here: the help panel (a client
// component) checks links with it too.
export const canUseModule = (
  actor: {
    role: Role;
    access?: Pick<Access, "taskScope" | "teamIds" | "connectLead"> & {
      modules: readonly string[];
    };
  },
  module: ConfigurableModule,
) => actor.role === "OWNER" || (actor.access?.modules.includes(module) ?? true);

// Which role-settings sections a page belongs to (any of them opens it), by its path. Used to show
// a link only to someone who can open it, instead of a link that bounces back to «Сегодня».
// Projects are left out: a project lead opens their project without the section (see
// canOpenProjects).
const SECTIONS: [prefix: string, modules: ConfigurableModule[], exact?: boolean][] = [
  ["/team/structure", ["structure"]],
  ["/team", ["team"], true],
  ["/team", ["team", "structure"]],
  ["/meetings", ["meetings"]],
  ["/planograms", ["planograms"]],
  ["/content-analytics", ["content"]],
  ["/content", ["content"]],
  ["/reports", ["reports"]],
  ["/connect", ["connect"]],
  ["/distribution", ["distribution"]],
  ["/equipment", ["distribution", "planograms"]],
];

export function sectionOfPath(link: string): ConfigurableModule[] | null {
  const path = link.split(/[?#]/)[0]!;
  for (const [prefix, modules, exact] of SECTIONS) {
    if (exact ? path === prefix : path === prefix || path.startsWith(`${prefix}/`)) return modules;
  }
  return null;
}

export function canOpenPath(
  actor: Parameters<typeof canUseModule>[0] & { id?: string },
  link: string,
): boolean {
  // Everyone opens their own card, with or without «Команда».
  if (actor.id && link.split(/[?#]/)[0] === `/team/${actor.id}`) return true;
  const modules = sectionOfPath(link);
  return !modules || modules.some((m) => canUseModule(actor, m));
}
