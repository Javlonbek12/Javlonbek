import { describe, expect, it } from "vitest";

import type { Actor } from "@/modules/core/permissions";

import type { TaskAccessInfo } from "./access";
import { canPlanSteps, canTickSteps, currentStep, stepPeopleIds, stepProgress } from "./step-rules";

const at = new Date("2026-11-07T10:00:00Z");
const actor = (id: string, role: Actor["role"] = "MEMBER") => ({ id, role }) as Actor;
const team = (status: TaskAccessInfo["status"]): TaskAccessInfo => ({
  isPersonal: false,
  creatorId: "author",
  assigneeId: "worker",
  status,
  approvedAt: status === "DRAFT" || status === "PENDING_APPROVAL" ? null : at,
});

describe("step progress", () => {
  it("counts done steps and finds where the work stopped", () => {
    const steps = [
      { id: "b", position: 1, doneAt: null },
      { id: "a", position: 0, doneAt: at },
      { id: "c", position: 2, doneAt: null },
    ];
    expect(stepProgress(steps)).toEqual({ done: 1, total: 3 });
    expect(currentStep(steps)?.id).toBe("b");
    expect(currentStep(steps.map((s) => ({ ...s, doneAt: at })))).toBeNull();
    expect(stepProgress([])).toEqual({ done: 0, total: 0 });
  });

  it("a step goes to the assignee or the author", () => {
    expect(stepPeopleIds({ creatorId: "author", assigneeId: "worker" })).toEqual([
      "worker",
      "author",
    ]);
    expect(stepPeopleIds({ creatorId: "me", assigneeId: "me" })).toEqual(["me"]);
  });
});

describe("who works with steps and when", () => {
  it("team task: planned until handed in, ticked once approved and while in work", () => {
    const worker = actor("worker");
    expect(canPlanSteps(actor("author"), team("DRAFT"))).toBe(true);
    expect(canTickSteps(actor("author"), team("DRAFT"))).toBe(false);
    expect(canTickSteps(worker, team("APPROVED"))).toBe(true);
    expect(canTickSteps(worker, team("IN_PROGRESS"))).toBe(true);
    expect(canPlanSteps(worker, team("IN_REVIEW"))).toBe(false);
    expect(canTickSteps(worker, team("IN_REVIEW"))).toBe(false);
    expect(canPlanSteps(worker, team("DONE"))).toBe(false);
    // The assignee doesn't see a draft yet.
    expect(canPlanSteps(worker, team("DRAFT"))).toBe(false);
  });

  it("whoever controls the task works with steps; a stranger doesn't", () => {
    expect(canTickSteps(actor("boss", "OWNER"), team("IN_PROGRESS"))).toBe(true);
    expect(canTickSteps(actor("stranger"), team("IN_PROGRESS"))).toBe(false);
  });

  it("personal task: only its author, from the start", () => {
    const personal = { ...team("DRAFT"), isPersonal: true, assigneeId: "author" };
    expect(canTickSteps(actor("author"), personal)).toBe(true);
    expect(canTickSteps(actor("boss", "OWNER"), personal)).toBe(false);
  });
});
