import { describe, expect, it } from "vitest";

import { distinctNames } from "./names";

describe("distinctNames", () => {
  it("adds the position only where a name repeats", () => {
    const names = distinctNames([
      { id: "a", firstName: "Тест", position: "Мерчендайзер" },
      { id: "b", firstName: "Тест", position: "Руководитель (тест)" },
      { id: "c", firstName: "Тест", lastName: "Другой", position: "Сотрудник (тест)" },
      { id: "a", firstName: "Тест", position: "Мерчендайзер" },
    ]);
    expect(names.get("a")).toBe("Тест · Мерчендайзер");
    expect(names.get("b")).toBe("Тест · Руководитель (тест)");
    expect(names.get("c")).toBe("Тест Другой");
  });

  it("keeps the plain name when there is no position to add", () => {
    const names = distinctNames([
      { id: "a", firstName: "Тест" },
      { id: "b", firstName: "Тест", position: " " },
    ]);
    expect([...names.values()]).toEqual(["Тест", "Тест"]);
  });
});
