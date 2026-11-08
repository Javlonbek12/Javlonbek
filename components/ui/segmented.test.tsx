import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Segmented } from "./segmented";

describe("Segmented", () => {
  it("links each choice and marks the chosen one", () => {
    render(
      <Segmented
        label="Встречи"
        items={[
          { key: "upcoming", label: "Предстоящие", href: "/meetings", active: true },
          { key: "past", label: "Прошедшие", href: "/meetings?show=past", active: false },
        ]}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Встречи" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Предстоящие" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    const past = screen.getByRole("link", { name: "Прошедшие" });
    expect(past).toHaveAttribute("href", "/meetings?show=past");
    expect(past).not.toHaveAttribute("aria-current");
  });
});
