import { describe, expect, it } from "vitest";

import { matchUser, normName } from "./match";

describe("name matching", () => {
  it("treats Cyrillic and Latin spellings as the same name", () => {
    expect(normName("Жавлонбек")).toBe("javlonbek");
    expect(normName("  Ғайрат  Ўрозов ")).toBe("gayrat orozov");
    expect(normName("G'ayrat")).toBe("gayrat");
    const users = [
      { id: "1", firstName: "Жавлонбек", lastName: "Тестов" },
      { id: "2", firstName: "Тестовый", lastName: null },
    ];
    expect(matchUser("Javlonbek", users)).toBe("1");
    expect(matchUser("Javlonbek Testov", users)).toBe("1");
  });
});
