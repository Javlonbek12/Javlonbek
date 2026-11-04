import { describe, expect, it } from "vitest";

import {
  isSubordinate,
  nearestManager,
  resolveRoute,
  sameTeam,
  type Person,
  type RouteSettings,
} from "./routing";

// The example team of the «Маршрут задачи» page.
const people: Person[] = [
  { id: "owner", role: "OWNER", managerId: null },
  { id: "mA", role: "MANAGER", managerId: "owner" },
  { id: "a1", role: "MEMBER", managerId: "mA" },
  { id: "a2", role: "MEMBER", managerId: "mA" },
  { id: "mB", role: "MANAGER", managerId: "owner" },
  { id: "b1", role: "MEMBER", managerId: "mB" },
  { id: "law", role: "LAWYER", managerId: "owner" },
  { id: "loose", role: "MEMBER", managerId: null },
];
const team: RouteSettings = { managerScope: "team", teamApproval: [] };
const route = (from: string, to: string, settings = team, flag = false) =>
  resolveRoute(people, settings, from, to, flag);

describe("reporting lines", () => {
  it("nearest manager, subordinates, one team", () => {
    expect(nearestManager(people, "a1")).toBe("mA");
    expect(nearestManager(people, "mA")).toBe("owner");
    expect(nearestManager(people, "loose")).toBe("owner");
    expect(nearestManager(people, "owner")).toBeNull();
    expect(isSubordinate(people, "mA", "a1")).toBe(true);
    expect(isSubordinate(people, "mA", "b1")).toBe(false);
    expect(isSubordinate(people, "owner", "loose")).toBe(true);
    expect(sameTeam(people, "a1", "a2")).toBe(true);
    expect(sameTeam(people, "a1", "mA")).toBe(true);
    expect(sameTeam(people, "a1", "b1")).toBe(false);
  });
});

describe("routing v2: the table «Когда нужно утверждение»", () => {
  it("the owner's tasks start right away; the assignee's manager hears about it", () => {
    expect(route("owner", "b1")).toMatchObject({
      status: "APPROVED",
      teamNoticeId: "mB",
      reviewerId: "owner",
    });
    expect(route("owner", "owner")).toMatchObject({
      status: "APPROVED",
      reviewerId: null,
      teamNoticeId: null,
    });
  });

  it("a manager to own people and to self: right away", () => {
    expect(route("mA", "a1")).toMatchObject({
      kind: "down",
      status: "APPROVED",
      teamNoticeId: null,
    });
    expect(route("mA", "mA")).toMatchObject({
      kind: "self",
      status: "APPROVED",
      teamNoticeId: "owner",
      reviewerId: "owner",
    });
  });

  it("an employee to self or a colleague: right away, the manager follows", () => {
    expect(route("a1", "a1")).toMatchObject({
      status: "APPROVED",
      teamNoticeId: "mA",
      reviewerId: "mA",
    });
    expect(route("a1", "a2")).toMatchObject({
      kind: "team",
      status: "APPROVED",
      teamNoticeId: "mA",
      reviewerId: "a1",
    });
  });

  it("up or sideways to a manager: they decide themselves", () => {
    expect(route("a1", "mA")).toMatchObject({
      kind: "up",
      status: "PENDING_APPROVAL",
      deciderIds: ["mA"],
      reviewerId: "a1",
    });
    expect(route("mA", "mB")).toMatchObject({ kind: "up", deciderIds: ["mB"] });
    expect(route("a1", "owner")).toMatchObject({ kind: "up", deciderIds: ["owner"] });
    expect(route("mA", "owner")).toMatchObject({ kind: "up", deciderIds: ["owner"] });
  });

  it("to another team: its manager decides (the owner, if managers see only their own)", () => {
    expect(route("a1", "b1")).toMatchObject({
      kind: "foreign",
      status: "PENDING_APPROVAL",
      deciderIds: ["mB"],
    });
    expect(route("mA", "b1")).toMatchObject({ kind: "foreign", deciderIds: ["mB"] });
    expect(route("law", "a1")).toMatchObject({ kind: "foreign", deciderIds: ["mA"] });
    expect(route("a1", "b1", { managerScope: "own", teamApproval: [] })).toMatchObject({
      deciderIds: ["owner"],
    });
    // With «Все» a manager still decides only for their own people.
    expect(route("a1", "b1", { managerScope: "all", teamApproval: [] }).deciderIds).toEqual(["mB"]);
  });

  it("«Требует утверждения» and teams that approve inside: the author's manager decides", () => {
    expect(route("a1", "a2", team, true)).toMatchObject({
      kind: "flag",
      status: "PENDING_APPROVAL",
      deciderIds: ["mA"],
    });
    expect(route("mA", "a1", team, true)).toMatchObject({ kind: "flag", deciderIds: ["owner"] });
    expect(route("owner", "a1", team, true).status).toBe("APPROVED");
    const gated: RouteSettings = { managerScope: "team", teamApproval: ["mA"] };
    expect(route("a1", "a2", gated)).toMatchObject({
      status: "PENDING_APPROVAL",
      deciderIds: ["mA"],
    });
    expect(route("a1", "a1", gated)).toMatchObject({
      status: "PENDING_APPROVAL",
      deciderIds: ["mA"],
    });
    // Down the lines is never gated.
    expect(route("mA", "a1", gated).status).toBe("APPROVED");
  });

  it("nobody reviews their own work; the nearest manager does", () => {
    expect(route("a1", "a1").reviewerId).toBe("mA");
    expect(route("mB", "mB").reviewerId).toBe("owner");
  });
});
