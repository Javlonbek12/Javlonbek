import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it("blocks a submit button while its form's action runs, so a double press sends once", async () => {
    let calls = 0;
    let finish: () => void = () => {};
    const action = async () => {
      calls++;
      await new Promise<void>((resolve) => (finish = resolve));
    };
    render(
      <form action={action}>
        <Button type="submit">Создать приглашение</Button>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Создать приглашение" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(calls).toBe(1);
    await act(async () => finish());
    expect(button).toHaveProperty("disabled", false);
  });

  it("leaves other buttons alone", () => {
    render(
      <form action={async () => {}}>
        <Button type="button">Отмена</Button>
      </form>,
    );
    expect(screen.getByRole("button", { name: "Отмена" })).toHaveProperty("disabled", false);
  });
});
