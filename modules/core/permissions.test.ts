import { describe, expect, it } from "vitest";

import {
  canChangeRole,
  canInvite,
  canRevokeInvite,
  canSendTestNotification,
  invitableRoles,
} from "./permissions";

const owner = { id: "owner", role: "OWNER" as const };
const manager = { id: "manager", role: "MANAGER" as const };
const member = { id: "member", role: "MEMBER" as const };

describe("invites", () => {
  it("OWNER invites managers and members, but not another owner", () => {
    expect(invitableRoles("OWNER")).toEqual(["MANAGER", "MEMBER"]);
    expect(canInvite("OWNER", "OWNER")).toBe(false);
  });

  it("MANAGER invites only members", () => {
    expect(canInvite("MANAGER", "MEMBER")).toBe(true);
    expect(canInvite("MANAGER", "MANAGER")).toBe(false);
  });

  it("MEMBER cannot invite anyone", () => {
    expect(invitableRoles("MEMBER")).toEqual([]);
  });
});

describe("canChangeRole", () => {
  it("OWNER can promote a member to manager", () => {
    expect(canChangeRole(owner, member, "MANAGER")).toBe(true);
  });

  it("nobody can make another OWNER or demote the OWNER", () => {
    expect(canChangeRole(owner, member, "OWNER")).toBe(false);
    expect(canChangeRole(owner, owner, "MEMBER")).toBe(false);
  });

  it("MANAGER and MEMBER cannot change roles", () => {
    expect(canChangeRole(manager, member, "MANAGER")).toBe(false);
    expect(canChangeRole(member, manager, "MEMBER")).toBe(false);
  });
});

describe("canRevokeInvite", () => {
  it("OWNER revokes any invite, MANAGER only own, MEMBER none", () => {
    expect(canRevokeInvite(owner, { createdById: "manager" })).toBe(true);
    expect(canRevokeInvite(manager, { createdById: "manager" })).toBe(true);
    expect(canRevokeInvite(manager, { createdById: "owner" })).toBe(false);
    expect(canRevokeInvite(member, { createdById: "member" })).toBe(false);
  });
});

describe("canSendTestNotification", () => {
  it("anyone can send to themselves; only OWNER/MANAGER to others", () => {
    expect(canSendTestNotification(member, "member")).toBe(true);
    expect(canSendTestNotification(member, "owner")).toBe(false);
    expect(canSendTestNotification(manager, "member")).toBe(true);
  });
});
