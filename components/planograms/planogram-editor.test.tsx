import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_RULES } from "@/modules/planograms/validate";

import { PlanogramEditor } from "./planogram-editor";

const sku = (id: string, name: string) => ({
  id,
  code: id.toUpperCase(),
  brand: "ESSE",
  name,
  color: "#64748b",
  imageUrl: null,
  price: null,
  isNew: false,
  isMandatory: false,
  defaultBadges: [],
});

const props = {
  planogramId: "pog-1",
  geometry: { header: null, shelves: [{ slots: 3, offset: 0, group: 0 }] },
  initialLayout: {},
  initialHeaderId: null,
  initialShelftalkers: {},
  skus: [sku("s1", "Пачка А (тест)"), sku("s2", "Пачка Б (тест)")],
  posms: [],
  headers: [],
  shelftalkers: [],
  rules: DEFAULT_RULES,
  prices: {},
  previous: null,
  save: vi.fn(async () => ({ ok: true })),
};

describe("«Предложить раскладку ИИ» in the editor", () => {
  it("is not offered without the AI", () => {
    render(<PlanogramEditor {...props} />);
    expect(screen.queryByRole("button", { name: /Предложить раскладку ИИ/ })).toBeNull();
  });

  it("applies the suggestion as one unsaved step that undo takes back", async () => {
    const suggest = vi.fn(async () => ({
      ok: true as const,
      layout: {
        "0:0": { kind: "SKU" as const, skuId: "s1", badges: [] },
        "0:1": { kind: "SKU" as const, skuId: "s1", badges: [] },
        "0:2": { kind: "SKU" as const, skuId: "s2", badges: [] },
      },
      note: "Пачка А слева.",
      unknown: ["X-1"],
      overflow: [],
    }));
    render(<PlanogramEditor {...props} suggest={suggest} />);
    fireEvent.click(screen.getByRole("button", { name: /Предложить раскладку ИИ/ }));
    fireEvent.change(screen.getByLabelText("Опишите, как разложить товар"), {
      target: { value: "А слева" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Предложить" }));
    });

    expect(suggest).toHaveBeenCalledWith("pog-1", "{}", "А слева", "free");
    expect(screen.getByText("Пачка А слева.")).toBeTruthy();
    // How many places changed (they are outlined on the shelves).
    expect(screen.getByText(/Изменено мест: 3/)).toBeTruthy();
    expect(screen.getByText(/Нет в каталоге, пропущено: X-1/)).toBeTruthy();
    expect(screen.getByText("Есть несохранённые изменения")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    expect(screen.queryByText("Есть несохранённые изменения")).toBeNull();
  });

  it("rearranges everything when asked, and names the places left unfilled", async () => {
    const suggest = vi.fn(async () => ({
      ok: true as const,
      layout: { "0:0": { kind: "SKU" as const, skuId: "s2", badges: [] } },
      note: "",
      unknown: [],
      overflow: [],
    }));
    render(<PlanogramEditor {...props} suggest={suggest} />);
    fireEvent.click(screen.getByRole("button", { name: /Предложить раскладку ИИ/ }));
    fireEvent.click(screen.getByLabelText(/Переложить всё/));
    fireEvent.change(screen.getByLabelText("Опишите, как разложить товар"), {
      target: { value: "Б слева" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Предложить" }));
    });
    expect(suggest).toHaveBeenCalledWith("pog-1", "{}", "Б слева", "all");
    expect(screen.getByText(/Не заполнено мест: 2 \(Полка 1: 2\)/)).toBeTruthy();
  });

  it("says what went wrong", async () => {
    const suggest = vi.fn(async () => ({ ok: false as const, error: "ai.errors.limit" }));
    render(<PlanogramEditor {...props} suggest={suggest} />);
    fireEvent.click(screen.getByRole("button", { name: /Предложить раскладку ИИ/ }));
    fireEvent.change(screen.getByLabelText("Опишите, как разложить товар"), {
      target: { value: "что-нибудь" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Предложить" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("Дневной лимит");
  });
});
