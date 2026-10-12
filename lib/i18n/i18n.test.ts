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
