import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import { DEFAULT_ROLE_CONFIG } from "@/modules/core/access/config";
import type { Actor } from "@/modules/core/permissions";
import { BOT_COMMANDS } from "@/modules/bot/commands";
import { MODULES } from "@/modules/core/registry";

import { buildHelpPrompt, HELP_SYSTEM, trimHistory } from "./help";
import { HELP_SUB_PAGES, helpPagesFor, helpSectionOf, HISTORY_TURNS } from "./help-shared";

const member: Actor = {
  id: "u1",
  role: "MEMBER",
  access: { taskScope: "own", teamIds: [], modules: DEFAULT_ROLE_CONFIG.MEMBER.modules },
};
const manager: Actor = {
  id: "u2",
  role: "MANAGER",
  access: { taskScope: "team", teamIds: [], modules: DEFAULT_ROLE_CONFIG.MANAGER.modules },
};
const owner: Actor = { id: "u3", role: "OWNER" };

const input = { question: "Как здесь поставить задачу?", history: [], path: "/tasks/board" };

describe("buildHelpPrompt", () => {
  it("tells the model the person's role, sections and the ones they don't have", () => {
    const prompt = buildHelpPrompt(member, input, "ru");
    expect(prompt).toContain("Role: Сотрудник (MEMBER)");
    expect(prompt).toMatch(/Menu sections they have: .*«Задачи».*«Встречи»/);
    expect(prompt).toMatch(/Menu sections they do NOT have: .*«Отчёты».*«Команда»/);
    expect(prompt).toContain("Team tasks they see and decide on: only their own tasks");
    expect(prompt).toContain("They can invite: nobody");
  });

  it("names the page the person is on and its menu section", () => {
    const prompt = buildHelpPrompt(member, input, "ru");
    expect(prompt).toContain("Path: /tasks/board");
    expect(prompt).toContain("Menu section: «Задачи»");
    expect(prompt).toContain("<question>\nКак здесь поставить задачу?\n</question>");
  });

  it("hides ids in the path and notes an open task panel", () => {
    const prompt = buildHelpPrompt(
      member,
      { ...input, path: "/planograms/cmh1x2y3z4a5b6c7d8e9/edit?tab=rules" },
      "ru",
    );
    expect(prompt).toContain("Path: /planograms/[id]/edit");
    expect(prompt).not.toContain("cmh1x2y3z4a5b6c7d8e9");
    expect(prompt).not.toContain("A task card is open");
    expect(buildHelpPrompt(member, { ...input, path: "/tasks?task=abc" }, "ru")).toContain(
      "A task card is open in the side panel.",
    );
  });

  it("lists only pages the person can open for links", () => {
    const memberPrompt = buildHelpPrompt(member, input, "ru");
    expect(memberPrompt).toContain("- /tasks/new — Новая задача");
    expect(memberPrompt).not.toContain("/settings/roles");
    expect(memberPrompt).not.toContain("/reports");
    expect(buildHelpPrompt(owner, input, "ru")).toContain("- /settings/roles — Роли и доступ");
  });

  it("gives English screen names and asks for English to an English interface", () => {
    const prompt = buildHelpPrompt(manager, input, "en");
    expect(prompt).toContain("«Задачи» (on screen: «Tasks»)");
    expect(prompt).toContain("Reply in English");
    expect(prompt).toContain("They can invite: Сотрудник");
    expect(prompt).toContain("- /tasks/new — New task");
  });

  it("sends only the last turns of the conversation", () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `реплика ${i}`,
    }));
    const prompt = buildHelpPrompt(member, { ...input, history }, "ru");
    expect(prompt).not.toContain("реплика 3");
    expect(prompt).toContain("Employee: реплика 4");
    expect(prompt).toContain("Assistant: реплика 9");
  });

  it("keeps the rules and the guide out of the per-question prompt (they are cached)", () => {
    const prompt = buildHelpPrompt(member, input, "ru");
    expect(prompt).not.toContain("<user_guide>");
    expect(HELP_SYSTEM).toContain("never say or imply that you created");
    expect(HELP_SYSTEM).toContain("suggest asking the owner");
  });
});

describe("trimHistory", () => {
  it("drops empty turns, cuts long ones and keeps the last few", () => {
    const turns = [
      { role: "user" as const, text: "   " },
      ...Array.from({ length: 8 }, () => ({ role: "user" as const, text: "x".repeat(3000) })),
    ];
    const trimmed = trimHistory(turns);
    expect(trimmed).toHaveLength(HISTORY_TURNS);
    expect(trimmed.every((turn) => turn.text.length === 1500)).toBe(true);
  });
});

describe("help pages", () => {
  it("finds the menu section of nested pages", () => {
    expect(helpSectionOf("/")?.id).toBe("home");
    expect(helpSectionOf("/tasks/board")?.id).toBe("tasks");
    expect(helpSectionOf("/team/structure")?.id).toBe("structure");
    expect(helpSectionOf("/team/abc")?.id).toBe("team");
    expect(helpSectionOf("/distribution/plan")?.id).toBe("distribution");
    expect(helpSectionOf("/content-analytics/overview")?.id).toBe("contentAnalytics");
    expect(helpSectionOf("/content/new?x=1")?.id).toBe("content");
    expect(helpSectionOf("/login")).toBeUndefined();
  });

  it("offers pages by role and section", () => {
    const hrefs = (actor: Actor) => helpPagesFor(actor).map((page) => page.href);
    expect(hrefs(member)).toContain("/meetings/new");
    expect(hrefs(member)).not.toContain("/distribution/help");
    expect(hrefs(member)).not.toContain("/settings/invites");
    expect(hrefs(manager)).toEqual(
      expect.arrayContaining(["/distribution/help", "/connect/import", "/settings/invites"]),
    );
    expect(hrefs(manager)).not.toContain("/tasks/trash");
    expect(hrefs(owner)).toEqual(expect.arrayContaining(["/tasks/trash", "/settings/roles"]));
  });

  it("links only to pages that exist", () => {
    for (const page of HELP_SUB_PAGES) {
      expect(existsSync(path.join("app", "(app)", page.href, "page.tsx")), page.href).toBe(true);
    }
  });
});

// The help button answers from docs/USER-GUIDE.md: a menu section or bot command missing there
// means the AI can't explain it.
describe("the user guide keeps up with the app", () => {
  const guide = readFileSync(path.join("docs", "USER-GUIDE.md"), "utf8");
  const headings = guide.split("\n").filter((line) => line.startsWith("## "));

  it.each(MODULES.map((m) => [t(m.titleKey, undefined, "ru"), m.href]))(
    "has a section for «%s» and its address",
    (title, href) => {
      expect(headings).toContain(`## ${title}`);
      expect(guide).toContain(`| \`${href}\` |`);
    },
  );

  it.each(BOT_COMMANDS.ru.map((c) => c.command))("explains the bot command /%s", (command) => {
    expect(guide).toContain(`\`/${command}\``);
  });

  it("explains the roles and the timer", () => {
    expect(headings).toContain("## Роли и права");
    expect(guide).toContain("### Таймер и учёт времени");
    for (const role of ["OWNER", "MANAGER", "MEMBER", "LAWYER"] as const) {
      expect(guide).toContain(`**${t(`roles.${role}`, undefined, "ru")}**`);
    }
  });
});
