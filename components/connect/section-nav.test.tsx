import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";

import { SECTION_ATTRIBUTE } from "./section-anchor";
import { SectionNav } from "./section-nav";

// The page's blocks as the server renders them: each marked with its name for the chip.
const page = (sections: (string | null)[]) =>
  render(
    <LocaleProvider locale="ru">
      <SectionNav />
      {sections.map((name, i) => (
        <div key={i} {...(name === null ? {} : { [SECTION_ATTRIBUTE]: name })}>
          блок {i + 1}
        </div>
      ))}
    </LocaleProvider>,
  );

describe("«Аналитика Connect»: the list of the page's sections", () => {
  it("a chip for each marked block, in the page's order, leading to it", () => {
    const { container } = page(["Требует внимания", null, "Маршруты и дисциплина", "Market Visit"]);
    const nav = screen.getByRole("navigation", { name: "Разделы страницы" });
    const links = [...nav.querySelectorAll("a")];
    expect(links.map((a) => a.textContent)).toEqual([
      "Требует внимания",
      "Маршруты и дисциплина",
      "Market Visit",
    ]);
    // Each chip leads to its block; the block that belongs to another section has no chip.
    for (const link of links) {
      const target = container.querySelector(link.getAttribute("href")!);
      expect(target?.getAttribute(SECTION_ATTRIBUTE)).toBe(link.textContent);
    }
    expect(screen.getByRole("button", { name: "К списку разделов" })).toBeTruthy();
  });

  it("keeps a block's own id (the link to «Восстановление наличия» is one)", () => {
    const { container } = render(
      <LocaleProvider locale="ru">
        <SectionNav />
        <div {...{ [SECTION_ATTRIBUTE]: "А" }} />
        <div id="recovery" {...{ [SECTION_ATTRIBUTE]: "Б" }} />
        <div {...{ [SECTION_ATTRIBUTE]: "В" }} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("link", { name: "Б" }).getAttribute("href")).toBe("#recovery");
    expect(container.querySelectorAll("#recovery")).toHaveLength(1);
  });

  it("is not shown for a page of one or two blocks", () => {
    page(["Визиты", "Market Visit"]);
    expect(screen.queryByRole("navigation", { name: "Разделы страницы" })).toBeNull();
    expect(screen.queryByRole("button", { name: "К списку разделов" })).toBeNull();
  });
});
