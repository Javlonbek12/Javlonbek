import ExcelJS from "exceljs";

// Small, made-up files in the customer's layouts (all names are fake).

type Row = (string | number | null)[];

// «Daily BW-POG management»: «BW management» (one row per unit) and the «Current stock» block of
// «Warehouse». Tashkent: 10 POSI L (outlets 1–10) and 4 DG C (11–14); Test Town: 6 POSI L
// (21–26, the file names TSM_TOWN_1 for 21–24), 2 MW-24 S (27–28) and a Display MOD with 36 slots
// (= 2 units); one row with an unknown type. In stock: 2 POSI L in Tashkent.
export async function equipmentWorkbook() {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Dashboard").addRow(["Daily BW-POG management (тест)"]);
  const list = book.addWorksheet("BW management");
  list.addRow(["Region", "Smartup ID", "Responsible", "BW discription", "Кол-во слотов", "Type"]);
  const add = (region: string, id: number, tsm: string, type: string, slots: number | null) =>
    list.addRow([region, id, tsm, type, slots, "BWD"]);
  for (let id = 1; id <= 10; id++) add("Tashkent", id, "", "Display L (10*9) POSI", 90);
  for (let id = 11; id <= 14; id++) add("Tashkent", id, "", "Display C (10*6) DG", 60);
  for (let id = 21; id <= 26; id++)
    add("Test Town", id, id <= 24 ? "TSM_TOWN_1" : "", "Display L (10*9) POSI", 90);
  for (let id = 27; id <= 28; id++) add("Test Town", id, "", "Display S (10*2) MW", 20);
  add("Test Town", 29, "", "Display MOD", 36);
  add("Test Town", 30, "", "Fridge", null);

  const warehouse = book.addWorksheet("Warehouse");
  const rows: Row[] = [
    ["Current stock"],
    [null, "POSI", "DG"],
    ["Region", "Display L (10*9) POSI", "Display C (10*6) DG", "Grand Total"],
    ["Tashkent", 2, null, 2],
    ["Test Town", null, null, 0],
    ["TOTAL", 2, 0, 2],
  ];
  warehouse.addRow([]);
  for (const r of rows) warehouse.addRow([null, ...r]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

// The outlet base: Tashkent outlets 1–7 and 11 → TSM_TEST_1, 8–10 and 12–14 → TSM_TEST_2; Test
// Town's outlets are in the base without a TSM.
export async function outletBaseWorkbook() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Sheet1");
  sheet.addRow(["ИД", "Наименование", "Организации", "Responsible TSM"]);
  for (let id = 1; id <= 14; id++)
    sheet.addRow([
      String(id),
      `Точка ${id}`,
      "Tashkent",
      id <= 7 || id === 11 ? "TSM_TEST_1" : "TSM_TEST_2",
    ]);
  for (let id = 21; id <= 30; id++) sheet.addRow([String(id), `Точка ${id}`, "Test Town", null]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

// A POSM list: the «POSM» sheet of the distribution workbook (list + type matrix).
export async function posmWorkbook(options: { posmSheet?: boolean } = {}) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Оборудование").addRow(["(тест)"]);
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
