import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ProposalState, ProposedRow } from "@/app/(app)/meetings/actions";

import { ActionItems, initialAssignee } from "./action-items";

const row = (overrides: Partial<ProposedRow>): ProposedRow => ({
  title: "Задача",
  assigneeId: null,
  personal: false,
  unresolved: false,
  saidName: null,
  candidateIds: [],
  dueDate: null,
  priority: null,
  project: null,
  ...overrides,
});

describe("tasks from the minutes", () => {
  it("never turns an unmatched name into «Я», keeps «личная» and matched people", () => {
    expect(initialAssignee(row({ unresolved: true, saidName: "Алишер" }))).toBe("");
    expect(initialAssignee(row({ personal: true }))).toBe("mine");
    expect(initialAssignee(row({}))).toBe("me");
    expect(initialAssignee(row({ assigneeId: "u1" }))).toBe("u1");
  });

  it("asks to pick the person for an unmatched name before creating, then clears the proposal", async () => {
    const people = [
      { id: "u1", name: "Азиз Каримов", route: "" },
      { id: "u2", name: "Азиз Рахимов", route: "" },
    ];
    const action = vi.fn(async (state: ProposalState, formData: FormData) => {
      if (formData.get("intent") === "create")
        return { ...state, tasks: null, result: { created: 1, pending: 0, errors: [] } };
      return {
        error: null,
        people,
        self: "",
        tasks: [row({ unresolved: true, saidName: "Азиз", candidateIds: ["u1", "u2"] })],
      };
    });
    render(<ActionItems meetingId="m1" action={action} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Найти задачи/ })));

    const select = screen.getByRole("combobox", { name: "Исполнитель" });
    expect(select).toHaveValue("");
    expect(screen.getByRole("option", { name: "Выберите… (сказано: «Азиз»)" })).toBeInTheDocument();
    const create = screen.getByRole("button", { name: "Создать отмеченные задачи" });
    expect(create).toBeDisabled();

    fireEvent.change(select, { target: { value: "u2" } });
    expect(create).toBeEnabled();
    await act(async () => fireEvent.click(create));
    const sent = action.mock.calls[1][1];
    expect(sent.get("assignee_0")).toBe("u2");
    expect(screen.getByText("Создано задач: 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Создать отмеченные задачи" })).toBeNull();
  });
});
