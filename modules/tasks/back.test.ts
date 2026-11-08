import { describe, expect, it } from "vitest";

import { safeBack, withParams } from "./back";

describe("going back after a task action", () => {
  it("accepts only task-section paths", () => {
    expect(safeBack("/tasks?scope=team&task=t1", "/tasks/t1")).toBe("/tasks?scope=team&task=t1");
    expect(safeBack("/tasks/t1", "/x")).toBe("/tasks/t1");
    // «Сегодня» with the task panel open.
    expect(safeBack("/?task=t1&tab=work", "/x")).toBe("/?task=t1&tab=work");
    for (const bad of [
      "/tasksx/../settings",
      "/projects",
      "https://evil.example/tasks",
      "//evil.example/tasks",
      "/settings",
      "/tasks\\..",
      "",
      null,
    ])
      expect(safeBack(bad, "/tasks/t1")).toBe("/tasks/t1");
  });

  it("sets and drops query values, never keeping an old error", () => {
    expect(withParams("/tasks?task=t1&error=reason", { tab: "comments" })).toBe(
      "/tasks?task=t1&tab=comments",
    );
    expect(withParams("/tasks?q=a&task=t1", { task: null, deleted: "1" })).toBe(
      "/tasks?q=a&deleted=1",
    );
  });
});
