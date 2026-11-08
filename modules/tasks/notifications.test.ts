import { describe, expect, it } from "vitest";

import { taskEventRecipients } from "./notifications";

const task = {
  id: "t1",
  title: "Тестовая задача",
  isPersonal: false,
  creatorId: "author",
  assigneeId: "worker",
  approvedAt: new Date(),
  deciderIds: ["boss"],
};
const ids = (n: { userId: string }[]) => n.map((x) => x.userId);

describe("task notifications (routing v2)", () => {
  it("started right away: the assignee, and their manager with a cancel button", () => {
    const notices = taskEventRecipients(task, { kind: "started", teamNoticeId: "boss" }, "author");
    expect(ids(notices)).toEqual(["worker", "boss"]);
    expect(notices[1]!.type).toBe("task_team");
    expect(notices[1]!.buttons?.()[0]?.[0]?.data).toBe("t:t1:C");
  });

  it("waiting: only the deciders, with Approve / Decline; a decline: the author", () => {
    const pending = taskEventRecipients(task, { kind: "pending" }, "author");
    expect(ids(pending)).toEqual(["boss"]);
    expect(pending[0]!.buttons?.()[0]?.map((b) => b.data)).toEqual(["t:t1:A", "t:t1:D"]);
    expect(ids(taskEventRecipients(task, { kind: "rejected", reason: "нет" }, "boss"))).toEqual([
      "author",
    ]);
  });

  it("started work: the author hears it; handed in: the reviewer, with Accept / Return", () => {
    expect(ids(taskEventRecipients(task, { kind: "taken" }, "worker"))).toEqual(["author"]);
    const review = taskEventRecipients(task, { kind: "review", reviewerIds: ["author"] }, "worker");
    expect(ids(review)).toEqual(["author"]);
    expect(review[0]!.buttons?.()[0]?.map((b) => b.data)).toEqual(["t:t1:F", "t:t1:W"]);
  });

  it("a co-assignee request comes with Add / Decline for whoever decides", () => {
    const notices = taskEventRecipients(
      task,
      { kind: "coRequested", requestId: "r1", deciderIds: ["boss"], name: "Дилноза" },
      "author",
    );
    expect(ids(notices)).toEqual(["boss"]);
    expect(notices[0]!.buttons?.()[0]?.map((b) => b.data)).toEqual(["ca:r1:y", "ca:r1:n"]);
  });

  it("back in work: the assignee and the author", () => {
    expect(ids(taskEventRecipients(task, { kind: "reopened" }, "boss"))).toEqual([
      "worker",
      "author",
    ]);
  });

  it("cancelled while waiting: the deciders too, but not an assignee who never saw it", () => {
    const waiting = { ...task, approvedAt: null };
    expect(
      ids(
        taskEventRecipients(
          waiting,
          { kind: "cancelled", wasPending: true, reason: null },
          "author",
        ),
      ),
    ).toEqual(["boss"]);
  });

  it("nobody hears about their own action; personal tasks notify nobody", () => {
    expect(ids(taskEventRecipients(task, { kind: "done" }, "author"))).toEqual(["worker"]);
    expect(taskEventRecipients({ ...task, isPersonal: true }, { kind: "done" }, "x")).toEqual([]);
  });

  it("co-assignees hear what the assignee hears, and their own add, request and decision", () => {
    const shared = { ...task, coAssigneeIds: ["helper"] };
    expect(ids(taskEventRecipients(shared, { kind: "approved" }, "boss"))).toEqual([
      "worker",
      "helper",
      "author",
    ]);
    // One of them started: the author and the others.
    expect(ids(taskEventRecipients(shared, { kind: "taken" }, "helper"))).toEqual([
      "author",
      "worker",
    ]);
    expect(
      ids(taskEventRecipients(shared, { kind: "coAdded", userId: "helper" }, "worker")),
    ).toEqual(["helper"]);
    // Before approval they can't see the task yet: they hear when it starts.
    expect(
      ids(
        taskEventRecipients(
          { ...shared, approvedAt: null },
          { kind: "coAdded", userId: "helper" },
          "author",
        ),
      ),
    ).toEqual([]);
    expect(
      ids(
        taskEventRecipients(
          shared,
          { kind: "coRequested", requestId: "r1", deciderIds: ["other"], name: "Тест" },
          "worker",
        ),
      ),
    ).toEqual(["other"]);
    expect(
      ids(
        taskEventRecipients(
          shared,
          { kind: "coDecided", requesterId: "worker", name: "Тест", approved: false },
          "other",
        ),
      ),
    ).toEqual(["worker"]);
  });
});
