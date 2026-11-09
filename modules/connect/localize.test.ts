import { describe, expect, it } from "vitest";

import { withExportLocale } from "@/lib/i18n/server";

import { localizeData } from "./localize";

describe("localizeData", () => {
  it("translates answers in English and Korean, and leaves Russian as it is", () => {
    expect(localizeData("Да", "en")).toBe("Yes");
    expect(localizeData(" Да ", "ko")).toBe("예");
    expect(localizeData("Нет", "ko")).toBe("아니요");
    expect(localizeData("Нет контракта KT&G", "en")).toBe("No KT&G contract");
    expect(localizeData("Выше рекомендованной", "ko")).toBe("권장가보다 높음");
    expect(localizeData("Да", "ru")).toBe("Да");
  });

  it("translates delivery statuses and Market Visit questions", () => {
    expect(localizeData("Доставлено — ожидает подтверждения точки", "en")).toBe(
      "Delivered — awaiting store confirmation",
    );
    expect(localizeData("Точка не ответила", "ko")).toBe("매장 무응답");
    expect(localizeData("Торговая точка открыта?", "en")).toBe("Is the outlet open?");
    expect(localizeData("Торговая точка открыта?", "ko")).toBe("매장이 영업 중입니까?");
    // A problem with its answer, as the TSM's list writes it.
    expect(
      localizeData(
        "Цена на полке на продукцию KT&G соответствует рекомендованной цене? — Выше рекомендованной",
        "en",
      ),
    ).toBe(
      "Does the shelf price of KT&G products match the recommended price? — Above recommended",
    );
  });

  it("replaces the Russian words in equipment names, a list of two types too", () => {
    expect(localizeData("M (9*6) POSI (Корейский белый)", "en")).toBe(
      "M (9*6) POSI (Korean white)",
    );
    expect(
      localizeData("M (9*6) POSI (Корейский белый), S (3*4) (Казахский металлический)", "ko"),
    ).toBe("M (9*6) POSI (한국산 흰색), S (3*4) (카자흐산 금속)");
    expect(localizeData("Тестовое оборудование, No BWD", "en")).toBe(
      "Тестовое оборудование, No BWD",
    );
  });

  it("takes the English part of Smart Up comments, Korean for the known ones", () => {
    const closed =
      "Торговая точка была закрыта на момент визита ( The outlet was closed at the visit time )";
    expect(localizeData(closed, "en")).toBe("The outlet was closed at the visit time");
    expect(localizeData(closed, "ko")).toBe("방문 시 매장 휴무");
    expect(localizeData("Тестовый комментарий ( Test comment )", "ko")).toBe("Test comment");
    expect(localizeData(`${closed}, Отказ от сотрудничества ( Refusal to cooperate )`, "ko")).toBe(
      "방문 시 매장 휴무, 협력 거부",
    );
    expect(localizeData("Аудиторский визит", "ko")).toBe("감사 방문");
    expect(localizeData(closed, "ru")).toBe(closed);
  });

  it("leaves unknown values, stores and products untouched", () => {
    expect(localizeData("Тестовая точка 900001", "en")).toBe("Тестовая точка 900001");
    expect(localizeData("Тестовый вопрос 1", "ko")).toBe("Тестовый вопрос 1");
    expect(localizeData("SKU-TEST-001", "ko")).toBe("SKU-TEST-001");
    expect(localizeData(null, "en")).toBeNull();
    expect(localizeData("", "ko")).toBe("");
  });

  it("follows the language of the current work", () => {
    expect(localizeData("Да")).toBe("Да");
    expect(withExportLocale("ko", () => localizeData("Да"))).toBe("예");
    expect(withExportLocale("en", () => localizeData("Частично"))).toBe("Partly");
  });
});
