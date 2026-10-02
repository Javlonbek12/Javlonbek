import { describe, expect, it } from "vitest";

import { canEditTask, canViewTask, type TaskAccessInfo } from "./access";

const owner = { id: "owner", role: "OWNER" as const };
const manager = { id: "manager", role: "MANAGER" as const };
const member = { id: "member", role: "MEMBER" as const };
const other = { id: "other", role: "MEMBER" as const };

const draftForMember: TaskAccessInfo = {
  isPersonal: false,
  creatorId: "owner",
  assigneeId: "member",
  status: "PENDING_APPROVAL",
  approvedAt: null,
};
const approvedForMember = {
  ...draftForMember,
  status: "APPROVED" as const,
  approvedAt: new Date(),
};
const personalOfMember: TaskAccessInfo = {
  isPersonal: true,
  creatorId: "member",
  assigneeId: "member",
  status: "DRAFT",
  approvedAt: null,
};

describe("canViewTask", () => {
  it("the assignee sees a team task only after approval", () => {
    expect(canViewTask(member, draftForMember)).toBe(false);
    expect(canViewTask(member, approvedForMember)).toBe(true);
  });

  it("OWNER and MANAGER see all team tasks; other members do not", () => {
    expect(canViewTask(owner, draftForMember)).toBe(true);
    expect(canViewTask(manager, draftForMember)).toBe(true);
    expect(canViewTask(other, approvedForMember)).toBe(false);
  });

  it("personal tasks are visible only to the author, not even to OWNER", () => {
    expect(canViewTask(member, personalOfMember)).toBe(true);
    expect(canViewTask(owner, personalOfMember)).toBe(false);
  });
});

describe("canEditTask", () => {
  it("creator and approvers edit open team tasks; the assignee does not", () => {
    expect(canEditTask(owner, approvedForMember)).toBe(true);
    expect(canEditTask(manager, approvedForMember)).toBe(true);
    expect(canEditTask(member, approvedForMember)).toBe(false);
  });

  it("closed tasks are not editable", () => {
    expect(canEditTask(owner, { ...approvedForMember, status: "DONE" })).toBe(false);
  });
});
