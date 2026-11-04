import { describe, expect, it } from "vitest";

import { taskButtons } from "./buttons";
import { availableTransitions } from "./status";

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
  approvedAt: null,
  deciderIds: ["boss"],
  reviewerId: "author",
  ...extra,
});
const labels = (actor: ReturnType<typeof person>, t: ReturnType<typeof task>) =>
  taskButtons(actor, t, availableTransitions(actor, t)).map((b) => [b.label, b.reason]);

describe("task card buttons (routing v2)", () => {
  it("whoever decides approves or declines with a reason; the author withdraws", () => {
    expect(labels(person("boss", "MANAGER"), task("PENDING_APPROVAL"))).toEqual([
      ["tasks.action.APPROVED", null],
      ["tasks.action.reject", "required"],
    ]);
    expect(labels(person("author"), task("PENDING_APPROVAL"))).toEqual([
      ["tasks.withdraw.approval", null],
      ["tasks.action.CANCELLED", "optional"],
    ]);
  });

  it("a request to a manager reads «Принять задачу» for them", () => {
    const request = task("PENDING_APPROVAL", { assigneeId: "boss" });
    expect(labels(person("boss", "MANAGER"), request)[0]).toEqual(["tasks.action.accept", null]);
  });

  it("in review: the author accepts or sends back with a reason; the assignee takes it back", () => {
    expect(labels(person("author"), task("IN_REVIEW", { approvedAt: new Date() }))).toEqual([
      ["tasks.action.DONE", null],
      ["tasks.action.rework", "required"],
      ["tasks.action.CANCELLED", "optional"],
    ]);
    expect(labels(person("worker"), task("IN_REVIEW", { approvedAt: new Date() }))).toEqual([
      ["tasks.withdraw.review", null],
    ]);
  });
});
