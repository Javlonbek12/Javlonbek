import { describe, expect, it } from "vitest";

import { matchPerson, normalizeName } from "./match";

const people = [
  { id: "1", firstName: "Азиз", lastName: "Каримов", telegramUsername: "aziz_k" },
  { id: "2", firstName: "Дильноза", lastName: "Юсупова", telegramUsername: null },
  { id: "3", firstName: "Тестовый сотрудник", lastName: "1", telegramUsername: null },
  { id: "4", firstName: "Азиз", lastName: "Рахимов", telegramUsername: null },
  { id: "5", firstName: "Sardor", lastName: null, telegramUsername: null },
];

const ids = (result: ReturnType<typeof matchPerson>) =>
  result.status === "matched"
    ? [result.user.id]
    : result.status === "ambiguous"
      ? result.candidates.map((c) => c.id)
      : [];

describe("matchPerson", () => {
  it("matches Russian case forms", () => {
    expect(matchPerson("Дильнозе", people)).toMatchObject({ status: "matched", user: { id: "2" } });
    expect(matchPerson("Дильнозы", people)).toMatchObject({ status: "matched", user: { id: "2" } });
  });

  it("matches Latin and Cyrillic spellings and Uzbek suffixes", () => {
    expect(matchPerson("Dilnozaga", people)).toMatchObject({
      status: "matched",
      user: { id: "2" },
    });
    expect(matchPerson("Сардору", people)).toMatchObject({ status: "matched", user: { id: "5" } });
  });

  it("asks when two people share a first name", () => {
    expect(matchPerson("Азизу", people)).toMatchObject({ status: "ambiguous" });
    expect(ids(matchPerson("Азизу", people)).sort()).toEqual(["1", "4"]);
  });

  it("uses the last name to pick one", () => {
    expect(matchPerson("Азиз Каримов", people)).toMatchObject({
      status: "matched",
      user: { id: "1" },
    });
  });

  it("finds nobody for an unknown name", () => {
    expect(matchPerson("Бобур", people)).toEqual({ status: "none" });
  });
});

describe("normalizeName", () => {
  it("transliterates Uzbek Cyrillic", () => {
    expect(normalizeName("Ғайрат")).toBe("gayrat");
    expect(normalizeName("Shohruh")).toBe("shohruh");
  });
});
