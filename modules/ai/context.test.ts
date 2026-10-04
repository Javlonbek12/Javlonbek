import { describe, expect, it } from "vitest";

import { calendarBlock, contextBlock } from "./context";

describe("prompt context", () => {
  it("lists the next days with Russian and Uzbek weekday names", () => {
    const block = calendarBlock("2026-10-02");
    expect(block).toContain("2026-10-02 пятница / juma (today)");
    expect(block).toContain("2026-10-05 понедельник / dushanba");
    expect(block).toContain("End of this month: 2026-10-31");
    expect(block).toContain("In one week: 2026-10-09");
  });

  it("includes team and projects", () => {
    const block = contextBlock({
      today: "2026-10-02",
      timezone: "Asia/Tashkent",
      speakerName: "Тестовый владелец",
      teamNames: ["Азиз Каримов", "Дильноза"],
      projects: ["ESSE Change 1"],
    });
    expect(block).toContain("Team members: Азиз Каримов, Дильноза.");
    expect(block).toContain("Known projects: ESSE Change 1.");
  });
});
