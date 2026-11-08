import { describe, expect, it } from "vitest";

import { changeNote, formatDays } from "./summary";

describe("report change notes", () => {
  it("on a few tasks says the number before, not a percentage", () => {
    expect(changeNote(9, 4)).toBe("▲ было 4");
    expect(changeNote(2, 0)).toBe("▲ было 0");
    expect(changeNote(20, 10)).toBe("▲ +100%");
    expect(changeNote(5, 5)).toBe("без изменений");
    expect(changeNote(null, 5)).toBe("нет данных");
  });

  it("days with a decimal comma, points as points", () => {
    expect(changeNote(7.3, 1.5, "days")).toBe("▲ было 1,5 дн.");
    expect(formatDays(7.3)).toBe("7,3 дн.");
    expect(changeNote(60, 75, "points")).toBe("▼ −15 п.п.");
  });
});
