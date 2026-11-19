import { describe, expect, it } from "vitest";

import { MAX_DRAFT_STEPS, parseDraftSteps } from "./draft-steps";

describe("parseDraftSteps", () => {
  it("reads the hidden field's JSON, dropping empty titles and wrong dates", () => {
    expect(
      parseDraftSteps(
        JSON.stringify([
          { title: " Собрать  комплекты ", dueDate: "2026-11-20" },
          { title: "Передать", dueDate: "20.11" },
          { title: "Проверить" },
          { title: "", dueDate: null },
        ]),
      ),
    ).toEqual([
      { title: "Собрать комплекты", dueDate: "2026-11-20" },
      { title: "Передать", dueDate: null },
      { title: "Проверить", dueDate: null },
    ]);
  });

  it("gives nothing for an empty, broken or wrong-shaped field", () => {
    expect(parseDraftSteps(undefined)).toEqual([]);
    expect(parseDraftSteps("")).toEqual([]);
    expect(parseDraftSteps("[{")).toEqual([]);
    expect(parseDraftSteps(JSON.stringify({ title: "x" }))).toEqual([]);
  });

  it("keeps at most the first steps", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `Шаг ${i}`, dueDate: null }));
    expect(parseDraftSteps(JSON.stringify(many))).toHaveLength(MAX_DRAFT_STEPS);
  });
});
