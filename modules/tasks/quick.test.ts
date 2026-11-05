import { describe, expect, it } from "vitest";

import { quickTarget } from "./quick";

const person = (id: string, role: "OWNER" | "MANAGER" | "MEMBER" = "MEMBER") => ({
  id,
  role,
  access: { taskScope: "team" as const, teamIds: [], modules: [] },
});
const task = (status: string, extra = {}) => ({
  isPersonal: false,
  creatorId: "author",
  assigneeId: "worker",
  status: status as never,
  approvedAt: new Date(),
  deciderIds: [],
  reviewerId: "author",
  ...extra,
});

describe("the round button in a task row", () => {
  it("personal: straight to done", () => {
    const own = { ...task("DRAFT"), isPersonal: true, creatorId: "me", assigneeId: "me" };
    expect(quickTarget(person("me"), own)).toBe("DONE");
  });

  it("the assignee hands in (taking it on first); whoever accepts accepts", () => {
    expect(quickTarget(person("worker"), task("APPROVED"))).toBe("IN_REVIEW");
    expect(quickTarget(person("worker"), task("IN_PROGRESS"))).toBe("IN_REVIEW");
    expect(quickTarget(person("worker"), task("IN_REVIEW"))).toBeNull();
    expect(quickTarget(person("author"), task("IN_REVIEW"))).toBe("DONE");
  });

  it("the owner's own task closes; deciding is never a quick step", () => {
    const owners = task("APPROVED", { creatorId: "boss", assigneeId: "boss", reviewerId: null });
    expect(quickTarget(person("boss", "OWNER"), owners)).toBe("DONE");
    const waiting = task("PENDING_APPROVAL", { approvedAt: null, deciderIds: ["boss"] });
    expect(quickTarget(person("boss", "MANAGER"), waiting)).toBeNull();
    expect(quickTarget(person("author"), task("APPROVED"))).toBeNull();
  });
});
