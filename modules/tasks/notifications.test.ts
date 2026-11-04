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
    expect(notices[1]!.buttons?.[0]?.[0]?.data).toBe("t:t1:C");
  });

  it("waiting: only the deciders; a decline: the author", () => {
    expect(ids(taskEventRecipients(task, { kind: "pending" }, "author"))).toEqual(["boss"]);
    expect(ids(taskEventRecipients(task, { kind: "rejected", reason: "нет" }, "boss"))).toEqual([
      "author",
    ]);
  });

  it("started work: the author hears it; handed in: the reviewer", () => {
    expect(ids(taskEventRecipients(task, { kind: "taken" }, "worker"))).toEqual(["author"]);
    expect(
      ids(taskEventRecipients(task, { kind: "review", reviewerIds: ["author"] }, "worker")),
    ).toEqual(["author"]);
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
});
