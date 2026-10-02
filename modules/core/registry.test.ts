import { House } from "lucide-react";
import { describe, expect, it } from "vitest";

import { MODULES, modulesForRole, type ModuleEntry } from "./registry";

describe("modulesForRole", () => {
  it("shows the core modules to every role", () => {
    for (const role of ["OWNER", "MANAGER", "MEMBER"] as const) {
      expect(modulesForRole(role).map((m) => m.id)).toEqual(MODULES.map((m) => m.id));
    }
  });

  it("hides modules the role has no access to", () => {
    const modules: ModuleEntry[] = [
      { id: "a", titleKey: "nav.home", href: "/a", icon: House, roles: ["OWNER"] },
      { id: "b", titleKey: "nav.home", href: "/b", icon: House, roles: ["OWNER", "MEMBER"] },
    ];
    expect(modulesForRole("MEMBER", modules).map((m) => m.id)).toEqual(["b"]);
    expect(modulesForRole("MANAGER", modules)).toEqual([]);
  });
});
