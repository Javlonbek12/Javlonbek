import ExcelJS from "exceljs";

import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { displayName } from "@/modules/core/users/display-name";

import { importSchema, type ImportNode } from "./import";
import { matchUser } from "./match";

// The owner loads the org chart from Excel: one row per place, «Подчиняется» names the row above
// it by its number. The file is checked and shown as it will be before anything is saved.

const COLUMNS = [
  { header: "№", width: 6 },
  { header: "Подчиняется (№)", width: 16 },
  { header: "Что это: Отдел или Человек", width: 26 },
  { header: "Название отдела или должность", width: 36 },
  { header: "Сотрудник (имя и фамилия; пусто — вакансия)", width: 36 },
  { header: "Подпись сверху (команда, которой руководит)", width: 36 },
];
export const MAX_ROWS = 500;

export async function orgTemplateXlsx(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const ws = book.addWorksheet("Оргструктура");
  ws.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  // An example to replace: a unit, its head leading a team, and a vacancy in it.
  ws.addRow([1, "", "Отдел", "Тестовый отдел", "", ""]);
  ws.addRow([
    2,
    1,
    "Человек",
    "Тестовая должность: руководитель",
    "Тестовый руководитель",
    "Тестовая команда",
  ]);
  ws.addRow([3, 2, "Человек", "Тестовая должность", "", ""]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

type Row = {
  line: number;
  n: string;
  parent: string;
  unit: boolean;
  title: string;
  person: string;
  label: string;
};

const cell = (row: ExcelJS.Row, i: number) => row.getCell(i).text.trim();

// Rows → the nested chart importOrgChart takes, or the problems, each with its row number.
export async function parseOrgXlsx(
  buffer: Buffer,
): Promise<{ roots: ImportNode[]; errors: string[] }> {
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { roots: [], errors: [t("team.org.import.errors.file")] };
  }
  const ws = book.worksheets[0];
  if (!ws) return { roots: [], errors: [t("team.org.import.errors.empty")] };
  const rows: Row[] = [];
  const errors: string[] = [];
  const problem = (line: number, key: string, params: Record<string, string> = {}) =>
    errors.push(
      t("team.org.import.rowError", {
        row: line,
        error: t(`team.org.import.errors.${key}` as "team.org.import.errors.kind", params),
      }),
    );
  ws.eachRow((row, line) => {
    if (line === 1) return;
    const values = [1, 2, 3, 4, 5, 6].map((i) => cell(row, i));
    if (values.every((v) => !v)) return;
    const kind = values[2]!.toLowerCase();
    rows.push({
      line,
      n: values[0]!,
      parent: values[1]!,
      unit: /^(о|u|d)/.test(kind),
      title: values[3]!,
      person: values[4]!,
      label: values[5]!,
    });
    if (!/^(о|ч|u|d|p)/.test(kind)) problem(line, "kind");
  });
  if (rows.length === 0) return { roots: [], errors: [t("team.org.import.errors.empty")] };
  if (rows.length > MAX_ROWS) return { roots: [], errors: [t("team.org.import.errors.tooMany")] };

  const byNumber = new Map<string, Row>();
  for (const row of rows) {
    if (!row.n) problem(row.line, "number");
    else if (byNumber.has(row.n)) problem(row.line, "duplicate", { n: row.n });
    else byNumber.set(row.n, row);
    if (!row.title) problem(row.line, "title");
  }
  for (const row of rows) {
    if (row.parent && !byNumber.has(row.parent)) problem(row.line, "parent", { n: row.parent });
    // Walking up must end at the top, not come back to the row.
    const seen = new Set<string>();
    for (let up = row.parent; up && byNumber.has(up); up = byNumber.get(up)!.parent) {
      if (up === row.n || seen.has(up)) {
        problem(row.line, "cycle");
        break;
      }
      seen.add(up);
    }
  }
  if (errors.length) return { roots: [], errors };

  const nodes = new Map<string, ImportNode>();
  const roots: ImportNode[] = [];
  for (const row of rows)
    nodes.set(
      row.n,
      row.unit
        ? { unit: row.title, children: [] }
        : {
            person: row.person || null,
            title: row.title,
            ...(row.label ? { label: row.label } : {}),
            children: [],
          },
    );
  for (const row of rows) {
    const node = nodes.get(row.n)!;
    if (row.parent) nodes.get(row.parent)!.children!.push(node);
    else roots.push(node);
  }
  const parsed = importSchema.safeParse(roots);
  return parsed.success
    ? { roots: parsed.data, errors: [] }
    : { roots: [], errors: [t("team.org.import.errors.file")] };
}

export type PreviewLine = { depth: number; text: string; note: string | null };

// What will be created: one line per place, with whom each name will be linked to in the app.
export async function previewOrgImport(roots: ImportNode[]) {
  const users = await db.user.findMany({
    where: { deactivatedAt: null },
    select: { id: true, firstName: true, lastName: true },
  });
  const lines: PreviewLine[] = [];
  const stats = { units: 0, places: 0, vacancies: 0, linked: 0 };
  const linked = new Set<string>();
  const walk = (nodes: ImportNode[], depth: number) => {
    for (const node of nodes) {
      if (node.unit) {
        stats.units += 1;
        lines.push({ depth, text: node.unit, note: null });
      } else {
        stats.places += 1;
        const userId = node.person ? matchUser(node.person, users) : null;
        const user = userId && !linked.has(userId) ? users.find((u) => u.id === userId) : null;
        if (user) {
          linked.add(user.id);
          stats.linked += 1;
        }
        if (!node.person) stats.vacancies += 1;
        lines.push({
          depth,
          text: `${node.person || t("team.org.vacancy")} — ${node.title}`,
          note: user
            ? t("team.org.import.inApp", { name: displayName(user) })
            : node.person
              ? t("team.org.notInApp")
              : null,
        });
      }
      walk(node.children ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  return { lines, stats };
}
