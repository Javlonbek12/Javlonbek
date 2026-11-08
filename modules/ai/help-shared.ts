import type { Role } from "@/lib/generated/prisma/enums";
import type { TranslationKey } from "@/lib/i18n";
import { canOpenPath } from "@/modules/core/access/paths";
import type { Actor } from "@/modules/core/permissions";
import { MODULES, modulesForRole } from "@/modules/core/registry";

// What the help assistant (help.ts) and its panel share. Client-safe: no database, no files.

export const MAX_QUESTION = 1000;
// The conversation sent with a question: the last few turns.
export const HISTORY_TURNS = 6;

export type HelpTurn = { role: "user" | "assistant"; text: string };

// The pages the assistant may link to: every menu section of the registry, plus a few fixed
// pages inside them that answers often point at.

type SubPage = { href: string; titleKey: TranslationKey; roles?: Role[] };

const MANAGERS: Role[] = ["OWNER", "MANAGER"];

export const HELP_SUB_PAGES: SubPage[] = [
  { href: "/tasks/new", titleKey: "help.pages.tasksNew" },
  { href: "/tasks/decide", titleKey: "help.pages.tasksDecide" },
  { href: "/tasks/board", titleKey: "help.pages.tasksBoard" },
  { href: "/tasks/calendar", titleKey: "help.pages.tasksCalendar" },
  { href: "/tasks/timeline", titleKey: "help.pages.tasksTimeline" },
  { href: "/tasks/plans", titleKey: "help.pages.tasksPlans" },
  { href: "/tasks/time", titleKey: "help.pages.tasksTime" },
  { href: "/tasks/trash", titleKey: "help.pages.tasksTrash", roles: ["OWNER"] },
  { href: "/meetings/new", titleKey: "help.pages.meetingsNew" },
  { href: "/planograms/new", titleKey: "help.pages.planogramsNew" },
  { href: "/planograms/skus", titleKey: "help.pages.planogramsSkus" },
  { href: "/planograms/prices", titleKey: "help.pages.planogramsPrices" },
  { href: "/planograms/mass", titleKey: "help.pages.planogramsMass" },
  { href: "/equipment/models", titleKey: "help.pages.equipmentModels" },
  { href: "/distribution/help", titleKey: "help.pages.distributionHelp" },
  { href: "/content/new", titleKey: "help.pages.contentNew" },
  { href: "/connect/import", titleKey: "help.pages.connectImport", roles: MANAGERS },
  { href: "/settings/invites", titleKey: "help.pages.settingsInvites", roles: MANAGERS },
  { href: "/settings/roles", titleKey: "help.pages.settingsRoles", roles: ["OWNER"] },
];

export type HelpPage = { href: string; titleKey: TranslationKey };

type Module = (typeof MODULES)[number];

// The part of the site a section covers: its link, or the link's first folder when the link
// points inside it (POSM distribution opens /distribution/campaigns but owns all /distribution).
function areaOf(module: Module): string {
  const first = `/${module.href.split("/")[1]}`;
  return MODULES.some((m) => m !== module && m.href === first) ? module.href : first;
}

const covers = (area: string, path: string) =>
  area === "/" ? path === "/" : path === area || path.startsWith(`${area}/`);

// Every page this person can open: their menu sections, then the fixed pages inside them.
export function helpPagesFor(actor: Actor): HelpPage[] {
  const sections = modulesForRole(actor.role, MODULES, actor.access?.modules);
  return [
    ...sections.map((m) => ({ href: m.href, titleKey: m.titleKey })),
    ...HELP_SUB_PAGES.filter(
      (page) =>
        (!page.roles || page.roles.includes(actor.role)) &&
        sections.some((m) => covers(areaOf(m), page.href)) &&
        canOpenPath(actor, page.href),
    ),
  ];
}

// The menu section a page belongs to: the most specific one that covers it.
export function helpSectionOf(path: string): Module | undefined {
  const clean = path.split(/[?#]/)[0] || "/";
  return MODULES.filter((m) => covers(areaOf(m), clean)).sort(
    (a, b) => areaOf(b).length - areaOf(a).length,
  )[0];
}
