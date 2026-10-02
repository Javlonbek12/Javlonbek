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
