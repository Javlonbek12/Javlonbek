import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DirtyForm } from "./dirty-form";

describe("DirtyForm", () => {
  it("shows «Сохранить» only after a change, and hides it when the change is undone", () => {
    render(
      <DirtyForm action={async () => {}}>
        <input aria-label="Поле" name="field" defaultValue="Тест" />
      </DirtyForm>,
    );
    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull();
    const field = screen.getByLabelText("Поле");
    fireEvent.input(field, { target: { value: "Тест 2" } });
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeTruthy();
    expect(screen.getByText("Есть несохранённые изменения")).toBeTruthy();
    fireEvent.input(field, { target: { value: "Тест" } });
    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull();
  });
});
