import { describe, expect, it } from "vitest";

import { doerWhere } from "./access";
import { filtersWhere, parseTaskFilters, type TaskFilters } from "./filters";

const actor = { id: "u1", role: "MEMBER" as const };
const base: TaskFilters = {
  scope: "mine",
  status: "active",
  due: "any",
  priority: "any",
  project: "",
  q: "",
  sort: "smart",
  person: "",
  label: "",
};

describe("parseTaskFilters", () => {
  it("uses defaults for missing or invalid values", () => {
    expect(parseTaskFilters({})).toEqual(base);
    expect(
      parseTaskFilters({ scope: "hack", status: "WRONG", sort: "random", priority: "x" }),
    ).toMatchObject({ scope: "mine", status: "active", sort: "smart", priority: "any" });
  });

  it("accepts valid values", () => {
    expect(
      parseTaskFilters({
        scope: "team",
        status: "DONE",
        due: "overdue",
        priority: "important",
        project: "ESSE",
        q: " отчёт ",
        sort: "priority",
        person: "u2",
      }),
    ).toEqual({
      person: "u2",
      scope: "team",
      status: "DONE",
      due: "overdue",
      priority: "important",
      project: "ESSE",
      q: "отчёт",
      sort: "priority",
      label: "",
    });
  });
});

describe("filtersWhere", () => {
  it("builds a database filter for 'my overdue tasks'", () => {
    expect(filtersWhere({ ...base, due: "overdue" }, actor, "2026-10-02")).toEqual({
      AND: [
        doerWhere("u1"),
        { status: { notIn: ["DONE", "CANCELLED"] } },
        {
          dueDate: { lt: new Date("2026-10-02T00:00:00Z") },
          status: { notIn: ["DONE", "CANCELLED"] },
        },
      ],
    });
  });

  it("adds search, importance; leaves quick filters out when counting", () => {
    const filters = { ...base, q: "отчёт", priority: "important" as const, due: "today" as const };
    const full = filtersWhere(filters, actor, "2026-10-02");
    expect(full.AND).toContainEqual({ title: { contains: "отчёт", mode: "insensitive" } });
    expect(full.AND).toContainEqual({ priority: { in: ["HIGH", "URGENT"] } });
    const counting = filtersWhere(filters, actor, "2026-10-02", { quick: false });
    expect(counting.AND).toHaveLength(3);
  });
});

describe("employee filter", () => {
  it("shows the chosen employee's tasks instead of “whose”", () => {
    expect(filtersWhere({ ...base, person: "u2" }, actor, "2026-10-19")).toEqual({
      AND: [doerWhere("u2"), { status: { notIn: ["DONE", "CANCELLED"] } }],
    });
  });
});

describe("labels", () => {
  it("filters by one label", () => {
    expect(filtersWhere({ ...base, label: "выставка" }, actor, "2026-10-19").AND).toContainEqual({
      labels: { has: "выставка" },
    });
    expect(parseTaskFilters({ label: "  выставка " }).label).toBe("выставка");
    expect(parseTaskFilters({ label: "x".repeat(31) }).label).toBe("");
  });
});
