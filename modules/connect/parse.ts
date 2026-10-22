import ExcelJS from "exceljs";

import type { ConnectKind } from "@/lib/generated/prisma/enums";

// Reads the Connect bot's Excel exports. Each export is one sheet with a header row; the kind is
// recognised by its columns: stock checks (OOS), express orders, ISM payment requests, market visits.

export type Cell = string | number | null;

// Statuses of a product in a stock check other than "in stock".
export const OOS_STATUSES = ["OUT", "LOW", "NOT_BOUGHT"] as const;
export type OosStatus = (typeof OOS_STATUSES)[number];
const OOS_STATUS: Record<string, OosStatus> = {
  "Нет в наличии": "OUT",
  Недостаточно: "LOW",
  "Не было закупа": "NOT_BOUGHT",
};

type Base = {
  id: string;
  storeCode: string;
  storeName: string;
  city: string | null;
  channel: string | null;
  // Local date and time as YYYY-MM-DDTHH:mm, its day and month.
  at: string;
  day: string;
  month: string;
  person: string | null;
};

export type OosRecord = Base & {
  missing: number;
  low: number;
  orderCreated: boolean;
  orderNo: string | null;
  delivery: string | null;
  // Only the products that were not fully in stock.
  skus: Record<string, OosStatus>;
};

export type OrderRecord = Base & {
  status: string | null;
  express: boolean;
  payment: string | null;
  sourceCheck: string | null;
  storeAnswer: string | null;
  storeAnswerAt: string | null;
  agent: string | null;
  agentAnswer: string | null;
  deliveredAt: string | null;
  outcome: string | null;
  daysToDeliver: number | null;
  positions: number;
  adjusted: boolean;
  packs: number;
  sum: number;
  skus: Record<string, number>;
};

export type PaymentRecord = Base & {
  checklist: number | null;
  roi: "positive" | "negative" | null;
  tsmDecision: string | null;
  contractSum: number;
  toPay: number | null;
  bdmDecision: string | null;
  bdm: string | null;
  bdmAt: string | null;
  bumDecision: string | null;
  bum: string | null;
  bumAt: string | null;
  paid: string | null;
  // The checklist questions answered "yes" (true) or "no" (false).
  checks: { q: string; ok: boolean }[];
};

export type VisitRecord = Base & {
  template: string | null;
  status: string | null;
  percent: number | null;
  creator: string | null;
  doneAt: string | null;
  taskStatus: string | null;
  problems: number;
  problemList: string[];
  photos: number;
  answers: { q: string; a: string }[];
};

export type ParsedRow =
  | { kind: "OOS"; record: OosRecord }
  | { kind: "ORDER"; record: OrderRecord }
  | { kind: "PAYMENT"; record: PaymentRecord }
  | { kind: "VISIT"; record: VisitRecord };

export type RecordOf<K extends ConnectKind> = Extract<ParsedRow, { kind: K }>["record"];

// The text of a cell: rich text, links and formulas become plain values; "—" means empty.
export function cellValue(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 16).replace("T", " ");
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "object") {
    if ("richText" in value) return cellValue(value.richText.map((r) => r.text).join(""));
    if ("text" in value) return cellValue(value.text as ExcelJS.CellValue);
    if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
    return null;
  }
  // Exports sometimes have double spaces inside names ("Junior  Marketing  Assistent").
  const text = String(value).replace(/\s+/g, " ").trim();
  return text === "" || text === "—" ? null : text;
}

// "09.02.2026 21:22", "2026-02-09 21:22" or "09.02.2026" → "2026-02-09T21:22".
export function parseDateTime(value: Cell): string | null {
  if (value === null) return null;
  const text = String(value).trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(text);
  if (m) {
    const [, d, mo, y, h = "0", mi = "00"] = m;
    return `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}T${h.padStart(2, "0")}:${mi}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(text);
  if (m) {
    const [, y, mo, d, h = "00", mi = "00"] = m;
    return `${y}-${mo}-${d}T${h}:${mi}`;
  }
  return null;
}

const num = (value: Cell) => {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (value: Cell) => (value === null ? null : String(value));
const yes = (value: Cell) => value === "Да";

// Which export a header row belongs to.
export function detectKind(headers: string[]): ConnectKind | null {
  const has = (name: string) => headers.includes(name);
  if (has("Нет в наличии, поз.")) return "OOS";
  if (has("Номер заказа") && has("Тип заказа")) return "ORDER";
  if (has("ID заявки")) return "PAYMENT";
  if (has("Шаблон") && has("Статус проверки")) return "VISIT";
  return null;
}

const ID_COLUMN: Record<ConnectKind, string> = {
  OOS: "ID проверки",
  ORDER: "Номер заказа",
  PAYMENT: "ID заявки",
  VISIT: "ID проверки",
};
const DATE_COLUMN: Record<ConnectKind, string> = {
  OOS: "Дата проверки",
  ORDER: "Дата заказа",
  PAYMENT: "Дата заявки",
  VISIT: "Дата создания",
};

// The columns between two named ones (products in checks and orders, questions in requests).
function between(headers: string[], after: string, before?: string) {
  const start = headers.indexOf(after);
  const end = before ? headers.indexOf(before) : headers.length;
  if (start < 0) return [];
  return headers
    .map((name, index) => ({ name, index }))
    .filter((c) => c.index > start && c.index < (end < 0 ? headers.length : end) && c.name);
}

// One row → a typed record, or null when it has no ID, store or date.
export function parseRow(kind: ConnectKind, headers: string[], cells: Cell[]): ParsedRow | null {
  const get = (name: string): Cell => {
    const index = headers.indexOf(name);
    return index < 0 ? null : (cells[index] ?? null);
  };
  const id = str(get(ID_COLUMN[kind]));
  const at = parseDateTime(get(DATE_COLUMN[kind]));
  const storeCode = str(get("Код точки"));
  if (!id || !at || !storeCode) return null;
  const channel = str(get("Канал"));
  const base: Omit<Base, "person"> = {
    id,
    storeCode,
    storeName: str(get("Магазин")) ?? storeCode,
    city: str(get("Город")),
    channel: channel === "Не указан канал" ? null : channel,
    at,
    day: at.slice(0, 10),
    month: str(get("Месяц")) ?? at.slice(0, 7),
  };
  const at2 = (name: string) => parseDateTime(get(name));

  if (kind === "OOS") {
    const skus: Record<string, OosStatus> = {};
    for (const c of between(headers, "Статус доставки", "Позиции вне колонок, шт.")) {
      const status = OOS_STATUS[String(cells[c.index] ?? "")];
      if (status) skus[c.name] = status;
    }
    return {
      kind,
      record: {
        ...base,
        person: str(get("Проверил")),
        missing: num(get("Нет в наличии, поз.")) ?? 0,
        low: num(get("Недостаточно, поз.")) ?? 0,
        orderCreated: yes(get("Заказ создан")),
        orderNo: str(get("Номер заказа")),
        delivery: str(get("Статус доставки")),
        skus,
      },
    };
  }
  if (kind === "ORDER") {
    const skus: Record<string, number> = {};
    for (const c of between(headers, "Сумма", "Позиции вне колонок, шт.")) {
      const qty = num(cells[c.index] ?? null);
      if (qty) skus[c.name] = qty;
    }
    return {
      kind,
      record: {
        ...base,
        person: str(get("Создал")),
        status: str(get("Статус заказа")),
        express: get("Тип заказа") === "Экспресс",
        payment: str(get("Тип оплаты")),
        sourceCheck: str(get("ID заказа-источника (OOS)")),
        storeAnswer: str(get("Ответ магазина")),
        storeAnswerAt: at2("Дата ответа магазина"),
        agent: str(get("Агент")),
        agentAnswer: str(get("Ответ агента")),
        deliveredAt: at2("Доставлено"),
        outcome: str(get("Итог доставки")),
        daysToDeliver: num(get("Дней до доставки")),
        positions: num(get("Позиций в заказе")) ?? 0,
        adjusted: yes(get("Скорректирован магазином")),
        packs: num(get("Количество всего, пач.")) ?? 0,
        sum: num(get("Сумма")) ?? 0,
        skus,
      },
    };
  }
  if (kind === "PAYMENT") {
    const checks = between(headers, "Дней до оплаты")
      .map((c) => ({ q: c.name, a: cells[c.index] ?? null }))
      .filter((c) => c.a === "Да" || c.a === "Нет")
      .map((c) => ({ q: c.q, ok: c.a === "Да" }));
    const roi = str(get("ROI-статус"));
    return {
      kind,
      record: {
        ...base,
        person: str(get("TSM")),
        checklist: num(get("Выполнение чек-листа, %")),
        roi: roi === "positive" || roi === "negative" ? roi : null,
        tsmDecision: str(get("Статус оплаты (TSM)")),
        contractSum: num(get("Сумма по контракту")) ?? 0,
        toPay: num(get("Сумма к оплате")),
        bdmDecision: str(get("Решение BDM")),
        bdm: str(get("BDM")),
        bdmAt: at2("Дата решения BDM"),
        bumDecision: str(get("Решение BUM")),
        bum: str(get("BUM")),
        bumAt: at2("Дата решения BUM"),
        paid: str(get("Факт оплаты")),
        checks,
      },
    };
  }
  const problemText = str(get("Проблемные вопросы"));
  const photos = ["Фото 1", "Фото 2", "Фото 3", "Фото 4", "Фото 5"].filter((n) => get(n)).length;
  return {
    kind,
    record: {
      ...base,
      person: str(get("Исполнитель")) ?? str(get("Создатель")),
      template: str(get("Шаблон")),
      status: str(get("Статус проверки")),
      percent: num(get("Выполнение, %")),
      creator: str(get("Создатель")),
      doneAt: at2("Дата выполнения"),
      taskStatus: str(get("Статус задачи")),
      problems: num(get("Проблемных вопросов")) ?? 0,
      problemList: problemText
        ? problemText
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      photos,
      answers: between(headers, "Шаблон")
        .map((c) => ({ q: c.name, a: str(cells[c.index] ?? null) }))
        .filter((c): c is { q: string; a: string } => c.a !== null),
    },
  };
}

export type ParsedSheet = { kind: ConnectKind; rows: ParsedRow[]; skipped: number };

// All recognised sheets of a workbook; sheets of unknown shape are left out.
export async function parseWorkbook(buffer: Buffer): Promise<ParsedSheet[]> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheets: ParsedSheet[] = [];
  for (const ws of book.worksheets) {
    const headers = (ws.getRow(1).values as ExcelJS.CellValue[])
      .slice(1)
      .map((v) => String(cellValue(v) ?? "").trim());
    const kind = detectKind(headers);
    if (!kind) continue;
    const rows: ParsedRow[] = [];
    let skipped = 0;
    for (let r = 2; r <= ws.rowCount; r++) {
      const values = ws.getRow(r).values as ExcelJS.CellValue[];
      const cells = headers.map((_, i) => cellValue(values[i + 1]));
      if (cells.every((c) => c === null)) continue;
      const row = parseRow(kind, headers, cells);
      if (row) rows.push(row);
      else skipped++;
    }
    sheets.push({ kind, rows, skipped });
  }
  return sheets;
}
