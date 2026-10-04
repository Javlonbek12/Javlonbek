import { describe, expect, it } from "vitest";

import type { TaskStatus } from "@/lib/generated/prisma/client";

import type { TaskAccessInfo } from "./access";
import { availableTransitions, checkTransition } from "./status";

const owner = { id: "owner", role: "OWNER" as const };
const manager = { id: "manager", role: "MANAGER" as const };
const member = { id: "member", role: "MEMBER" as const };
const other = { id: "other", role: "MEMBER" as const };

function team(status: TaskStatus, creatorId = "owner", assigneeId = "member"): TaskAccessInfo {
  return { isPersonal: false, creatorId, assigneeId, status, approvedAt: null };
}

function personal(status: TaskStatus, authorId = "member"): TaskAccessInfo {
  return { isPersonal: true, creatorId: authorId, assigneeId: authorId, status, approvedAt: null };
}

describe("team task transitions", () => {
  it("creator submits a draft; an OWNER/MANAGER creator may approve right away", () => {
    expect(availableTransitions(member, team("DRAFT", "member", "other"))).toEqual([
      "PENDING_APPROVAL",
      "CANCELLED",
    ]);
    expect(availableTransitions(owner, team("DRAFT"))).toEqual([
      "PENDING_APPROVAL",
      "APPROVED",
      "CANCELLED",
    ]);
  });

  it("only OWNER/MANAGER approve; MEMBER never approves", () => {
    const pending = team("PENDING_APPROVAL", "member", "other");
    expect(availableTransitions(manager, pending)).toContain("APPROVED");
    expect(availableTransitions(owner, pending)).toContain("APPROVED");
    expect(availableTransitions(member, pending)).not.toContain("APPROVED");
    expect(availableTransitions(other, pending)).toEqual([]);
  });

  it("an approver can send a pending task back to draft", () => {
    expect(availableTransitions(manager, team("PENDING_APPROVAL"))).toContain("DRAFT");
  });

  it("only the assignee starts work and sends it for review", () => {
    expect(availableTransitions(member, team("APPROVED"))).toEqual(["IN_PROGRESS"]);
    expect(availableTransitions(owner, team("APPROVED"))).toEqual(["CANCELLED"]);
    expect(availableTransitions(member, team("IN_PROGRESS"))).toEqual(["IN_REVIEW"]);
  });

  it("the creator accepts (DONE) or returns the work; the assignee cannot accept own work", () => {
    expect(availableTransitions(owner, team("IN_REVIEW"))).toEqual([
      "DONE",
      "IN_PROGRESS",
      "CANCELLED",
    ]);
    expect(availableTransitions(member, team("IN_REVIEW"))).toEqual(["IN_PROGRESS"]);
  });

  it("a MEMBER who made a task for themselves needs a manager to accept it", () => {
    const own = team("IN_REVIEW", "member", "member");
    expect(availableTransitions(member, own)).not.toContain("DONE");
    expect(availableTransitions(manager, own)).toContain("DONE");
  });

  it("closed tasks have no transitions", () => {
    expect(availableTransitions(owner, team("DONE"))).toEqual([]);
    expect(availableTransitions(owner, team("CANCELLED"))).toEqual([]);
  });
});

describe("personal task transitions", () => {
  it("skip approval: DRAFT → IN_PROGRESS → DONE", () => {
    expect(availableTransitions(member, personal("DRAFT"))).toEqual(["IN_PROGRESS", "CANCELLED"]);
    expect(availableTransitions(member, personal("IN_PROGRESS"))).toContain("DONE");
    expect(availableTransitions(member, personal("DRAFT"))).not.toContain("PENDING_APPROVAL");
  });

  it("nobody but the author can change them, not even OWNER", () => {
    expect(availableTransitions(owner, personal("DRAFT"))).toEqual([]);
  });
});

describe("checkTransition", () => {
  it("blocks DONE while blocking tasks are open", () => {
    expect(checkTransition(owner, team("IN_REVIEW"), "DONE", 1)).toEqual({
      ok: false,
      reason: "blocked",
    });
    expect(checkTransition(owner, team("IN_REVIEW"), "DONE", 0)).toEqual({ ok: true });
  });

  it("other transitions are not affected by blockers", () => {
    expect(checkTransition(member, team("APPROVED"), "IN_PROGRESS", 3)).toEqual({ ok: true });
  });

  it("rejects transitions the actor is not allowed to make", () => {
    expect(checkTransition(member, team("PENDING_APPROVAL"), "APPROVED", 0)).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});
