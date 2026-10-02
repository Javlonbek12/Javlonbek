import { describe, expect, it } from "vitest";

import { filtersWhere, parseTaskFilters } from "./filters";

const actor = { id: "u1", role: "MEMBER" as const };

describe("parseTaskFilters", () => {
  it("uses defaults for missing or invalid values", () => {
    expect(parseTaskFilters({})).toEqual({
      scope: "mine",
      status: "active",
      due: "any",
      project: "",
    });
    expect(parseTaskFilters({ scope: "hack", status: "WRONG" })).toMatchObject({
      scope: "mine",
      status: "active",
    });
  });

  it("accepts valid values", () => {
    expect(
      parseTaskFilters({ scope: "team", status: "DONE", due: "overdue", project: "ESSE" }),
    ).toEqual({
      scope: "team",
      status: "DONE",
      due: "overdue",
      project: "ESSE",
    });
  });
});

describe("filtersWhere", () => {
  it("builds a database filter for 'my overdue tasks'", () => {
    const where = filtersWhere(
      { scope: "mine", status: "active", due: "overdue", project: "" },
      actor,
      "2026-10-02",
    );
    expect(where).toEqual({
      AND: [
        { assigneeId: "u1" },
        { status: { notIn: ["DONE", "CANCELLED"] } },
        {
          dueDate: { lt: new Date("2026-10-02T00:00:00Z") },
          status: { notIn: ["DONE", "CANCELLED"] },
        },
      ],
    });
  });
});
