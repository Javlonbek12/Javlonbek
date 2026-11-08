import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { importOrgChart } from "@/modules/org/import";
import { orgTemplateXlsx, parseOrgXlsx, previewOrgImport } from "@/modules/org/excel";
import { getOrgTree } from "@/modules/org/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";

async function sheet(rows: (string | number)[][]) {
  const book = new ExcelJS.Workbook();
  const ws = book.addWorksheet("Оргструктура");
  ws.addRow(["№", "Подчиняется", "Что это", "Название", "Сотрудник", "Подпись"]);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe("org chart from Excel", () => {
  beforeEach(resetDb);

  it("the template reads back as a chart; the preview says who is found in the app", async () => {
    await createTestUser("OWNER", { firstName: "Тестовый руководитель" });
    const { roots, errors } = await parseOrgXlsx(await orgTemplateXlsx());
    expect(errors).toEqual([]);
    expect(roots).toEqual([
      {
        unit: "Тестовый отдел",
        children: [
          {
            person: "Тестовый руководитель",
            title: "Тестовая должность: руководитель",
            label: "Тестовая команда",
            children: [{ person: null, title: "Тестовая должность", children: [] }],
          },
        ],
      },
    ]);
    const { stats, lines } = await previewOrgImport(roots);
    expect(stats).toEqual({ units: 1, places: 2, vacancies: 1, linked: 1 });
    expect(lines[1]).toMatchObject({ depth: 1, note: "в приложении: Тестовый руководитель" });

    await importOrgChart(roots, { replace: true });
    const tree = await getOrgTree();
    expect(tree[0]!.children[0]!.user?.name).toBe("Тестовый руководитель");
  });

  it("names every problem with its row", async () => {
    const { roots, errors } = await parseOrgXlsx(
      await sheet([
        [1, "", "Отдел", "Тест", "", ""],
        [1, "", "Человек", "Тест", "", ""],
        [3, 9, "Человек", "", "", ""],
        [4, 5, "Неизвестно", "Тест", "", ""],
        [5, 4, "Человек", "Тест", "", ""],
      ]),
    );
    expect(roots).toEqual([]);
    expect(errors).toEqual(
      expect.arrayContaining([
        "Строка 3: номер 1 уже есть выше",
        "Строка 4: нет названия отдела или должности",
        "Строка 4: в «Подчиняется» номер 9, а такой строки нет",
        "Строка 5: в «Что это» напишите «Отдел» или «Человек»",
        "Строка 5: подчинение по кругу",
      ]),
    );
    expect((await parseOrgXlsx(Buffer.from("не Excel"))).errors).toEqual([
      "Не удалось прочитать файл: нужен Excel (.xlsx) до 5 МБ.",
    ]);
  });
});
