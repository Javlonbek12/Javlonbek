import { describe, expect, it } from "vitest";

import {
  canEditDutiesOf,
  dutiesTeam,
  subjectOfPlace,
  type ChartPlace,
} from "./responsibility-access";

const owner = { id: "owner", role: "OWNER" as const };
const boss = { id: "boss", role: "MANAGER" as const };
const member = { id: "emp", role: "MEMBER" as const };
const links = [
  { id: "owner", managerId: null },
  { id: "boss", managerId: "owner" },
  { id: "emp", managerId: "boss" },
  { id: "deep", managerId: "emp" },
  { id: "other", managerId: "owner" },
];

describe("who changes responsibilities", () => {
  it("the owner changes everyone's, even an item with nobody", () => {
    expect(canEditDutiesOf(owner, "other", [])).toBe(true);
    expect(canEditDutiesOf(owner, null, [])).toBe(true);
  });

  it("a manager: their own and their team's (any depth), not another team's", () => {
    const team = dutiesTeam(boss, links);
    expect(team.sort()).toEqual(["deep", "emp"]);
    expect(canEditDutiesOf(boss, "boss", team)).toBe(true);
    expect(canEditDutiesOf(boss, "deep", team)).toBe(true);
    expect(canEditDutiesOf(boss, "other", team)).toBe(false);
    expect(canEditDutiesOf(boss, null, team)).toBe(false);
  });

  it("uses the access team when the role sees the team's tasks", () => {
    const actor = { ...boss, access: { taskScope: "team" as const, teamIds: ["x"], modules: [] } };
    expect(dutiesTeam(actor, links)).toEqual(["x"]);
    // «All tasks» doesn't widen it: still the people below.
    const all = { ...boss, access: { taskScope: "all" as const, teamIds: [], modules: [] } };
    expect(dutiesTeam(all, links).sort()).toEqual(["deep", "emp"]);
  });

  it("an employee changes nobody's, not even their own", () => {
    expect(canEditDutiesOf(member, "emp", [])).toBe(false);
  });
});

describe("a place nobody in the app holds", () => {
  const place = (
    id: string,
    parentId: string | null,
    user: ChartPlace["user"] = null,
  ): [string, ChartPlace] => [id, { id, parentId, user }];
  const chart = new Map([
    place("top", null, { id: "owner", role: "OWNER", deactivatedAt: null }),
    place("unit", "top"),
    place("lead", "unit", { id: "boss", role: "MANAGER", deactivatedAt: new Date() }),
    place("vacancy", "lead"),
    place("seat", "unit", { id: "emp", role: "MEMBER", deactivatedAt: null }),
    place("under", "seat"),
  ]);

  it("belongs to the nearest active manager above it", () => {
    // The manager right above is switched off: the owner above them.
    expect(subjectOfPlace("vacancy", chart)).toBe("owner");
    // An employee above is no manager.
    expect(subjectOfPlace("under", chart)).toBe("owner");
    expect(subjectOfPlace("top", chart)).toBeNull();
  });
});
