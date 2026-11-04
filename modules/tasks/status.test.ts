import { describe, expect, it } from "vitest";

import type { TaskStatus } from "@/lib/generated/prisma/client";

import type { TaskAccessInfo } from "./access";
import { availableTransitions, checkTransition, needsReason } from "./status";

const owner = { id: "owner", role: "OWNER" as const };
// Manager of «member» (role settings: own team).
const manager = {
  id: "manager",
  role: "MANAGER" as const,
  access: { modules: [], taskScope: "team" as const, teamIds: ["member", "other"] },
};
const member = { id: "member", role: "MEMBER" as const };
const other = { id: "other", role: "MEMBER" as const };

function team(
  status: TaskStatus,
  creatorId = "owner",
  assigneeId = "member",
  extra: Partial<TaskAccessInfo> = {},
): TaskAccessInfo {
  return { isPersonal: false, creatorId, assigneeId, status, approvedAt: null, ...extra };
}

function personal(status: TaskStatus, authorId = "member"): TaskAccessInfo {
  return { isPersonal: true, creatorId: authorId, assigneeId: authorId, status, approvedAt: null };
}

describe("team task transitions (routing v2)", () => {
  it("the author sends a draft (the route picks the status) or cancels it", () => {
    expect(availableTransitions(member, team("DRAFT", "member", "other"))).toEqual([
      "PENDING_APPROVAL",
      "CANCELLED",
    ]);
    expect(availableTransitions(other, team("DRAFT", "member", "other"))).toEqual([]);
  });

  it("only those the route named (and the owner) decide; the author may take it back", () => {
    const pending = team("PENDING_APPROVAL", "member", "other", { deciderIds: ["manager"] });
    expect(availableTransitions(manager, pending)).toEqual(["APPROVED", "DRAFT", "CANCELLED"]);
    expect(availableTransitions(owner, pending)).toContain("APPROVED");
    expect(availableTransitions(member, pending)).toEqual(["DRAFT", "CANCELLED"]);
    expect(availableTransitions(other, pending)).toEqual([]);
    // A manager in the zone but not named does not approve.
    expect(availableTransitions(manager, { ...pending, deciderIds: ["someone"] })).not.toContain(
      "APPROVED",
    );
  });

  it("a request up the lines: the assignee accepts or declines it", () => {
    const up = team("PENDING_APPROVAL", "member", "manager", { deciderIds: ["manager"] });
    expect(availableTransitions(manager, up)).toEqual(["APPROVED", "DRAFT"]);
  });

  it("declining and returning work need a reason; the author or assignee taking back do not", () => {
    const pending = team("PENDING_APPROVAL", "member", "other", { deciderIds: ["manager"] });
    expect(needsReason(manager, pending, "DRAFT")).toBe(true);
    expect(needsReason(member, pending, "DRAFT")).toBe(false);
    const review = team("IN_REVIEW", "owner", "member");
    expect(needsReason(owner, review, "IN_PROGRESS")).toBe(true);
    expect(needsReason(member, review, "IN_PROGRESS")).toBe(false);
  });

  it("only the assignee starts work and hands it in", () => {
    expect(availableTransitions(member, team("APPROVED"))).toEqual(["IN_PROGRESS"]);
    expect(availableTransitions(owner, team("APPROVED"))).toEqual(["CANCELLED"]);
    expect(availableTransitions(member, team("IN_PROGRESS"))).toEqual(["IN_REVIEW"]);
  });

  it("the author accepts; the owner or a manager in the zone instead; never the assignee", () => {
    expect(availableTransitions(owner, team("IN_REVIEW"))).toEqual([
      "DONE",
      "IN_PROGRESS",
      "CANCELLED",
    ]);
    expect(availableTransitions(member, team("IN_REVIEW"))).toEqual(["IN_PROGRESS"]);
    expect(availableTransitions(manager, team("IN_REVIEW", "other", "member"))).toContain("DONE");
  });

  it("one's own task is accepted by the nearest manager only (not by other managers)", () => {
    const own = team("IN_REVIEW", "member", "member", { reviewerId: "manager" });
    expect(availableTransitions(manager, own)).toContain("DONE");
    expect(availableTransitions(member, own)).toEqual(["IN_PROGRESS", "CANCELLED"]);
    const elsewhere = { ...own, reviewerId: "boss" };
    expect(availableTransitions(manager, elsewhere)).not.toContain("DONE");
  });

  it("a manager never controls a task they do themselves", () => {
    const up = team("APPROVED", "member", "manager");
    expect(availableTransitions(manager, up)).toEqual(["IN_PROGRESS"]);
  });

  it("the owner's own task closes when handed in", () => {
    const own = team("IN_PROGRESS", "owner", "owner");
    expect(availableTransitions(owner, own)).toEqual(["DONE", "CANCELLED"]);
  });

  it("a task can't be accepted while a blocking task is open", () => {
    expect(checkTransition(owner, team("IN_REVIEW"), "DONE", 1)).toEqual({
      ok: false,
      reason: "blocked",
    });
    expect(checkTransition(owner, team("IN_REVIEW"), "DONE", 0)).toEqual({ ok: true });
  });
});

describe("personal task transitions", () => {
  it("only the author moves it, without approval", () => {
    expect(availableTransitions(member, personal("DRAFT"))).toEqual(["IN_PROGRESS", "CANCELLED"]);
    expect(availableTransitions(member, personal("IN_PROGRESS"))).toEqual([
      "DONE",
      "DRAFT",
      "CANCELLED",
    ]);
    expect(availableTransitions(owner, personal("IN_PROGRESS"))).toEqual([]);
  });
});
