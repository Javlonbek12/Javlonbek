import { describe, expect, it } from "vitest";

import { nextWeekday, parseUserDate } from "./parse-date";

const TODAY = "2026-10-02"; // Friday

describe("parseUserDate", () => {
  it.each([
    ["сегодня", "2026-10-02"],
    ["завтра", "2026-10-03"],
    ["ertaga", "2026-10-03"],
    ["послезавтра", "2026-10-04"],
    ["в понедельник", "2026-10-05"],
    ["dushanba", "2026-10-05"],
    ["пятница", "2026-10-02"],
    ["четверг", "2026-10-08"],
    ["5.10", "2026-10-05"],
    ["05.10.2026", "2026-10-05"],
    ["2026-11-01", "2026-11-01"],
    ["+7", "2026-10-09"],
    ["конец месяца", "2026-10-31"],
    ["1.09", "2027-09-01"],
  ])("%s → %s", (input, expected) => {
    expect(parseUserDate(input, TODAY)).toBe(expected);
  });

  it("returns null for things that are not dates", () => {
    expect(parseUserDate("когда-нибудь", TODAY)).toBeNull();
    expect(parseUserDate("31.02", TODAY)).toBeNull();
  });
});

describe("nextWeekday", () => {
  it("returns today when today is that weekday", () => {
    expect(nextWeekday(TODAY, 4)).toBe(TODAY);
  });
});
