import { describe, expect, it } from "vitest";

import { averageScores, scoreTeam } from "./profile";

const facts = (
  f: Partial<Parameters<typeof scoreTeam>[0] extends Map<string, infer F> ? F : never>,
) => ({
  completed: 0,
  completedWithDue: 0,
  completedOnTime: 0,
  averageDays: null,
  active: 0,
  overdue: 0,
  returned: 0,
  ...f,
});

describe("employee profile scores", () => {
  it("scores each axis from 0 to 100, relative to the team where it says so", () => {
    const scores = scoreTeam(
      new Map([
        [
          "a",
          facts({
            completed: 10,
            completedWithDue: 8,
            completedOnTime: 6,
            averageDays: 2,
            active: 4,
            overdue: 1,
            returned: 1,
          }),
        ],
        [
          "b",
          facts({
            completed: 5,
            completedWithDue: 5,
            completedOnTime: 5,
            averageDays: 4,
            active: 2,
            overdue: 0,
          }),
        ],
      ]),
    );
    expect(scores.get("a")).toEqual({
      onTime: 75,
      output: 100,
      noOverdue: 75,
      speed: 100,
      firstTime: 90,
    });
    expect(scores.get("b")).toEqual({
      onTime: 100,
      output: 50,
      noOverdue: 100,
      speed: 50,
      firstTime: 100,
    });
    expect(averageScores([...scores.values()])).toEqual({
      onTime: 88,
      output: 75,
      noOverdue: 88,
      speed: 75,
      firstTime: 95,
    });
  });

  it("says 'no data' instead of inventing a score", () => {
    const scores = scoreTeam(new Map([["new", facts({})]]));
    expect(scores.get("new")).toEqual({
      onTime: null,
      output: null,
      noOverdue: null,
      speed: null,
      firstTime: null,
    });
    expect(averageScores([])).toEqual({
      onTime: null,
      output: null,
      noOverdue: null,
      speed: null,
      firstTime: null,
    });
  });
});
