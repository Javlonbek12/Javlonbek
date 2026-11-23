import { describe, expect, it } from "vitest";

import { ATTENTION_RULES, attentionList, managerOf } from "./attention";
import { buildHierarchy } from "./hierarchy";
import type { PositionRecord } from "./parse";
import { salesCounts } from "./sales";
import { headline, trendOf, trendTone } from "./trend";

// Synthetic data only: TSM_TST_* codes, «Тест …» people, positions «BDM 99» / «BUM TEST».

const position = (
  title: string,
  user: string | null,
  manager: string | null,
  zones: string[] = [],
): PositionRecord => ({
  id: title,
  storeCode: "",
  storeName: "",
  city: null,
  channel: null,
  at: "",
  day: "",
  month: "",
  person: null,
  title,
  user,
  zones,
  roles: [],
  manager,
  created: null,
  status: null,
});

const row = (
  code: string,
  numbers: { visited?: number; connectRate?: number; checked?: number; anySold?: number } = {},
) => ({
  code,
  name: `Тест ${code}`,
  visited: numbers.visited ?? 20,
  connectRate: numbers.connectRate ?? 90,
  sales: { ...salesCounts([]), checked: numbers.checked ?? 0, anySold: numbers.anySold ?? 0 },
});

// A TSM's line of the recovery and follow-up tables.
const restored = (code: string, wasOut: number, rate: number | null) => ({
  code,
  name: null,
  stores: 5,
  restored: 0,
  stillOut: wasOut,
  newlyOut: 0,
  worse: 0,
  wasOut,
  rate,
});
const followed = (code: string, checks: number, rate: number | null) => ({
  code,
  name: null,
  checks,
  followed: 0,
  rate,
});

describe("attentionList", () => {
  it("is empty when every number is within the norm", () => {
    expect(
      attentionList({
        rows: [row("TSM_TST_1"), row("TSM_TST_2", { connectRate: 70 })],
        recovery: [restored("TSM_TST_1", 40, 15)],
        followUp: [followed("TSM_TST_1", 30, 50)],
        sales: true,
        attendance: new Map([["TSM_TST_1", 85]]),
      }),
    ).toEqual([]);
  });

  it("gives each reason with its number", () => {
    const [one] = attentionList({
      rows: [row("TSM_TST_1", { visited: 50, connectRate: 54, checked: 9, anySold: 5 })],
      recovery: [restored("TSM_TST_1", 33, 9)],
      followUp: [followed("TSM_TST_1", 12, 25)],
      sales: true,
      attendance: new Map([["tsm tst 1", 80]]),
    });
    expect(one).toMatchObject({ code: "TSM_TST_1", name: "Тест TSM_TST_1", manager: null });
    expect(one!.reasons.map((r) => [r.kind, r.value, r.of])).toEqual([
      ["connect", 54, 50],
      ["recovery", 9, 33],
      ["followUp", 25, 12],
      ["unsold", 4, 9],
      ["attendance", 80, null],
    ]);
    for (const reason of one!.reasons) {
      expect(reason.severity).toBeGreaterThan(0);
      expect(reason.severity).toBeLessThanOrEqual(1);
    }
  });

  it("needs enough to judge by: visits, products compared, checks counted, sales loaded", () => {
    const R = ATTENTION_RULES;
    const list = attentionList({
      rows: [
        // No planned visits made: the share of Connect says nothing.
        row("TSM_TST_1", { visited: 0, connectRate: 0 }),
        // Fewer products compared and fewer checks counted than the rules ask for.
        row("TSM_TST_2"),
        // Orders with nothing sold, but no sales loaded.
        row("TSM_TST_3", { checked: 8, anySold: 0 }),
        // Two orders with nothing sold: one short of the line.
        row("TSM_TST_4", { checked: R.unsold.from - 1, anySold: 0 }),
        // Nothing to take a share of.
        row("TSM_TST_5"),
      ],
      recovery: [restored("TSM_TST_2", R.recovery.min - 1, 0), restored("TSM_TST_5", 0, null)],
      followUp: [followed("TSM_TST_2", R.followUp.min - 1, 0), followed("TSM_TST_5", 0, null)],
      sales: false,
    });
    expect(list).toEqual([]);
    // With sales loaded the third one's orders count.
    const withSales = attentionList({
      rows: [row("TSM_TST_3", { checked: 8, anySold: 0 }), row("TSM_TST_4", { checked: 2 })],
      sales: true,
    });
    expect(withSales.map((r) => [r.code, r.reasons.map((x) => x.kind)])).toEqual([
      ["TSM_TST_3", ["unsold"]],
    ]);
  });

  it("takes the attendance only when it is given", () => {
    const rows = [row("TSM_TST_1"), row("TSM_TST_2")];
    expect(attentionList({ rows })).toEqual([]);
    expect(attentionList({ rows, attendance: null })).toEqual([]);
    const list = attentionList({
      rows,
      attendance: new Map([
        ["TSM_TST_1", 84.9],
        ["TSM_TST_2", 96],
        // Not a TSM of this list.
        ["TSM_TST_9", 10],
      ]),
    });
    expect(list.map((r) => [r.code, r.reasons.map((x) => [x.kind, x.value])])).toEqual([
      ["TSM_TST_1", [["attendance", 84.9]]],
    ]);
  });

  it("ranks by how many reasons, then by how far past the lines", () => {
    const list = attentionList({
      rows: [
        row("TSM_TST_1", { connectRate: 65 }),
        row("TSM_TST_2", { connectRate: 20 }),
        row("TSM_TST_3", { connectRate: 60 }),
        row("TSM_TST_4"),
      ],
      recovery: [restored("TSM_TST_3", 20, 10), restored("TSM_TST_4", 20, 0)],
    });
    expect(list.map((r) => [r.code, r.reasons.length])).toEqual([
      // Two reasons, though each is close to its line.
      ["TSM_TST_3", 2],
      // One reason each: nothing restored, then Connect on 20% and on 65% of visits.
      ["TSM_TST_4", 1],
      ["TSM_TST_2", 1],
      ["TSM_TST_1", 1],
    ]);
    expect(list[0]!.score).toBeCloseTo((70 - 60) / 70 + (15 - 10) / 15);
  });

  it("names the manager: the person of the position above, by the employee info", () => {
    const hierarchy = buildHierarchy([
      position("BDM 99", "Тест Руководитель", "BUM TEST", ["TSM_TST_3"]),
      position("TSM_TST_1", "Тест Первый", "BDM 99"),
      position("TSM_TST_2", "Тест Второй", "bdm  99"),
    ]);
    const list = attentionList({
      rows: ["TSM_TST_1", "TSM_TST_2", "TSM_TST_3", "TSM_TST_4"].map((code) =>
        row(code, { connectRate: 10 }),
      ),
      hierarchy,
    });
    expect(list.map((r) => [r.code, r.manager])).toEqual([
      ["TSM_TST_1", { name: "Тест Руководитель", title: "BDM 99" }],
      ["TSM_TST_2", { name: "Тест Руководитель", title: "BDM 99" }],
      // A zone of BDM 99's own position: above it is BUM TEST, a title without a person.
      ["TSM_TST_3", { name: null, title: "BUM TEST" }],
      // Not in the employee info.
      ["TSM_TST_4", null],
    ]);
    expect(managerOf(null, "TSM_TST_1")).toBeNull();
    expect(managerOf(hierarchy, "BUM TEST")).toBeNull();
  });
});

describe("the tiles against the previous period", () => {
  const sections = (n: {
    planned: number;
    visited: number;
    visitedRate: number;
    connectRate: number;
    unique: number;
    closed: number;
    fullRate: number;
    checked: number;
    gapRate: number;
  }) =>
    ({
      visits: n,
      mv: { unique: n.unique, results: { closed: n.closed }, fullRate: n.fullRate },
      oos: { checked: n.checked, gapRate: n.gapRate },
    }) as unknown as Parameters<typeof headline>[0];
  const now = sections({
    planned: 100,
    visited: 80,
    visitedRate: 80,
    connectRate: 75,
    unique: 60,
    closed: 5,
    fullRate: 50,
    checked: 40,
    gapRate: 45,
  });

  it("takes a share only where there is something to take it of", () => {
    expect(headline(now, { totals: { rate: 25 } } as never)).toEqual({
      planDone: 80,
      connectUsed: 75,
      mvFull: 50,
      oosStores: 45,
      recovery: 25,
    });
    const empty = sections({
      planned: 0,
      visited: 0,
      visitedRate: 0,
      connectRate: 0,
      unique: 3,
      closed: 3,
      fullRate: 0,
      checked: 0,
      gapRate: 0,
    });
    expect(headline(empty, null)).toEqual({
      planDone: null,
      connectUsed: null,
      mvFull: null,
      oosStores: null,
      recovery: null,
    });
  });

  it("gives the change in percentage points, or nothing without a number to compare with", () => {
    const current = headline(now, { totals: { rate: 25 } } as never);
    const before = { planDone: 78, connectUsed: 75, mvFull: 61, oosStores: 50, recovery: null };
    expect(trendOf(current, before)).toEqual({
      planDone: { delta: 2, was: 78 },
      connectUsed: { delta: 0, was: 75 },
      mvFull: { delta: -11, was: 61 },
      oosStores: { delta: -5, was: 50 },
      recovery: null,
    });
    expect(Object.values(trendOf(current, null))).toEqual([null, null, null, null, null]);
  });

  it("knows which way is better", () => {
    expect(trendTone(2)).toBe("better");
    expect(trendTone(-2)).toBe("worse");
    expect(trendTone(0)).toBe("same");
    // Stores with an OOS: fewer is better.
    expect(trendTone(-5, true)).toBe("better");
    expect(trendTone(5, true)).toBe("worse");
    expect(trendTone(0, true)).toBe("same");
  });
});
