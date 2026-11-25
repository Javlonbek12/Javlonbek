import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Section, SourceTags } from "./parts";

describe("whose data a Connect block is counted from", () => {
  it("names the sources under the block's title, in the order given", () => {
    render(
      <Section title="Тестовый блок" hint="Пояснение" sources={["bot", "smartup"]}>
        <p>Содержимое</p>
      </Section>,
    );
    const tags = screen.getByLabelText("Источник данных");
    expect(within(tags).getByText("Connect-бот")).toBeInTheDocument();
    expect(within(tags).getByText("Smart Up")).toBeInTheDocument();
    expect(tags.textContent).toBe("Connect-ботSmart Up");
    // The title, then the sources, then the hint.
    const card = screen.getByText("Тестовый блок").closest("[data-connect-section]")!;
    expect(card.textContent).toBe("Тестовый блокConnect-ботSmart UpПояснениеСодержимое");
  });

  it("says nothing when the block has no source to name", () => {
    render(
      <Section title="Тестовый блок">
        <p>Содержимое</p>
      </Section>,
    );
    expect(screen.queryByLabelText("Источник данных")).toBeNull();
  });

  it("stands next to a column or a table of its own too", () => {
    render(<SourceTags sources={["smartup"]} />);
    expect(screen.getByLabelText("Источник данных").textContent).toBe("Smart Up");
  });
});
