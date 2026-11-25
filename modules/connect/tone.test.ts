import { describe, expect, it } from "vitest";

import type { PathRow } from "./oos-path";
import type { RouteZone } from "./routes";
import { DEFAULT_RULES } from "./rules";
import {
  classTone,
  connectTone,
  deliveryColor,
  deltaTone,
  idleTone,
  lineBands,
  pathRepTone,
  pathRowTone,
  REASON_TONE,
  regionTone,
  STAGE_COLOR,
  targetBands,
  visitedTone,
  worstTone,
  zoneTone,
} from "./tone";
import { NO_VISITS_REGION } from "./visits";

// The blocks' own colour rules, shared by the page and the Excel file (targetTone, lineTone and
// changeTone are tested next to the page: components/connect/tone.test.ts, zone-sales.test.tsx).

describe("the colour rules of the Connect blocks", () => {
  it("says where the colours change, for a legend", () => {
    expect(targetBands(95)).toEqual({ warn: 80.75, good: 95 });
    expect(lineBands(70)).toEqual({ warn: 70, good: 85 });
    expect(lineBands(15)).toEqual({ warn: 15, good: 57.5 });
    // A line of 0% is switched off.
    expect(lineBands(0)).toBeNull();
  });

  it("judges the visits and Connect against the owner's lines", () => {
    const rules = { ...DEFAULT_RULES, visited: 85, connect: 70 };
    expect(visitedTone({ planned: 10, visitedRate: 84 }, rules)).toBe("bad");
    expect(visitedTone({ planned: 10, visitedRate: 93 }, rules)).toBe("good");
    expect(visitedTone({ planned: 10, visitedRate: 84 }, { visited: 60 })).toBe("good");
    // Nothing planned, nothing visited: nothing to judge.
    expect(visitedTone({ planned: 0, visitedRate: 0 }, rules)).toBeNull();
    expect(connectTone({ visited: 0, connectRate: 0 }, rules)).toBeNull();
    expect(connectTone({ visited: 5, connectRate: 71 }, rules)).toBe("warn");

    // A region is as bad as the worse of its two shares.
    const region = { region: "Тестоград", planned: 10, visitedRate: 93, connectRate: 60 };
    expect(regionTone(region, rules)).toBe("bad");
    expect(regionTone({ ...region, connectRate: 90 }, rules)).toBe("good");
    expect(regionTone({ ...region, region: NO_VISITS_REGION }, rules)).toBeNull();
    expect(regionTone({ ...region, planned: 0 }, rules)).toBeNull();
    expect(worstTone(["good", null, "warn"])).toBe("warn");
    expect(worstTone([null, null])).toBeNull();
  });

  it("marks a zone: a rep by the class of the matrix, a TSM by attendance", () => {
    const targets = { attendance: 95, hitRate: 90 };
    const zone = (kind: "TSM" | "DR", attendance: number, value: RouteZone["class"]) =>
      ({ kind, attendance, class: value }) as RouteZone;
    expect(zoneTone(zone("TSM", 96, null), targets)).toBe("good");
    expect(zoneTone(zone("TSM", 40, null), targets)).toBe("bad");
    expect(zoneTone(zone("DR", 100, "one"), targets)).toBe("warn");
    expect(zoneTone(zone("DR", 100, "both"), targets)).toBe("bad");
    expect((["ok", "one", "both"] as const).map(classTone)).toEqual(["good", "warn", "bad"]);
    // A change in percentage points: up is green, down red, none has no colour.
    expect([1.4, -2, 0, null].map(deltaTone)).toEqual(["good", "bad", null, null]);
  });

  it("marks what the two sources disagree on, and an order nobody delivered", () => {
    const row = (deliveredNoSale: number, agentWaiting: number) =>
      ({ deliveredNoSale, agentWaiting }) as PathRow;
    expect(pathRowTone(row(1, 0))).toBe("bad");
    // A TSM's row is not marked for a rep's silence; the rep's own row is.
    expect(pathRowTone(row(0, 3))).toBeNull();
    expect(pathRepTone(row(0, 3))).toBe("warn");
    expect(pathRepTone(row(2, 3))).toBe("bad");
    expect(REASON_TONE).toEqual({
      deliveredNoSale: "bad",
      agentWaiting: "warn",
      noOrderNoSale: null,
    });
    expect(idleTone({ orders: 1 })).toBe("warn");
    expect(idleTone({ orders: 0 })).toBeNull();
  });

  it("gives a delivery status the colour of its stage", () => {
    expect(deliveryColor("Доставлено и подтверждено точкой")).toBe(STAGE_COLOR.delivered);
    // Whatever the bot writes has a colour of the scale.
    expect(Object.values(STAGE_COLOR)).toContain(deliveryColor(""));
  });
});
