import { describe, expect, it } from "vitest";

import { t, type TranslationKey } from "./index";

describe("t", () => {
  it("returns the Russian string for a known key", () => {
    expect(t("home.title")).toBe("Assistant");
    expect(t("offline.title")).toBe("Нет подключения к интернету");
  });

  it("falls back to the key itself for an unknown key", () => {
    expect(t("home.missing" as TranslationKey)).toBe("home.missing");
  });

  it("falls back to the key when it points to a group, not a string", () => {
    expect(t("home" as TranslationKey)).toBe("home");
  });
});

describe("t with params", () => {
  it("fills placeholders", () => {
    expect(t("home.greeting", { name: "Тестовый сотрудник 1" })).toBe(
      "Здравствуйте, Тестовый сотрудник 1!",
    );
  });

  it("leaves unknown placeholders as they are", () => {
    expect(t("home.greeting", {})).toBe("Здравствуйте, {name}!");
  });
});

describe("languages", () => {
  const leaves = (node: object, prefix = ""): string[] =>
    Object.entries(node).flatMap(([key, value]) =>
      typeof value === "string" ? [`${prefix}${key}`] : leaves(value, `${prefix}${key}.`),
    );

  it("English has exactly the Russian keys and the same placeholders", async () => {
    const { ru } = await import("./ru");
    const { en } = await import("./en");
    expect(leaves(en).sort()).toEqual(leaves(ru).sort());
    for (const key of leaves(ru) as TranslationKey[]) {
      const holes = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
      expect(holes(t(key, undefined, "en")), key).toEqual(holes(t(key, undefined, "ru")));
    }
  });

  it("uses the language set for the current work", async () => {
    const { withLocale } = await import("./server");
    expect(withLocale("en", () => t("nav.tasks"))).toBe("Tasks");
    expect(await withLocale("en", async () => t("nav.tasks"))).toBe("Tasks");
    expect(t("nav.tasks")).toBe("Задачи");
  });
});

describe("Korean (downloads only)", () => {
  const holes = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
  const at = (node: object, key: string) =>
    key.split(".").reduce<unknown>((n, part) => (n as Record<string, unknown>)?.[part], node);
  const leaves = (node: object, prefix = ""): string[] =>
    Object.entries(node).flatMap(([key, value]) =>
      typeof value === "string" ? [`${prefix}${key}`] : leaves(value, `${prefix}${key}.`),
    );

  it("has every string of en.connect with the same placeholders", async () => {
    const { en } = await import("./en");
    const { ko } = await import("./ko");
    for (const key of leaves(en.connect)) {
      const korean = at(ko.connect, key);
      expect(typeof korean, `connect.${key}`).toBe("string");
      expect(holes(korean as string), `connect.${key}`).toEqual(
        holes(at(en.connect, key) as string),
      );
    }
    expect(ko.app.name).toBeTruthy();
  });

  it("is used inside withExportLocale: English for missing keys, Korean dates and numbers", async () => {
    const { withExportLocale } = await import("./server");
    const { currentLocale, dateFormat, intlLocale } = await import("./index");
    withExportLocale("ko", () => {
      expect(t("connect.title")).toBe("Connect 분석");
      expect(t("connect.packs", { count: 5 })).toBe("5갑");
      // Not in ko.ts: taken from English.
      expect(t("nav.tasks")).toBe("Tasks");
      // Code that asks for an interface language sees English.
      expect(currentLocale()).toBe("en");
      expect(intlLocale()).toBe("ko-KR");
      expect(
        dateFormat({ day: "numeric", month: "short", timeZone: "UTC" }).format(
          new Date("2026-11-09T00:00:00Z"),
        ),
      ).toBe("11월 9일");
    });
    expect(currentLocale()).toBe("ru");
    expect(t("connect.title")).toBe("Аналитика Connect");
  });
});
