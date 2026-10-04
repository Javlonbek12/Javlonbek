import { describe, expect, it } from "vitest";

import { canSeePrivateNotes, canSeeStats, editableProfileFields, isValidManager } from "./access";

const owner = { id: "owner", role: "OWNER" as const };
const boss = { id: "boss", role: "MANAGER" as const };
const otherBoss = { id: "other", role: "MANAGER" as const };
const employee = { id: "emp", managerId: "boss" };
const asActor = { id: "emp", role: "MEMBER" as const };
const colleague = { id: "col", role: "MEMBER" as const };

describe("private notes", () => {
  it("OWNER and the direct manager see them", () => {
    expect(canSeePrivateNotes(owner, employee)).toBe(true);
    expect(canSeePrivateNotes(boss, employee)).toBe(true);
  });

  it("the employee, colleagues and other managers do not", () => {
    expect(canSeePrivateNotes(asActor, employee)).toBe(false);
    expect(canSeePrivateNotes(colleague, employee)).toBe(false);
    expect(canSeePrivateNotes(otherBoss, employee)).toBe(false);
  });
});

describe("stats and profile", () => {
  it("stats: self, OWNER, managers — not colleagues", () => {
    expect(canSeeStats(asActor, employee)).toBe(true);
    expect(canSeeStats(otherBoss, employee)).toBe(true);
    expect(canSeeStats(colleague, employee)).toBe(false);
  });

  it("profile fields by role", () => {
    expect(editableProfileFields(owner, employee)).toContain("managerId");
    expect(editableProfileFields(boss, employee)).toEqual(["position", "responsibility"]);
    expect(editableProfileFields(asActor, employee)).toEqual(["phone", "email"]);
    expect(editableProfileFields(colleague, employee)).toEqual([]);
  });
});

describe("isValidManager", () => {
  const managerOf = new Map<string, string | null>([
    ["boss", "owner"],
    ["emp", "boss"],
    ["owner", null],
  ]);

  it("accepts a manager above the employee", () => {
    expect(isValidManager("emp", { id: "boss", role: "MANAGER" }, managerOf)).toBe(true);
  });

  it("rejects self, members and loops", () => {
    expect(isValidManager("emp", { id: "emp", role: "MANAGER" }, managerOf)).toBe(false);
    expect(isValidManager("emp", { id: "col", role: "MEMBER" }, managerOf)).toBe(false);
    // boss's manager can't become boss's report
    expect(isValidManager("boss", { id: "emp", role: "MANAGER" }, managerOf)).toBe(false);
  });
});
