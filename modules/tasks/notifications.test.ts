import { describe, expect, it } from "vitest";

import { statusChangeRecipients } from "./notifications";

const task = { id: "t", title: "Т", isPersonal: false, creatorId: "owner", assigneeId: "member" };
const ids = (notices: { userId: string; type: string }[]) =>
  notices.map((n) => `${n.userId}:${n.type}`);

describe("statusChangeRecipients", () => {
  it("asks approvers (except the actor) to approve", () => {
    const notices = statusChangeRecipients(task, "DRAFT", "PENDING_APPROVAL", "owner", [
      "owner",
      "manager",
    ]);
    expect(ids(notices)).toEqual(["manager:task_pending_approval"]);
  });

  it("tells the assignee about a newly approved task", () => {
    const notices = statusChangeRecipients(task, "PENDING_APPROVAL", "APPROVED", "owner", [
      "owner",
    ]);
    expect(ids(notices)).toEqual(["member:task_assigned"]);
  });

  it("tells the creator that work is ready for review", () => {
    const notices = statusChangeRecipients(task, "IN_PROGRESS", "IN_REVIEW", "member", ["owner"]);
    expect(ids(notices)).toEqual(["owner:task_status"]);
  });

  it("tells the assignee that the work was accepted", () => {
    const notices = statusChangeRecipients(task, "IN_REVIEW", "DONE", "owner", ["owner"]);
    expect(ids(notices)).toEqual(["member:task_status"]);
  });

  it("never notifies about personal tasks", () => {
    expect(
      statusChangeRecipients({ ...task, isPersonal: true }, "DRAFT", "IN_PROGRESS", "x", []),
    ).toEqual([]);
  });
});
