import { House } from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  cleanPhoneBar,
  moduleForPath,
  MODULES,
  modulesForRole,
  phoneBarItems,
  type ModuleEntry,
} from "./registry";

describe("modulesForRole", () => {
  it("shows the core modules to every role and reports to owners and managers only", () => {
    const core = MODULES.filter((m) => m.id !== "reports").map((m) => m.id);
    expect(modulesForRole("MEMBER").map((m) => m.id)).toEqual(core);
    for (const role of ["OWNER", "MANAGER"] as const) {
      expect(modulesForRole(role).map((m) => m.id)).toEqual(MODULES.map((m) => m.id));
    }
  });

  it("hides modules the role has no access to", () => {
    const modules: ModuleEntry[] = [
      { id: "a", titleKey: "nav.home", href: "/a", icon: House, roles: ["OWNER"], group: "work" },
      {
        id: "b",
        titleKey: "nav.home",
        href: "/b",
        icon: House,
        roles: ["OWNER", "MEMBER"],
        group: "work",
      },
    ];
    expect(modulesForRole("MEMBER", modules).map((m) => m.id)).toEqual(["b"]);
    expect(modulesForRole("MANAGER", modules)).toEqual([]);
  });
});

describe("phone bar", () => {
  const ids = (items: ModuleEntry[]) => items.map((m) => m.id);

  it("takes the default four, or the person's own choice in menu order", () => {
    const all = modulesForRole("OWNER");
    expect(ids(phoneBarItems(all))).toEqual(["home", "tasks", "meetings", "planograms"]);
    expect(ids(phoneBarItems(all, ["team", "content"]))).toEqual(["content", "team"]);
    // Sections the person no longer has fall out; with none left, the default is back.
    const member = modulesForRole("MEMBER", undefined, []);
    expect(ids(phoneBarItems(member, ["meetings"]))).toEqual(["home", "tasks"]);
  });

  it("stores known sections only, once each, at most four, never the header's bell or gear", () => {
    expect(
      cleanPhoneBar(["team", "team", "nope", "settings", "content", "tasks", "home", "connect"]),
    ).toEqual(["team", "content", "tasks", "home"]);
  });
});

describe("moduleForPath", () => {
  it("finds the most specific section of a page", () => {
    expect(moduleForPath("/")?.id).toBe("home");
    expect(moduleForPath("/tasks/board")?.id).toBe("tasks");
    expect(moduleForPath("/team/structure")?.id).toBe("structure");
    expect(moduleForPath("/team/abc")?.id).toBe("team");
    expect(moduleForPath("/content-analytics/overview")?.id).toBe("contentAnalytics");
    // Its menu link opens the campaigns, but every page under /distribution is the section.
    expect(moduleForPath("/distribution/stock")?.id).toBe("distribution");
    expect(moduleForPath("/invite/abc")).toBeUndefined();
  });
});
