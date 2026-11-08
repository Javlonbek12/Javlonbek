import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutoSubmitForm } from "./auto-submit-form";

// next/form needs the app router; a plain form does here (its own props left off).
vi.mock("next/form", () => ({
  default: (props: React.ComponentProps<"form"> & { replace?: boolean; scroll?: boolean }) => {
    const rest = { ...props };
    delete rest.replace;
    delete rest.scroll;
    return <form {...rest} />;
  },
}));

describe("AutoSubmitForm", () => {
  let submit: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    submit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    submit.mockRestore();
  });

  function setUp() {
    render(
      <AutoSubmitForm action="/planograms">
        <input name="q" aria-label="Название" />
        <select name="equipment" aria-label="Оборудование" defaultValue="">
          <option value="">Всё</option>
          <option value="a">Дисплей</option>
        </select>
      </AutoSubmitForm>,
    );
  }

  it("applies typing after a pause, once", () => {
    setUp();
    const input = screen.getByRole("textbox", { name: "Название" });
    fireEvent.change(input, { target: { value: "Disp" } });
    fireEvent.change(input, { target: { value: "Display" } });
    act(() => vi.advanceTimersByTime(300));
    expect(submit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("applies a choice from a list at once", () => {
    setUp();
    fireEvent.change(screen.getByRole("combobox", { name: "Оборудование" }), {
      target: { value: "a" },
    });
    act(() => vi.advanceTimersByTime(0));
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
