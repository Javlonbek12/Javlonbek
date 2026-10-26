import ExcelJS from "exceljs";

// A small, made-up distribution workbook in the customer's layout: «Оборудование» (installed and
// warehouse blocks), «TSM_Оборудование» (pivot block) and «POSM» (list + type matrix).
export async function distributionWorkbook(
  options: { includeStock?: "Да" | "Нет"; posmSheet?: boolean } = {},
) {
  const book = new ExcelJS.Workbook();
  const eq = book.addWorksheet("Оборудование");
  const groups = [
    "Region",
    "POSI",
    "POSI",
    "POSI",
    "POSI",
    "DG",
    "DG",
    "DG",
    "MW25",
    "MW25",
    "MW24",
    "MW24",
    "MW24",
    "TOTAL",
  ];
  const sizes = ["Region", "XL", "L", "M", "C", "L", "M", "C", "L", "M", "L", "M", "S", "TOTAL"];
  const block = (title: string, rows: (string | number | null)[][]) => {
    eq.addRow([null, title]);
    eq.addRow([null, ...groups]);
    eq.addRow([null, ...sizes]);
    for (const r of rows) eq.addRow([null, ...r]);
    eq.addRow([null, "TOTAL"]);
    eq.addRow([]);
  };
  // Test City: 10 POSI L, 4 DG C; Test Town: 6 POSI L, 2 MW-24 S.
  block("УСТАНОВЛЕННОЕ ОБОРУДОВАНИЕ ПО РЕГИОНАМ", [
    ["Tashkent", 0, 10, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 14],
    ["Test Town", 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 8],
  ]);
  block("CURRENT STOCK — ОБОРУДОВАНИЕ НА СКЛАДАХ", [
    ["Tashkent", 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
    ["Test Town", null, null, null, null, null, null, null, null, null, null, null, null, 0],
  ]);
  eq.addRow([
    null,
    "Учитывать оборудование на складе в распределении POSM?",
    null,
    null,
    options.includeStock ?? "Да",
  ]);
  block("БАЗА ДЛЯ РАСПРЕДЕЛЕНИЯ POSM (расчёт)", [
    ["Tashkent", 0, 12, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 16],
  ]);

  const tsm = book.addWorksheet("TSM_Оборудование");
  tsm.addRow([null, "ТАШКЕНТ: ОБОРУДОВАНИЕ ПО TSM"]);
  tsm.addRow([null, "TSM", "L (10*9) POSI", "C (10*6) DG", "Grand Total"]);
  tsm.addRow([null, "TSM_TEST_1", 7, 1, 8]);
  tsm.addRow([null, "TSM_TEST_2", 3, 3, 6]);
  tsm.addRow([null, "TOTAL", 10, 4, 14]);

  if (options.posmSheet !== false) {
    const posm = book.addWorksheet("POSM");
    posm.addRow(["СПИСОК POSM"]);
    const head = [
      "#",
      "POSM",
      "Категория",
      "Тип оборудования (из заказа)",
      "Размер H×W, мм",
      "Материал",
      "Оборуд. при заказе, шт",
      "На складе, шт",
      "Заказано, шт",
      "Доступно, шт",
      "Оставить на центр. складе, %",
      "К отправке в регионы, шт",
      "База распределения",
      "Норма на 1 ед. (шт)",
      "Запас к норме, %",
    ];
    posm.addRow([
      ...head,
      "POSI",
      "POSI",
      "POSI",
      "POSI",
      "DG",
      "DG",
      "DG",
      "MW25",
      "MW25",
      "MW24",
      "MW24",
      "MW24",
    ]);
    posm.addRow([...head, "XL", "L", "M", "C", "L", "M", "C", "L", "M", "L", "M", "S"]);
    const types = (marks: number[]) =>
      Array.from({ length: 12 }, (_, i) => (marks.includes(i) ? 1 : null));
    // Shelftalker (test) for POSI L only, norm 1 + 10 %.
    posm.addRow([
      1,
      "Shelftalker (тест)",
      "Shelftalker",
      "Display-L POSI",
      "28×640",
      "PET",
      18,
      0,
      19,
      { formula: "H4+I4" },
      0,
      null,
      "Шт",
      1,
      0.1,
      ...types([1]),
    ]);
    // Divider (test) for every type, 10 % kept centrally.
    posm.addRow([
      2,
      "Divider (тест)",
      "Divider",
      "POSM",
      "105×120",
      "PET",
      24,
      5,
      20,
      null,
      0.1,
      null,
      "Шт",
      null,
      null,
      ...types([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    ]);
    // Price tag 21000 (test), by slots.
    posm.addRow([
      3,
      "Ценник 21000 (тест)",
      "Ценник",
      "POSM",
      "28×60",
      "PET",
      100,
      0,
      300,
      null,
      0,
      null,
      "Слоты",
      null,
      null,
      ...types([1, 6]),
    ]);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
