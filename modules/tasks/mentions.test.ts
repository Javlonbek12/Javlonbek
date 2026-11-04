import { describe, expect, it } from "vitest";

import { mentionedUserIds } from "./mentions";

const people = [
  { id: "u1", firstName: "Тест", lastName: "Первый", telegramUsername: "tester_one" },
  { id: "u2", firstName: "Тест", lastName: "Второй", telegramUsername: null },
  { id: "u3", firstName: "Пример", lastName: null, telegramUsername: "@sample" },
];

describe("mentions in comments", () => {
  it("finds people by Telegram username, unique first name, or first and last name", () => {
    expect(mentionedUserIds("@tester_one глянь", people)).toEqual(["u1"]);
    expect(mentionedUserIds("@sample, нужно до пятницы", people)).toEqual(["u3"]);
    expect(mentionedUserIds("@Пример и @Тест Второй", people)).toEqual(["u3", "u2"]);
  });

  it("skips an ambiguous first name, e-mails and unknown names", () => {
    expect(mentionedUserIds("@Тест посмотри", people)).toEqual([]);
    expect(mentionedUserIds("пишите на mail@sample.com", people)).toEqual([]);
    expect(mentionedUserIds("@никто", people)).toEqual([]);
  });
});
