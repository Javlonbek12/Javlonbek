import { describe, expect, it } from "vitest";

import {
  assigneeButtons,
  PEOPLE_PER_PAGE,
  renderCardButtons,
  renderCardText,
  type DraftPayload,
} from "./draft-card";

const people = [
  { id: "u1", firstName: "Азиз", lastName: "Каримов" },
  { id: "u2", firstName: "Азиз", lastName: "Рахимов" },
];
const task = { saidName: null, unresolved: false, candidateIds: [], priority: null, project: null };

describe("confirmation card", () => {
  const payload: DraftPayload = {
    tasks: [
      {
        ...task,
        title: "Подготовить отчёт",
        assigneeId: "u1",
        dueDate: "2026-10-09",
        priority: "URGENT",
      },
      { ...task, title: "Позвонить дистрибьютору", assigneeId: null, dueDate: null },
      {
        ...task,
        title: "Записаться к врачу",
        assigneeId: null,
        dueDate: null,
        personal: true,
      },
    ],
  };

  it("lists every task with assignee, due date and priority", () => {
    const text = renderCardText(payload, people);
    expect(text).toContain("1. Подготовить отчёт");
    expect(text).toContain("👤 Азиз Каримов · 📅 9 окт. · ⚡ Срочно");
    // One's own task is a team task on oneself unless asked for as a personal one.
    expect(text).toContain("2. Позвонить дистрибьютору\n   👤 я · 📅 без срока");
    expect(text).toContain("3. Записаться к врачу\n   👤 я (личная) · 📅 без срока");
  });

  it("offers save, cancel and one edit button per task", () => {
    const buttons = renderCardButtons("D1", payload, people);
    expect(buttons[0].map((b) => b.data)).toEqual(["d:D1:save", "d:D1:cancel"]);
    expect(buttons[1].map((b) => b.data)).toEqual(["d:D1:e:0", "d:D1:e:1", "d:D1:e:2"]);
  });

  it("asks who is meant before saving when a name is ambiguous", () => {
    const unresolved: DraftPayload = {
      tasks: [
        {
          ...task,
          title: "Отчёт",
          assigneeId: null,
          saidName: "Азиз",
          unresolved: true,
          candidateIds: ["u1", "u2"],
          dueDate: null,
        },
      ],
    };
    expect(renderCardText(unresolved, people)).toContain("❓ «Азиз» — кто это?");
    const data = renderCardButtons("D1", unresolved, people)
      .flat()
      .map((b) => b.data);
    expect(data).toEqual([
      "d:D1:av:0:u1",
      "d:D1:av:0:u2",
      "d:D1:av:0:me",
      "d:D1:av:0:mine",
      "d:D1:as:0:0",
    ]);
    // Telegram limits callback data to 64 bytes.
    const longest = renderCardButtons("c".repeat(25), unresolved, [
      { id: "x".repeat(25), firstName: "A", lastName: null },
    ]);
    for (const b of longest.flat()) expect(Buffer.byteLength(b.data)).toBeLessThanOrEqual(64);
  });

  it("offers everyone page by page, not only the first 20", () => {
    const team = Array.from({ length: 25 }, (_, i) => ({
      id: `p${i}`,
      firstName: `Сотрудник ${i + 1}`,
      lastName: null,
    }));
    const pick = (page: number) =>
      assigneeButtons(
        "D1",
        0,
        { ...task, title: "Отчёт", assigneeId: null, dueDate: null },
        team,
        true,
        page,
      )
        .flat()
        .map((b) => b.data);
    expect(pick(0).filter((d) => d.includes(":av:0:p"))).toHaveLength(PEOPLE_PER_PAGE);
    expect(pick(0)).toContain("d:D1:as:0:1");
    // The last page: the 21st..25th person, and the way back.
    expect(pick(2).filter((d) => d.includes(":av:0:p"))).toEqual(
      ["p20", "p21", "p22", "p23", "p24"].map((id) => `d:D1:av:0:${id}`),
    );
    expect(pick(2)).toContain("d:D1:as:0:1");
    expect(pick(2)).not.toContain("d:D1:as:0:3");
  });
});
