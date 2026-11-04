import { describe, expect, it } from "vitest";

import { modulesForRole } from "@/modules/core/registry";
import { canViewTask, oversees, visibleTasksWhere } from "@/modules/tasks/access";
import { availableTransitions } from "@/modules/tasks/status";

import { canUseModule, subordinatesOf } from "./actor";

const task = (creatorId: string, assigneeId: string) => ({
  isPersonal: false,
  creatorId,
  assigneeId,
  status: "PENDING_APPROVAL" as const,
  approvedAt: null,
});
const manager = (taskScope: "all" | "team" | "own", teamIds: string[] = []) => ({
  id: "boss",
  role: "MANAGER" as const,
  access: { taskScope, teamIds, modules: [] },
});

describe("role access", () => {
  it("finds everyone below a person in the reporting lines", () => {
    const links = [
      { id: "boss", managerId: "owner" },
      { id: "a", managerId: "boss" },
      { id: "b", managerId: "a" },
      { id: "c", managerId: "owner" },
    ];
    expect(subordinatesOf("boss", links).sort()).toEqual(["a", "b"]);
    expect(subordinatesOf("b", links)).toEqual([]);
  });

  it("limits a manager to all / own people / own tasks", () => {
    const theirs = task("a", "b");
    const foreign = task("x", "y");
    expect(oversees(manager("all"), foreign)).toBe(true);
    expect(oversees(manager("team", ["a", "b"]), theirs)).toBe(true);
    expect(oversees(manager("team", ["a", "b"]), foreign)).toBe(false);
    expect(canViewTask(manager("team", ["a"]), foreign)).toBe(false);
    expect(canViewTask(manager("own"), theirs)).toBe(false);
    // Routing v2: the zone gives control (cancel), deciding follows the route (deciderIds).
    expect(availableTransitions(manager("team", ["a", "b"]), theirs)).toEqual(["CANCELLED"]);
    expect(
      availableTransitions(manager("team", ["a", "b"]), { ...theirs, deciderIds: ["boss"] }),
    ).toContain("APPROVED");
    expect(
      availableTransitions(manager("team", ["a", "b"]), { ...foreign, creatorId: "boss" }),
    ).not.toContain("APPROVED");
    expect(JSON.stringify(visibleTasksWhere(manager("team", ["a"])))).toContain('"in":["a"]');
    // Without loaded settings (e.g. internal calls) the role's full rights apply.
    expect(oversees({ id: "boss", role: "MANAGER" }, foreign)).toBe(true);
  });

  it("shows only enabled sections in the menu; the owner sees everything", () => {
    const ids = (role: "OWNER" | "MANAGER" | "MEMBER", enabled?: string[]) =>
      modulesForRole(role, undefined, enabled).map((m) => m.id);
    expect(ids("MEMBER", ["meetings"])).toEqual([
      "home",
      "tasks",
      "meetings",
      "notifications",
      "settings",
    ]);
    expect(ids("MANAGER", ["meetings", "reports"])).toContain("reports");
    expect(ids("OWNER", [])).toContain("planograms");
    expect(
      canUseModule(
        { role: "MEMBER", access: { modules: ["meetings"], taskScope: "own", teamIds: [] } },
        "planograms",
      ),
    ).toBe(false);
    expect(
      canUseModule(
        { role: "OWNER", access: { modules: [], taskScope: "all", teamIds: [] } },
        "planograms",
      ),
    ).toBe(true);
  });
});
