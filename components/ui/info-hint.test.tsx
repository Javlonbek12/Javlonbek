import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InfoHint } from "./info-hint";

describe("InfoHint", () => {
  it("keeps the description hidden until «?» is pressed", () => {
    render(<InfoHint>Здесь считается, сколько POSM отправить в регион.</InfoHint>);
    const text = screen.getByText(/сколько POSM отправить/);
    expect(text.closest("[hidden]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Что это?" }));
    expect(text.closest("[hidden]")).toBeNull();
    expect(screen.getByRole("button", { name: "Скрыть" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });
});
