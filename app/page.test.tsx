import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("HomePage", () => {
  it("shows the Assistant heading", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Assistant" })).toBeInTheDocument();
  });
});
