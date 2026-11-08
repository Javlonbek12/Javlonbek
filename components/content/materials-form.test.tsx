import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MaterialsForm } from "./materials-form";

const noop = async () => {};

describe("MaterialsForm", () => {
  it("sends the typed text along, and asks first when a part of the post is missing", async () => {
    const sent: FormData[] = [];
    render(
      <MaterialsForm
        postId="p1"
        textRu={null}
        textUz={null}
        files={{ RU: 1, UZ: 0 }}
        save={noop}
        submit={async (form) => {
          sent.push(form);
        }}
        canSubmit
      />,
    );
    fireEvent.change(screen.getByLabelText("Текст на русском"), {
      target: { value: "Тестовый текст" },
    });
    // UZ text and UZ files are missing: the press asks before sending.
    fireEvent.click(screen.getByRole("button", { name: "Сохранить и отправить на проверку" }));
    expect(screen.getByRole("alert").textContent).toContain("текст UZ, файлы UZ");
    expect(sent).toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Да, отправить" }));
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.get("textRu")).toBe("Тестовый текст");
    expect(sent[0]!.get("postId")).toBe("p1");
  });

  it("sends at once when the post is complete; «Сохранить тексты» waits for a change", async () => {
    const sent: FormData[] = [];
    render(
      <MaterialsForm
        postId="p1"
        textRu="RU"
        textUz="UZ"
        files={{ RU: 1, UZ: 1 }}
        save={noop}
        submit={async (form) => {
          sent.push(form);
        }}
        canSubmit
      />,
    );
    expect(screen.getByRole("button", { name: "Сохранить тексты" })).toHaveProperty(
      "disabled",
      true,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Сохранить и отправить на проверку" }));
    });
    expect(sent).toHaveLength(1);
  });
});
