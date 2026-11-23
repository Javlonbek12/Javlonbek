import ExcelJS from "exceljs";

import type { ConnectKind } from "@/lib/generated/prisma/enums";

// Reads the Connect bot's and Smart Up's Excel exports. Each export is a sheet with a header row;
// the format is recognised by its columns, whatever the sheet or file is called:
// - the bot's Russian exports: stock checks (OOS), express orders, ISM payment requests, visits;
// - the bot's English exports: Market Visit, OOS check, OOS orders (mapped to the same records);
// - Smart Up: the visit detail (plans and visits) and the totals per TSM (names and zones);
// - the CRM's employee info (positions and who reports to whom) and its sales report.

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
  // The questions of the questionnaire left blank (rows saved before 10.11.2026 don't have it).
  unanswered?: string[];
};

// A Smart Up visit: planned (has a plan date) or not, made (has a fact date) or not. `person` is
// the TSM code, `city` the working zone, `day` the fact date or else the plan date.
export type SuVisitRecord = Base & {
  planned: boolean;
  planDay: string | null;
  factDay: string | null;
  // "HH:mm"
  start: string | null;
  finish: string | null;
  backwall: string | null;
  comment: string | null;
  organization: string | null;
};

// A TSM from Smart Up's totals: `id` and `person` are the code.
export type SuPersonRecord = Base & {
  name: string | null;
  zone: string | null;
  organization: string | null;
};

// A position of the CRM's employee info: `id` is its ИД, `title` the position («BDM 99», a TSM
// code), `user` the person in it, `manager` the title of the position above it.
export type PositionRecord = Base & {
  title: string;
  user: string | null;
  zones: string[];
  roles: string[];
  manager: string | null;
  created: string | null;
  status: string | null;
};

// One SKU sold to a store on a delivery day (the CRM's sales report): `storeCode` is the client ID,
// `city` the organization, `channel` the POS channel. The quantity is in blocks of 10 packs;
// rows of the same store, day and SKU are summed when saved.
export type SaleRecord = Base & {
  sku: string;
  blocks: number;
};

// What happened with a client on a day of Smart Up's «Анализ маршрута»: a planned visit made
// without an order (P) or with one (PD), an unplanned one (U, UD), a planned visit not made (X), a
// planned visit still ahead (O).
export const ROUTE_CODES = ["P", "PD", "U", "UD", "X", "O"] as const;
export type RouteCode = (typeof ROUTE_CODES)[number];

// One client of a working zone for a month: `person` is the zone (a TSM code or a distributor
// rep's, «DR 02»), `storeCode` the client ID, `city` the organization, `day` the last day the
// export covers. `days`: the day of the month ("02") → what happened.
export type RouteRecord = Base & {
  staff: string | null;
  days: Record<string, RouteCode>;
};

// A store of Smart Up's client base: `storeCode` is its ИД, `city` the district («Регион»),
// `person` the responsible TSM's code.
export type ClientRecord = Base & {
  organizations: string[];
  gps: { lat: number; lng: number } | null;
  grade: string | null;
  keyVisual: string | null;
  promotion: string | null;
  contractSum: number | null;
  equipment: string | null;
  bdm: string | null;
  dr: string | null;
  status: string | null;
};

// An ISM checklist (LEGO, Backwall, POG): `person` is who filled it in.
export type IsmCheckRecord = Base & {
  template: string | null;
  percent: number | null;
  roi: "positive" | "negative" | null;
  // What the checklist itself recommends, and what the TSM chose.
  recommended: string | null;
  requestNo: string | null;
  tsmDecision: string | null;
  payPercent: number | null;
  contractSum: number | null;
  toPay: number | null;
  comment: string | null;
  photos: number;
  checks: { q: string; ok: boolean }[];
};

export type ParsedRow =
  | { kind: "OOS"; record: OosRecord }
  | { kind: "ORDER"; record: OrderRecord }
  | { kind: "PAYMENT"; record: PaymentRecord }
  | { kind: "VISIT"; record: VisitRecord }
  | { kind: "SU_VISIT"; record: SuVisitRecord }
  | { kind: "SU_PERSON"; record: SuPersonRecord }
  | { kind: "SU_POSITION"; record: PositionRecord }
  | { kind: "SALE"; record: SaleRecord }
  | { kind: "ROUTE"; record: RouteRecord }
  | { kind: "CLIENT"; record: ClientRecord }
  | { kind: "ISM_CHECK"; record: IsmCheckRecord }
  | { kind: "AUDIT"; record: VisitRecord };

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

// "HH:mm:ss", "1899-12-30 11:52" (a time cell read as a date) or a fraction of a day → "HH:mm".
export function parseTime(value: Cell): string | null {
  if (value === null) return null;
  if (typeof value === "number") {
    if (value < 0 || value >= 1) return null;
    const minutes = Math.round(value * 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const m = /(\d{1,2}):(\d{2})/.exec(String(value));
  return m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : null;
}

// The bot writes people as "TSM_TST_1 - Name"; Smart Up and the analytics use the code before
// " - " ("KA / TSM_TST_2 - Name" → "KA / TSM_TST_2").
export function personCode(person: string | null | undefined): string | null {
  if (!person) return null;
  return person.split(" - ")[0]!.replace(/\s+/g, " ").trim() || null;
}

// A position title or TSM code compared without case, repeated spaces and with «_» as a space: the
// employee info may write «Bdm test» for «BDM TEST» and «BUM_TEST» for «BUM TEST».
export const titleKey = (title: string) =>
  title.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();

// The sheet formats: the bot's Russian exports (one per kind), its English exports and Smart Up's.
export type SheetFormat = ConnectKind | "VISIT_EN" | "OOS_EN" | "ORDER_EN";
type RuKind = "OOS" | "ORDER" | "PAYMENT" | "VISIT";

const KIND_OF: Record<SheetFormat, ConnectKind> = {
  OOS: "OOS",
  ORDER: "ORDER",
  PAYMENT: "PAYMENT",
  VISIT: "VISIT",
  SU_VISIT: "SU_VISIT",
  SU_PERSON: "SU_PERSON",
  SU_POSITION: "SU_POSITION",
  SALE: "SALE",
  ROUTE: "ROUTE",
  CLIENT: "CLIENT",
  ISM_CHECK: "ISM_CHECK",
  AUDIT: "AUDIT",
  VISIT_EN: "VISIT",
  OOS_EN: "OOS",
  ORDER_EN: "ORDER",
};

// Which export a header row belongs to.
export function detectFormat(headers: string[]): SheetFormat | null {
  const has = (name: string) => headers.includes(name);
  if (has("Нет в наличии, поз.")) return "OOS";
  // The orders export of 11.2026 has no «Тип заказа» any more, but names the check it came from.
  if (has("Номер заказа") && (has("Тип заказа") || has("ID проверки-источника"))) return "ORDER";
  if (has("ID чек-листа") && has("Шаблон")) return "ISM_CHECK";
  if (has("ID заявки")) return "PAYMENT";
  if (has("Шаблон") && has("Статус проверки")) return "VISIT";
  if (has("Visit Plan Date") && has("Fact Visit Date") && has("Client ID")) return "SU_VISIT";
  if (has("Name of Employee") && has("Planned Visits")) return "SU_PERSON";
  if (has("Название") && has("Руководитель") && has("Рабочие зоны")) return "SU_POSITION";
  if (has("ИД клиента") && has("ТМЦ") && has("Количество продажи")) return "SALE";
  if (has("ИД") && has("GPS координаты") && has("Responsible TSM")) return "CLIENT";
  if (has("Рабочая зона") && has("ИД клиента") && has("Итог за неделю")) return "ROUTE";
  if (has("ID visit") && has("Шаблон")) return "VISIT_EN";
  if (has("ID Check") && has("OOS issue")) return "OOS_EN";
  if (has("Order Number") && has("Amount (UZS)")) return "ORDER_EN";
  return null;
}

export function detectKind(headers: string[]): ConnectKind | null {
  const format = detectFormat(headers);
  return format ? KIND_OF[format] : null;
}

const ID_COLUMN: Record<RuKind, string> = {
  OOS: "ID проверки",
  ORDER: "Номер заказа",
  PAYMENT: "ID заявки",
  VISIT: "ID проверки",
};
const DATE_COLUMN: Record<RuKind, string> = {
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

// One row → a typed record, or null when it has no ID, store or date (no code for a TSM).
export function parseRow(format: SheetFormat, headers: string[], cells: Cell[]): ParsedRow | null {
  switch (format) {
    case "VISIT_EN":
    case "OOS_EN":
    case "ORDER_EN":
      return parseEnglishRow(format, headers, cells);
    case "SU_VISIT":
      return parseSmartUpVisit(headers, cells);
    case "SU_PERSON":
      return parseSmartUpPerson(headers, cells);
    case "SU_POSITION":
      return parsePosition(headers, cells);
    case "SALE":
      return parseSale(headers, cells);
    case "CLIENT":
      return parseClient(headers, cells);
    case "ISM_CHECK":
      return parseIsmCheck(headers, cells);
    // Read as a whole sheet (its days are columns): see parseRouteSheet.
    case "ROUTE":
    case "AUDIT":
      return null;
    default:
      return parseRussianRow(format, headers, cells);
  }
}

const getter = (headers: string[], cells: Cell[]) => (name: string) => {
  const index = headers.indexOf(name);
  return index < 0 ? null : (cells[index] ?? null);
};

// The question columns after «Шаблон»: the answers given, and the questions left blank.
function questionnaire(headers: string[], cells: Cell[]) {
  const columns = between(headers, "Шаблон").map((c) => ({
    q: c.name,
    a: str(cells[c.index] ?? null),
  }));
  return {
    answers: columns.filter((c): c is { q: string; a: string } => c.a !== null),
    unanswered: columns.filter((c) => c.a === null).map((c) => c.q),
  };
}

const splitList = (text: string | null, separator = ";") =>
  text
    ? text
        .split(separator)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

const MONTH = /^\d{4}-\d{2}$/;

// The bot's English exports: Market Visit, OOS check and OOS orders. The store is the Client ID,
// the region goes where the Russian exports have the city; fields they lack are empty.
function parseEnglishRow(
  format: "VISIT_EN" | "OOS_EN" | "ORDER_EN",
  headers: string[],
  cells: Cell[],
): ParsedRow | null {
  const get = getter(headers, cells);
  const columns = {
    VISIT_EN: ["ID visit", "Date of start"],
    OOS_EN: ["ID Check", "Date of check"],
    ORDER_EN: ["Order Number", "Date of creation"],
  } as const;
  const [idColumn, dateColumn] = columns[format];
  const id = str(get(idColumn));
  const at = parseDateTime(get(dateColumn));
  const storeCode = str(get("Client ID"));
  if (!id || !at || !storeCode) return null;
  const month = str(get("Month"));
  const base: Omit<Base, "person"> = {
    id,
    storeCode,
    storeName: str(get("Client")) ?? storeCode,
    city: str(get("Region")),
    channel: null,
    at,
    day: at.slice(0, 10),
    month: month && MONTH.test(month) ? month : at.slice(0, 7),
  };

  if (format === "OOS_EN") {
    const skus: Record<string, OosStatus> = {};
    for (const c of between(headers, "Delivery status")) {
      const status = OOS_STATUS[String(cells[c.index] ?? "")];
      if (status) skus[c.name] = status;
    }
    return {
      kind: "OOS",
      record: {
        ...base,
        person: str(get("Employee who completed the OOS")),
        missing: num(get("OOS issue")) ?? 0,
        low: num(get("Not enough issue")) ?? 0,
        orderCreated: yes(get("Order Created")),
        orderNo: str(get("Created Order Number")),
        delivery: str(get("Delivery status")),
        skus,
      },
    };
  }
  if (format === "ORDER_EN") {
    const skus: Record<string, number> = {};
    for (const c of between(headers, "Amount (UZS)")) {
      const qty = num(cells[c.index] ?? null);
      if (qty) skus[c.name] = qty;
    }
    return {
      kind: "ORDER",
      record: {
        ...base,
        person: str(get("Created by")),
        // The Russian export's «Статус заказа» is where the delivery stands; here that is
        // «Delivery Status» («Order Status» only says it was sent).
        status: str(get("Delivery Status")) ?? str(get("Order Status")),
        express: false,
        payment: null,
        sourceCheck: str(get("ID check base")),
        storeAnswer: null,
        storeAnswerAt: null,
        agent: null,
        agentAnswer: null,
        deliveredAt: null,
        outcome: null,
        daysToDeliver: null,
        positions: num(get("Order assortment count")) ?? 0,
        adjusted: false,
        packs: num(get("Total order (packs)")) ?? 0,
        sum: num(get("Amount (UZS)")) ?? 0,
        skus,
      },
    };
  }
  const photos = ["Фото 1", "Фото 2", "Фото 3", "Фото 4", "Фото 5"].filter((n) => get(n)).length;
  return {
    kind: "VISIT",
    record: {
      ...base,
      person:
        str(get("Employee who completed the questionnaire")) ??
        str(get("Employee who received task")),
      template: str(get("Шаблон")),
      status: str(get("Status")),
      percent: num(get("Completion Rate of questions")),
      creator: str(get("Employee who received task")),
      doneAt: parseDateTime(get("Date of completion")),
      taskStatus: str(get("Assigned task status")),
      problems: num(get("Problematic Answers")) ?? 0,
      problemList: splitList(str(get("Frequent Problematic Questions"))),
      photos,
      ...questionnaire(headers, cells),
    },
  };
}

// Smart Up's visit detail: a planned visit has a plan date; a made one a fact date, a visit ID
// and its times. A plan not made yet gets the ID plan|<employee>|<client>|<plan day>.
function parseSmartUpVisit(headers: string[], cells: Cell[]): ParsedRow | null {
  const get = getter(headers, cells);
  const storeCode = str(get("Client ID"));
  const person = personCode(str(get("Employee")));
  const planDay = parseDateTime(get("Visit Plan Date"))?.slice(0, 10) ?? null;
  const factDay = parseDateTime(get("Fact Visit Date"))?.slice(0, 10) ?? null;
  const day = factDay ?? planDay;
  if (!storeCode || !person || !day) return null;
  const start = factDay ? parseTime(get("Start of visit time")) : null;
  return {
    kind: "SU_VISIT",
    record: {
      id: str(get("Visit ID")) ?? `plan|${person}|${storeCode}|${planDay}`,
      storeCode,
      storeName: str(get("Client")) ?? storeCode,
      city: str(get("Working Zone")),
      channel: null,
      at: `${day}T${start ?? "00:00"}`,
      day,
      month: day.slice(0, 7),
      person,
      planned: planDay !== null,
      planDay,
      factDay,
      start,
      finish: factDay ? parseTime(get("Finish the visit time")) : null,
      backwall: str(get("Installed Backwall type")),
      comment: str(get("Visit Comment")),
      organization: str(get("Organization")),
    },
  };
}

// Smart Up's totals: only the TSM's name, zone and organization are kept (the numbers are
// counted again from the detail). The «Итого» row is not a person.
function parseSmartUpPerson(headers: string[], cells: Cell[]): ParsedRow | null {
  const get = getter(headers, cells);
  const code = personCode(str(get("Employee")));
  if (!code || /^(итого|total)$/i.test(code)) return null;
  return {
    kind: "SU_PERSON",
    record: {
      id: code,
      storeCode: "",
      storeName: "",
      city: null,
      channel: null,
      at: "",
      day: "",
      month: "",
      person: code,
      name: str(get("Name of Employee")),
      zone: str(get("Working Zone")),
      organization: str(get("Organization")),
    },
  };
}

// The CRM's employee info: one row per position. A row without a title is not a position.
function parsePosition(headers: string[], cells: Cell[]): ParsedRow | null {
  const get = getter(headers, cells);
  const title = str(get("Название"));
  if (!title) return null;
  return {
    kind: "SU_POSITION",
    record: {
      id: str(get("ИД")) ?? `title|${title}`,
      storeCode: "",
      storeName: "",
      city: null,
      channel: null,
      at: "",
      day: "",
      month: "",
      person: null,
      title,
      user: str(get("Пользователь")),
      zones: splitList(str(get("Рабочие зоны")), ","),
      roles: splitList(str(get("Роли")), ","),
      manager: str(get("Руководитель")),
      created: parseDateTime(get("Дата создания")),
      status: str(get("Статус")),
    },
  };
}

// The CRM's sales report: the store (client ID), the delivery day, the SKU and the blocks sold.
// The ID is the store, the day and the SKU (rows repeating it are summed when saved).
function parseSale(headers: string[], cells: Cell[]): ParsedRow | null {
  const get = getter(headers, cells);
  const storeCode = str(get("ИД клиента"));
  const day = parseDateTime(get("Дата доставки"))?.slice(0, 10) ?? null;
  const sku = str(get("ТМЦ"));
  const blocks = num(get("Количество продажи"));
  if (!storeCode || !day || !sku || blocks === null) return null;
  // «ХЮ:(TSM;DR) Основной канал / POS channel»: the prefix may change.
  const channel = headers.find((h) => /channel/i.test(h));
  return {
    kind: "SALE",
    record: {
      id: `${storeCode}|${day}|${skuKey(sku)}`,
      storeCode,
      storeName: str(get("Клиент")) ?? storeCode,
      city: str(get("Организация")),
      channel: channel ? str(get(channel)) : null,
      at: `${day}T00:00`,
      day,
      month: day.slice(0, 7),
      person: null,
      sku,
      blocks,
    },
  };
}

// A product name compared without case and repeated spaces («Esse Change 1» = «ESSE  Change 1»):
// the sales report and the bot's order columns write some names differently.
export const skuKey = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();

const PHOTO_COLUMNS = ["Фото 1", "Фото 2", "Фото 3", "Фото 4", "Фото 5"];
// The questionnaire a BDM fills in on a visit with (or after) a TSM: «BDM Audit Опросник 11.2026».
const AUDIT_TEMPLATE = /audit|аудит/i;

// Smart Up's client base. Coordinates are "lat,lng" (sometimes with a third number after them).
function parseClient(headers: string[], cells: Cell[]): ParsedRow | null {
  const get = getter(headers, cells);
  const id = str(get("ИД"));
  const name = str(get("Название"));
  if (!id || !name) return null;
  const [lat, lng] = String(get("GPS координаты") ?? "")
    .split(",")
    .map((part) => Number(part.trim()));
  const onEarth =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat!) <= 90 &&
    Math.abs(lng!) <= 180 &&
    (lat !== 0 || lng !== 0);
  const channel = str(get("(TSM;DR) Основной канал / POS channel"));
  return {
    kind: "CLIENT",
    record: {
      id,
      storeCode: id,
      storeName: name,
      city: str(get("Регион")),
      channel: channel && /не указан|not specified/i.test(channel) ? null : channel,
      at: "",
      day: "",
      month: "",
      person: personCode(str(get("Responsible TSM"))),
      organizations: splitList(str(get("Организации")), ","),
      gps: onEarth ? { lat: lat!, lng: lng! } : null,
      grade: str(get("KT&G Grade NEW")),
      keyVisual: str(get("(TSM) Коммуникация / Key Visual")),
      promotion: str(get("Promotion / промоакция")),
      contractSum: num(get("Сумма контракта / Contract budget")),
      equipment: str(get("Тип оборудования 1 |Backwall / POG")),
      bdm: str(get("BDM KTNG")),
      dr: personCode(str(get("Responsible DR"))),
      status: str(get("Статус")),
    },
  };
}

// The bot's ISM checklists (LEGO, Backwall, POG): the questions come after «Шаблон».
function parseIsmCheck(headers: string[], cells: Cell[]): ParsedRow | null {
  const get = getter(headers, cells);
  const id = str(get("ID чек-листа"));
  const at = parseDateTime(get("Дата заполнения"));
  const storeCode = str(get("Код точки"));
  if (!id || !at || !storeCode) return null;
  const channel = str(get("Канал"));
  const roi = str(get("ROI-статус"));
  return {
    kind: "ISM_CHECK",
    record: {
      id,
      storeCode,
      storeName: str(get("Магазин")) ?? storeCode,
      city: str(get("Город")),
      channel: channel === "Не указан канал" ? null : channel,
      at,
      day: at.slice(0, 10),
      month: str(get("Месяц")) ?? at.slice(0, 7),
      person: str(get("Заполнил")),
      template: str(get("Шаблон")),
      percent: num(get("Выполнение, %")),
      roi: roi === "positive" || roi === "negative" ? roi : null,
      recommended: str(get("Рекомендованный статус оплаты")),
      requestNo: str(get("Номер заявки на оплату")),
      tsmDecision: str(get("Статус оплаты (TSM)")),
      payPercent: num(get("Процент оплаты")),
      contractSum: num(get("Сумма по контракту")),
      toPay: num(get("Сумма к оплате")),
      comment: str(get("Комментарий чек-листа")),
      photos: PHOTO_COLUMNS.filter((n) => get(n)).length,
      checks: between(headers, "Шаблон")
        .map((c) => ({ q: c.name, a: cells[c.index] ?? null }))
        .filter((c) => c.a === "Да" || c.a === "Нет")
        .map((c) => ({ q: c.q, ok: c.a === "Да" })),
    },
  };
}

const WEEKDAY = /^(пн|вт|ср|чт|пт|сб|вс)$/i;
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

// The month of a route analysis. The sheet has only days of the month (2, 3, 4…), and the export
// is made for the month so far, so the month is the one of the day it was made — or the month
// before, when the sheet goes on to a later day than that (November's sheet exported on 1.12).
export function routeMonth(lastDay: number, madeAt: Date): string {
  const local = new Date(madeAt.getTime() + TASHKENT_OFFSET_MS);
  let year = local.getUTCFullYear();
  let month = local.getUTCMonth() + 1;
  if (lastDay > local.getUTCDate()) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

// Smart Up's «Анализ маршрута»: a legend, then a two-row header (weekdays over days of the month)
// and one row per client of a working zone, with a code under each day. `madeAt`: when the export
// was made (the workbook's own date, else the date in the file name, else now).
function parseRouteSheet(
  rowCount: number,
  cellsOf: (r: number) => Cell[],
  headerRow: number,
  madeAt: Date,
): { rows: ParsedRow[]; skipped: number } {
  const headers = cellsOf(headerRow).map((v) => String(v ?? "").trim());
  const under = cellsOf(headerRow + 1);
  const dayColumns = headers
    .map((name, index) => ({ index, day: Number(under[index]) }))
    .filter(
      (c) =>
        WEEKDAY.test(headers[c.index]!) && Number.isInteger(c.day) && c.day >= 1 && c.day <= 31,
    );
  const column = (name: string) => headers.indexOf(name);
  const [zoneAt, staffAt, clientAt, nameAt, orgAt] = [
    column("Рабочая зона"),
    column("Штат"),
    column("ИД клиента"),
    column("Клиент"),
    column("Организация"),
  ];
  if (!dayColumns.length || zoneAt < 0 || clientAt < 0) return { rows: [], skipped: 0 };
  const lastDay = Math.max(...dayColumns.map((c) => c.day));
  const month = routeMonth(lastDay, madeAt);
  const day = `${month}-${String(lastDay).padStart(2, "0")}`;
  const rows: ParsedRow[] = [];
  let skipped = 0;
  for (let r = headerRow + 2; r <= rowCount; r++) {
    const cells = cellsOf(r);
    if (cells.every((c) => c === null)) continue;
    const zone = personCode(str(cells[zoneAt] ?? null));
    const client = str(cells[clientAt] ?? null);
    // The totals under the table («Итоговое количество визитов в день») are not clients.
    if (!client || !/^\d+$/.test(client)) continue;
    if (!zone) {
      skipped++;
      continue;
    }
    const days: Record<string, RouteCode> = {};
    for (const c of dayColumns) {
      const code = String(cells[c.index] ?? "").trim() as RouteCode;
      if (ROUTE_CODES.includes(code)) days[String(c.day).padStart(2, "0")] = code;
    }
    // A client of a zone has a row per employee who visits it (the zone's own, and a supervisor
    // on a joint visit): each row keeps its own ID, or the last one would replace the others.
    const staff = staffAt < 0 ? null : str(cells[staffAt] ?? null);
    const other = staff && titleKey(staff) !== titleKey(zone) ? `|${staff}` : "";
    rows.push({
      kind: "ROUTE",
      record: {
        id: `${month}|${zone}|${client}${other}`,
        storeCode: client,
        storeName: str(cells[nameAt] ?? null) ?? client,
        city: orgAt < 0 ? null : str(cells[orgAt] ?? null),
        channel: null,
        at: "",
        day,
        month,
        person: zone,
        staff,
        days,
      },
    });
  }
  return { rows, skipped };
}

// The bot's Russian exports.
function parseRussianRow(kind: RuKind, headers: string[], cells: Cell[]): ParsedRow | null {
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
        // The export of 11.2026 says where the delivery stands in «Статус доставки» («Статус
        // заказа» only says it was sent); the older one in «Статус заказа».
        status: str(get("Статус доставки")) ?? str(get("Статус заказа")),
        express: get("Тип заказа") === "Экспресс",
        payment: str(get("Тип оплаты")),
        sourceCheck: str(get("ID заказа-источника (OOS)")) ?? str(get("ID проверки-источника")),
        storeAnswer: str(get("Ответ магазина")),
        storeAnswerAt: at2("Дата ответа магазина"),
        agent: str(get("Агент")),
        agentAnswer: str(get("Ответ агента")),
        deliveredAt: at2("Доставлено"),
        outcome: str(get("Итог доставки")),
        daysToDeliver: num(get("Дней до доставки")),
        positions: num(get("Позиций в заказе")) ?? 0,
        adjusted: yes(get("Скорректирован магазином")),
        packs: num(get("Количество всего, пач.")) ?? num(get("Заказано всего, пач.")) ?? 0,
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
  const photos = PHOTO_COLUMNS.filter((n) => get(n)).length;
  const template = str(get("Шаблон"));
  return {
    // A BDM's audit of a TSM is not a TSM's Market Visit.
    kind: template && AUDIT_TEMPLATE.test(template) ? "AUDIT" : kind,
    record: {
      ...base,
      person: str(get("Исполнитель")) ?? str(get("Создатель")),
      template,
      status: str(get("Статус проверки")),
      percent: num(get("Выполнение, %")),
      creator: str(get("Создатель")),
      doneAt: at2("Дата выполнения"),
      taskStatus: str(get("Статус задачи")),
      problems: num(get("Проблемных вопросов")) ?? 0,
      problemList: splitList(str(get("Проблемные вопросы"))),
      photos,
      ...questionnaire(headers, cells),
    },
  };
}

export type ParsedSheet = { kind: ConnectKind; rows: ParsedRow[]; skipped: number };

// "…23.11.2026 18_01_45.xlsx" → that day (noon in Tashkent), for an export that names its date.
function dateInName(name: string | undefined): Date | null {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(name ?? "");
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 7));
  return Number.isNaN(date.getTime()) ? null : date;
}

// All recognised sheets of a workbook; sheets of unknown shape are left out. A header row repeated
// in row 2 (Smart Up's totals have a two-row header) is not data. The header is row 1, except in
// Smart Up's route analysis (a legend comes first). A sheet with rows of two kinds (Market Visits
// and BDM audits) gives a sheet per kind.
export async function parseWorkbook(
  buffer: Buffer,
  options: { name?: string; now?: Date } = {},
): Promise<ParsedSheet[]> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheets: ParsedSheet[] = [];
  for (const ws of book.worksheets) {
    let headerRow = 1;
    let format: SheetFormat | null = null;
    let width = 0;
    const cellsOf = (r: number) => {
      const row = ws.getRow(r);
      return Array.from({ length: width }, (_, i) => cellValue(row.getCell(i + 1).value));
    };
    for (; headerRow <= 15 && !format; headerRow++) {
      width = ws.getRow(headerRow).cellCount;
      format = detectFormat(cellsOf(headerRow).map((v) => String(v ?? "").trim()));
      // Only the route analysis starts below row 1.
      if (headerRow > 1 && format !== "ROUTE") format = null;
    }
    if (!format) continue;
    headerRow -= 1;
    if (format === "ROUTE") {
      width = Math.max(width, ws.getRow(headerRow + 1).cellCount);
      const madeAt =
        (book.created instanceof Date && !Number.isNaN(book.created.getTime())
          ? book.created
          : null) ??
        dateInName(options.name) ??
        options.now ??
        new Date();
      sheets.push({ kind: "ROUTE", ...parseRouteSheet(ws.rowCount, cellsOf, headerRow, madeAt) });
      continue;
    }
    const headers = cellsOf(1).map((v) => String(v ?? "").trim());
    const second = cellsOf(2).map((v) => String(v ?? "").trim());
    const first = second.join("|") === headers.join("|") ? 3 : 2;
    const byKind = new Map<ConnectKind, ParsedRow[]>();
    let skipped = 0;
    for (let r = first; r <= ws.rowCount; r++) {
      const cells = cellsOf(r);
      if (cells.every((c) => c === null)) continue;
      // A totals row («Итого») is not data and not a skipped row either.
      if (cells.some((c) => typeof c === "string" && /^(итого|total)$/i.test(c))) continue;
      const row = parseRow(format, headers, cells);
      if (row) byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row]);
      else skipped++;
    }
    if (!byKind.size) byKind.set(KIND_OF[format], []);
    let counted = false;
    for (const [kind, rows] of byKind) {
      sheets.push({ kind, rows, skipped: counted ? 0 : skipped });
      counted = true;
    }
  }
  return sheets;
}
