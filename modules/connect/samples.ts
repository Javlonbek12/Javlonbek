import ExcelJS from "exceljs";

import type { ConnectKind } from "@/lib/generated/prisma/enums";

import { detectFormat, SAMPLE_MARK, type Cell, type RouteCode } from "./parse";

// «Все данные с образцами»: one workbook with a sheet per export the upload page accepts, each
// looking like the real export — the same rows above the header, the same header, a few rows of
// data — so that people see which export is which. The layouts are those of the exports of
// 23–24.11.2026; Smart Up's visit detail and totals were not among them and are laid out as in the
// tests' fixtures. Where an export has had two layouts the newest is shown: the bot's Russian
// exports, not its English ones, and the orders export without «Тип заказа».
//
// Every row here is made up: stores 90000x, TSM_TST_* / DR_TST_* zones, «Тест …» people, round
// sums. The rows tell one story across the sheets (the same three stores in the week of
// 2–8.11.2026), and each carries SAMPLE_MARK, which the importer leaves out: the file uploaded
// back as it is changes nothing.

export { SAMPLE_MARK };

export type ConnectSample = {
  kind: ConnectKind;
  // The sheet's name, as the export names it (two exports that share a name are told apart).
  sheet: string;
  // The rows above the header: a legend, the lines of the filters.
  before: Cell[][];
  // The header as exported: one row, or two (a header written twice; weekdays over days).
  headers: Cell[][];
  // The made-up data; each row has SAMPLE_MARK in one text cell.
  rows: Cell[][];
  // The rows under the data: totals.
  after: Cell[][];
  // The columns the importer cannot do without: those it knows the export by and those a row
  // needs to be kept.
  required: string[];
};

const marked = (text: string) => `${SAMPLE_MARK} ${text}`;
const blank = (count: number): Cell[] => Array.from({ length: count }, () => null);

const MONTH = "2026-11";
const ORGANIZATION = "Тестоград";
const STORES = [
  { code: 900001, name: marked("Тест магазин 1") },
  { code: 900002, name: marked("Тест магазин 2") },
  { code: 900003, name: marked("Тест магазин 3") },
] as const;
type Store = 0 | 1 | 2;
// The bot writes a person as «code - name».
const TSM1 = "TSM_TST_1 - Тест Первый";
const TSM2 = "TSM_TST_2 - Тест Второй";
const BDM = "BDM 99 - Тест Руководитель";
const BUM = "BUM TEST - Тест Директор";
const photo = (id: number) => `https://example.test/photo-${id}.jpg`;

// The columns every export of the bot has after its ID: «Магазин», «Код точки», «Регион»,
// «Город», «Канал», «Тип контракта».
const SHOP = ["Магазин", "Код точки", "Регион", "Город", "Канал", "Тип контракта"];
const shop = (store: Store): Cell[] => [
  STORES[store].name,
  STORES[store].code,
  "Тест",
  "Тестоград",
  "Retail",
  null,
];

// The product columns of the stock checks and the orders (the bot's list of 23.11.2026).
const SKUS = [
  "Blooming Blue",
  "Blooming Blue Grip Style",
  "Blooming Frost On Grip Style",
  "Blooming Silver",
  "Blooming Violet ON",
  "Blooming Violet on Grip Style",
  "Bohem Cavana Brown",
  "Bohem Cavana Demi",
  "Bohem Cavana Mojo",
  "Bohem Cavana Original",
  "Bohem Cavana Red",
  "Bohem Fiesta Brown",
  "Bohem Fiesta Original",
  "Bohem Fiesta Red",
  "Bohem Libre Brown",
  "Bohem Libre Red",
  "Bohem Signature Black Label",
  "ESSE Blue",
  "ESSE Change",
  "ESSE Change 1",
  "ESSE Change 1 Grip Style",
  "Esse Change Bing Grip Style",
  "ESSE Change Cold Black",
  "ESSE Change Double Tropic",
  "ESSE Change Grip Style",
  "ESSE CHANGE M",
  "ESSE Change Up",
  "Esse Change Up Grip Style",
  "ESSE Sense Himalaya",
  "ESSE Sense Himalaya Demi",
  "ESSE Sense Himalaya Grip Style",
  "ESSE Silver Grip Style",
  "ESSE Special Gold",
  "Pine Blue",
  "Pine Blue KS",
  "Pine Green",
  "Simple E-ON Island Pink",
  "Simple E-ON Mystic Purple",
] as const;
type Sku = (typeof SKUS)[number];

// Smart Up's visit detail: a visit planned and made, planned and not made, made without a plan.
const SU_VISIT_HEADERS = [
  "Organization",
  "Working Zone",
  "Employee",
  "Client ID",
  "Client",
  "Visit ID",
  "Visit Plan Date",
  "Fact Visit Date",
  "Start of visit time",
  "Finish the visit time",
  "Installed Backwall type",
  "Visit Comment",
];
const suVisit = (
  tsm: string,
  store: Store,
  id: number | null,
  plan: string | null,
  fact: string | null,
  times: [string, string] | null = null,
  comment: string | null = null,
): Cell[] => [
  ORGANIZATION,
  tsm,
  tsm,
  STORES[store].code,
  STORES[store].name,
  id,
  plan,
  fact,
  times?.[0] ?? null,
  times?.[1] ?? null,
  fact ? "Display M (6*9) POSI (TEST-0001)" : null,
  comment,
];

// Smart Up's totals per TSM. Its header has merged cells and comes out twice.
const SU_PERSON_HEADERS = [
  "Organization",
  "Working Zone",
  "Working Zone",
  "Working Zone",
  "Employee",
  "Employee",
  "Name of Employee",
  "Planned Visits",
  "Fact visits",
  "Completion rate %",
  "Unplanned visits",
  "Not visited stores",
];
const suPerson = (
  tsm: string,
  name: string,
  planned: number,
  made: number,
  unplanned: number,
): Cell[] => [
  ORGANIZATION,
  tsm,
  tsm,
  tsm,
  tsm,
  tsm,
  marked(name),
  planned,
  made,
  planned ? Math.round((made / planned) * 10000) / 100 : 0,
  unplanned,
  planned - made,
];

// The bot's Market Visits and, in the same layout, the BDMs' audits (told apart by «Шаблон»).
const VISIT_HEADERS = [
  "ID проверки",
  ...SHOP,
  "Статус проверки",
  "Выполнение, %",
  "Исполнитель",
  "Создатель",
  "Дата создания",
  "Месяц",
  "Дата выполнения",
  "Статус задачи",
  "Задача закрыта",
  "Срок задачи",
  "Проблемных вопросов",
  "Проблемные вопросы",
  "Фото 1",
  "Фото 2",
  "Фото 3",
  "Фото 4",
  "Фото 5",
  "Шаблон",
];
const VISIT_QUESTIONS = [
  "1.1 Перед началом визита у вас есть все необходимые данные и материалы для торговой точки?",
  "Торговая точка открыта?",
  "Информация о характеристиках торговой точки проверена, обновлена и актуальна на момент визита?",
  "Установлено ли оборудование KT&G в торговой точке?",
  "Какой тип оборудования KT&G установлен в торговой точке?",
  "Фото оборудование:",
  "Фото оборудования конкурентов:",
  "Подсветка оборудования KT&G включена?",
  "У вас есть контактные данные владельца/менеджера торговой точки и он знает, что и зачем вы делаете во время визита?",
  "Цена на полке на продукцию KT&G соответствует рекомендованной цене?",
  "Соблюдаются ли условия контракта по наличию обязательного ассортимента KT&G?",
  "Выставлен ли весь обязательный ассортимент KT&G на витрине, видимой потребителям?",
  "Все необходимые документы от торговой точки (для оплаты со стороны KT&G за последний период) были предоставлены?",
  "Установлены ли актуальные вставки в оборудование KT&G?",
  "Установлены ли временные POSM-материалы KT&G?",
  "Установлены ли фирменные ценники KT&G с актуальными на момент визита ценами?",
  "Оборудование KT&G в чистом состоянии на момент завершения визита?",
  "Передача лифлетов/«пирамидка» продавцам",
  "У вас есть контактные данные владельца/менеджера торговой точки и он знает, что и зачем вы делайте во время визита?",
  "Имеется ли PET?",
  "Проанализируйте торговую точку и предложите конкретные меры по улучшению продаж, видимости SKU, выкладки продукции и общей эффективности торговой точки:",
];
const AUDIT_QUESTIONS = [
  "Это совместный визит с ТСМ?",
  "Это новый ТСМ?",
  "Если это новый ТСМ, прошел ли он соответствующее обучение?",
  "Было ли обучение достаточным, чтобы ТСМ мог самостоятельно проводить визиты в торговые точки?",
  "Проверил ли ТСМ чистоту и состояние оборудования?",
  "Эффективно ли ТСМ общался с представителем торговой точки? Оцените, был ли ТСМ вежливым и профессиональным, чётко ли презентовал / предлагал нашу продукцию, отвечал ли на вопросы и поддерживал ли хорошую коммуникацию с представителем торговой точки (BDM Audit Опросник 11.2026 #26) #181",
  "Как бы вы оценили общее качество визита ТСМ в торговую точку?",
  "Пожалуйста, укажите допольнительные комментарии или предложения по улучшению.",
  "Правильно ли ТСМ проверил наличие продукции и ситуации ООС (Отсутстие товара на полке)? Оцените, проверил ли ТСМ все соответствующие SKU выявил ли отсутствующие товары и предпринял ли действия для обеспечения наличия продукции в торговой точки",
  "Эффективно ли ТСМ общался с представителем торговой точки? Оцените, был ли ТСМ вежливым и профессиональным, чётко ли презентовал / предлагал нашу продукцию, отвечал ли на вопросы и поддерживал ли хорошую коммуникацию с представителем торговой точки (BDM Audit Опросник 11.2026 #26) #185",
];
const VISIT_TEMPLATE = "Regular_visit_questionnaire_TSM_09.2026";
const AUDIT_TEMPLATE = "BDM Audit Опросник 11.2026";
const visit = (
  id: number,
  store: Store,
  creator: string,
  at: string,
  done: string,
  percent: number,
  problems: string[],
  template: string,
  answers: Cell[],
): Cell[] => [
  id,
  ...shop(store),
  "Выполнено",
  percent,
  null,
  creator,
  at,
  MONTH,
  done,
  null,
  null,
  null,
  problems.length,
  problems.join("; ") || null,
  photo(id),
  null,
  null,
  null,
  null,
  template,
  ...answers,
];
// The answers of a full Market Visit, with those given otherwise (by the question's number).
const visitAnswers = (other: Record<number, Cell> = {}): Cell[] =>
  [
    null,
    "Да",
    "Да",
    "Да",
    "Тестовое оборудование",
    "1 фото",
    null,
    "Да",
    "Да",
    "Да",
    "Да",
    "Да",
    "Да",
    "Да",
    "Нет",
    "Да",
    "Да",
    "Да",
    null,
    "Нет",
    "Тестовый комментарий",
  ].map((answer, index) => (index in other ? (other[index] ?? null) : answer));

// The bot's stock checks: every product is in stock, short, out, or was never bought.
const OOS_HEADERS = [
  "ID проверки",
  ...SHOP,
  "Дата проверки",
  "Месяц",
  "Проверил",
  "Нет в наличии, поз.",
  "Недостаточно, поз.",
  "Заказ создан",
  "Номер заказа",
  "Статус заказа",
  "Статус доставки",
  ...SKUS,
  "Позиции вне колонок, шт.",
];
type Gap = "Нет в наличии" | "Недостаточно" | "Не было закупа";
const oos = (
  id: number,
  store: Store,
  at: string,
  person: string,
  // The order made from the check: its number and where the delivery stands.
  order: [string, string] | null,
  gaps: Partial<Record<Sku, Gap>>,
): Cell[] => [
  id,
  ...shop(store),
  at,
  MONTH,
  person,
  Object.values(gaps).filter((gap) => gap === "Нет в наличии").length,
  Object.values(gaps).filter((gap) => gap === "Недостаточно").length,
  order ? "Да" : "Нет",
  order?.[0] ?? null,
  order ? "Отправлен" : null,
  order?.[1] ?? null,
  ...SKUS.map((sku) => gaps[sku] ?? "В наличии"),
  0,
];

// The bot's orders, as exported since 11.2026: no «Тип заказа», but «ID проверки-источника» (the
// stock check the order came from) and «Статус доставки».
const ORDER_HEADERS = [
  "Номер заказа",
  ...SHOP,
  "Дата заказа",
  "Месяц",
  "Статус заказа",
  "Статус доставки",
  "Создал",
  "ID проверки-источника",
  "Позиций в заказе",
  "Заказано всего, пач.",
  "Сумма",
  ...SKUS,
  "Позиции вне колонок, шт.",
];
const PACK_PRICE = 15000;
const order = (
  no: string,
  store: Store,
  at: string,
  delivery: string,
  person: string,
  check: number,
  packs: Partial<Record<Sku, number>>,
): Cell[] => {
  const total = Object.values(packs).reduce((a, b) => a + b, 0);
  return [
    no,
    ...shop(store),
    at,
    MONTH,
    "Отправлен",
    delivery,
    person,
    check,
    Object.keys(packs).length,
    total,
    total * PACK_PRICE,
    ...SKUS.map((sku) => packs[sku] ?? null),
    null,
  ];
};

// The checklist of an equipment check (Backwall). The POG and LEGO checklists are the same export
// with their own questions after «Шаблон».
const ISM_QUESTIONS = [
  "Работала ли торговая точка ¾ месяца, то есть 75% времени?",
  "Наличие всего ассортимента",
  "Рекомендованная розничная цена соблюдена",
  "Соблюдение планограммы размещения ТО",
  "Включённый свет и чистота оборудования",
  "Минимальный рекомендованный запас ассортимента",
  "Находится ли оборудование на том же месте, которое было согласовано при установке?",
];
const ISM_TEMPLATE = "Проверка оборудования (Backwall)";
const ISM_CHECK_HEADERS = [
  "ID чек-листа",
  ...SHOP,
  "Заполнил",
  "Дата заполнения",
  "Месяц",
  "Выполнение, %",
  "ROI-статус",
  "Рекомендованный статус оплаты",
  "Номер заявки на оплату",
  "Статус оплаты (TSM)",
  "Процент оплаты",
  "Сумма по контракту",
  "Сумма к оплате",
  "Комментарий чек-листа",
  "Фото 1",
  "Фото 2",
  "Фото 3",
  "Фото 4",
  "Фото 5",
  "Шаблон",
  ...ISM_QUESTIONS,
];
// The payment requests carry the questions of all three checklists; a request answers its own.
const PAYMENT_HEADERS = [
  "ID заявки",
  "Номер заявки",
  ...SHOP,
  "Дата заявки",
  "Месяц",
  "Выполнение чек-листа, %",
  "ROI-статус",
  "TSM",
  "Статус оплаты (TSM)",
  "Процент оплаты",
  "Сумма по контракту",
  "Сумма к оплате",
  "Комментарий TSM",
  "TSM подтвердил факт",
  "Решение BDM",
  "BDM",
  "Дата решения BDM",
  "Комментарий BDM",
  "Решение BUM",
  "BUM",
  "Дата решения BUM",
  "Комментарий BUM",
  "Факт оплаты",
  "Дата оплаты",
  "Фактическая сумма",
  "Комментарий бухгалтерии",
  "Дней до оплаты",
  "Работала ли торговая точка ¾ месяца, то есть 75% времени? (Проверка оборудования (Backwall) #1)",
  "Наличие всего ассортимента",
  "Рекомендованная розничная цена соблюдена",
  "Соблюдение планограммы размещения ТО",
  "Включённый свет и чистота оборудования",
  "Минимальный рекомендованный запас ассортимента",
  "Находится ли оборудование на том же месте, которое было согласовано при установке? (Проверка оборудования (Backwall) #1)",
  "Работала ли торговая точка ¾ месяца, то есть 75% времени? (Проверка POG #2)",
  "В наличии имеется все обязательные ассортименты",
  "Продукция выставлена на видном месте",
  "Поддерживается ли минимальный рекомендуемый запас продукции? (Проверка POG #2)",
  "Находится ли оборудование на том же месте, которое было согласовано при установке? (Проверка POG #2)",
  "В наличии имеется все обязательные ассортименты?",
  "Продукция выставлена на видном месте?",
  "Имеются ли в наличии все обязательных SKU (Must-list)?",
  "Поддерживается ли минимальный рекомендуемый запас продукции? (Проверка LEGO #3)",
  "Находится ли оборудование на том же месте, которое было согласовано при установке? (Проверка LEGO #3)",
];
// One equipment check of a store and the payment request made from it.
type Ism = {
  check: number;
  request: number;
  store: Store;
  tsm: string;
  at: string;
  // The «Нет» answers, by the question's number.
  failed: number[];
  // The part of the contract's sum the TSM asks to pay (null: all of it).
  payPercent: number | null;
  contract: number;
  comment: string | null;
  // The decisions with their dates, and the payment: its date and the days it took.
  bdm: [string, string | null];
  bum: [string, string | null] | null;
  paid: [string, number] | null;
};
const ISM: Ism[] = [
  {
    check: 801,
    request: 301,
    store: 0,
    tsm: TSM1,
    at: "02.11.2026 11:40",
    failed: [],
    payPercent: null,
    contract: 500000,
    comment: null,
    bdm: ["Подтверждено", "03.11.2026 09:30"],
    bum: ["Подтверждено", "04.11.2026 11:00"],
    paid: ["06.11.2026 15:00", 4],
  },
  {
    check: 802,
    request: 302,
    store: 1,
    tsm: TSM1,
    at: "06.11.2026 12:10",
    failed: [3, 4],
    payPercent: 50,
    contract: 400000,
    comment: "Тестовый комментарий",
    bdm: ["Подтверждено", "07.11.2026 10:15"],
    bum: ["В ожидании", null],
    paid: null,
  },
  {
    check: 803,
    request: 303,
    store: 2,
    tsm: TSM2,
    at: "05.11.2026 16:00",
    // The checklist recommends a part, the TSM asked for all of it: declined.
    failed: [5],
    payPercent: null,
    contract: 600000,
    comment: null,
    bdm: ["Отклонено", null],
    bum: null,
    paid: null,
  },
];
const ismAnswers = (ism: Ism): Cell[] =>
  ISM_QUESTIONS.map((_, index) => (ism.failed.includes(index) ? "Нет" : "Да"));
const ismPercent = (ism: Ism) =>
  Math.round((1 - ism.failed.length / ISM_QUESTIONS.length) * 10000) / 100;
const ismDecision = (ism: Ism) =>
  ism.payPercent === null ? "Оплатить полную сумму" : "Оплатить частично";
const ismToPay = (ism: Ism) =>
  ism.payPercent === null ? null : (ism.contract * ism.payPercent) / 100;
const ismCheck = (ism: Ism): Cell[] => [
  ism.check,
  ...shop(ism.store),
  ism.tsm,
  ism.at,
  MONTH,
  ismPercent(ism),
  ism.failed.length ? "negative" : "positive",
  ism.failed.length ? "Частичная оплата" : "Полная оплата",
  ISM.indexOf(ism) + 1,
  ismDecision(ism),
  ism.payPercent,
  ism.contract,
  ismToPay(ism),
  ism.comment,
  photo(ism.check),
  null,
  null,
  null,
  null,
  ISM_TEMPLATE,
  ...ismAnswers(ism),
];
const payment = (ism: Ism): Cell[] => [
  ism.request,
  ISM.indexOf(ism) + 1,
  ...shop(ism.store),
  ism.at,
  MONTH,
  ismPercent(ism),
  ism.failed.length ? "negative" : "positive",
  ism.tsm,
  ismDecision(ism),
  ism.payPercent,
  ism.contract,
  ismToPay(ism),
  ism.comment,
  "Да",
  ism.bdm[0],
  BDM,
  ism.bdm[1],
  null,
  ism.bum?.[0] ?? null,
  ism.bum?.[1] ? BUM : null,
  ism.bum?.[1] ?? null,
  null,
  ism.paid ? "Оплачено" : null,
  ism.paid?.[0] ?? null,
  ism.paid ? (ismToPay(ism) ?? ism.contract) : null,
  null,
  ism.paid?.[1] ?? null,
  ...ismAnswers(ism),
  // The questions of the POG and LEGO checklists.
  ...blank(10),
];

// Smart Up's «Анализ маршрута» made on Monday 9.11.2026: the legend, then weekdays over the days
// of the month so far (a week's total before its days), a code under each day, and the counts.
const ROUTE_TOP: Cell[] = [
  "Номер заказа",
  "Организация",
  "Рабочая зона",
  "Штат",
  "ИД клиента",
  "Клиент",
  "Характеристика клиента",
  "Итог за неделю",
  "Пн",
  "Вт",
  "Ср",
  "Чт",
  "Пт",
  "Сб",
  "Итог за неделю",
  "Пн",
  "Итог за неделю",
  "Количество визитов",
  null,
  null,
  null,
  "План визитов",
  ...blank(5),
];
const ROUTE_DAYS = [2, 3, 4, 5, 6, 7, null, 9];
const ROUTE_COUNTS: RouteCode[] = ["U", "UD", "P", "PD", "X", "O"];
const ROUTE_UNDER: Cell[] = [
  ...blank(7),
  "1 неделя",
  ...ROUTE_DAYS.map((day) => day ?? "2 неделя"),
  "3 неделя",
  ...ROUTE_COUNTS,
  "Средний % MML",
  "Результативность %",
  "Результативность визитов (%)",
  "Результативен",
];
type RouteDays = Partial<Record<number, RouteCode>>;
// Each of a zone's clients with what happened on each day.
const ROUTES: { zone: string; store: Store; days: RouteDays }[] = [
  { zone: "DR_TST_1", store: 0, days: { 2: "PD", 4: "P", 6: "X", 9: "O" } },
  { zone: "DR_TST_1", store: 2, days: { 3: "U", 5: "UD", 9: "O" } },
  { zone: "TSM_TST_1", store: 0, days: { 2: "P", 9: "O" } },
  { zone: "TSM_TST_1", store: 1, days: { 3: "X", 7: "U" } },
];
// How many of a client's days have one of the codes; how many clients have one on a day.
const codesOf = (days: RouteDays, ...codes: RouteCode[]) =>
  Object.values(days).filter((code) => code && codes.includes(code)).length;
const onDay = (day: number, ...codes: RouteCode[]) =>
  ROUTES.filter((route) => codesOf({ [day]: route.days[day] }, ...codes)).length;
const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const ORDERED: RouteCode[] = ["PD", "UD"];
const VISITED: RouteCode[] = ["P", "PD", "U", "UD"];
const routeRows = ROUTES.map(({ zone, store, days }, index): Cell[] => [
  index + 1,
  ORGANIZATION,
  // The zone's own person visits it.
  zone,
  zone,
  STORES[store].code,
  STORES[store].name,
  null,
  null,
  ...ROUTE_DAYS.map((day) => (day === null ? null : (days[day] ?? null))),
  null,
  ...ROUTE_COUNTS.map((code) => codesOf(days, code) || null),
  null,
  share(codesOf(days, ...ORDERED), codesOf(days, ...VISITED)),
  share(codesOf(days, "PD"), codesOf(days, "P", "PD", "X")),
  codesOf(days, ...ORDERED) ? "Да" : "Нет",
]);
// A row of the totals under the clients: a number per day, and a note under one of the counts.
const routeFoot = (
  label: string | null,
  code: RouteCode | null,
  perDay: (day: number) => number,
  note?: [column: string, text: string],
) => {
  const row: Cell[] = [
    label,
    ...blank(5),
    code,
    null,
    ...ROUTE_DAYS.map((day) => (day === null ? null : perDay(day))),
  ];
  if (note) row[ROUTE_TOP.indexOf(note[0])] = note[1];
  return row;
};
const routeClients = new Set(ROUTES.map((route) => route.store)).size;
const routeOrdered = ROUTES.filter((route) => codesOf(route.days, ...ORDERED)).length;
const routeCodes = (...codes: RouteCode[]) =>
  ROUTES.reduce((sum, route) => sum + codesOf(route.days, ...codes), 0);
const ROUTE_AFTER: Cell[][] = [
  routeFoot("Итоговое количество визитов в день:", "U", (day) => onDay(day, "U")),
  routeFoot(null, "UD", (day) => onDay(day, "UD"), [
    "План визитов",
    `Количество клиентов: ${routeClients}`,
  ]),
  routeFoot(null, "P", (day) => onDay(day, "P")),
  routeFoot(null, "PD", (day) => onDay(day, "PD")),
  routeFoot("Итоговое количество визитов по плану в день:", "X", (day) => onDay(day, "X"), [
    "Количество визитов",
    `Доля результативных клиентов: ${share(routeOrdered, ROUTES.length)}%`,
  ]),
  routeFoot(null, "O", (day) => onDay(day, "O")),
  routeFoot(
    "Результативность за день (%):",
    null,
    (day) => share(onDay(day, ...ORDERED), onDay(day, ...VISITED)),
    [
      "Количество визитов",
      `Общая результативность по плану (%): ${share(routeCodes("PD"), routeCodes("P", "PD", "X"))}`,
    ],
  ),
];

// Smart Up's client base.
const CLIENT_HEADERS = [
  "ИД",
  "Название",
  "Организации",
  "GPS координаты",
  "KT&G Grade NEW",
  "(TSM) Коммуникация / Key Visual",
  "Promotion / промоакция",
  "Сумма контракта / Contract budget",
  "BDM KTNG",
  "Responsible DR",
  "Тип оборудования 1 |Backwall / POG",
  "NEW Launch promotion",
  "(TSM;DR) Основной канал / POS channel",
  "Responsible TSM",
  "Регион",
  "Статус",
  "ИНН",
];
const client = (
  store: Store,
  gps: string,
  grade: string,
  contract: string,
  tsm: string,
): Cell[] => [
  STORES[store].code,
  STORES[store].name,
  ORGANIZATION,
  gps,
  grade,
  "Нет коммуникации/No key visual",
  "2%",
  // (Smart Up writes the sum as text.)
  contract,
  "BDM 99 (Тест Руководитель)",
  "DR_TST_1",
  "Display M (6*9) POSI",
  "1 order",
  "Розница (Retail)",
  tsm,
  "Тестовый район",
  "Активный",
  `00000000${store + 1}`,
];

// The CRM's employee info: a position, who is in it, its zones and the position above it.
const POSITION_HEADERS = [
  "ИД",
  "Название",
  "Пользователь",
  "Рабочие зоны",
  "Роли",
  "Руководитель",
  "Дата создания",
  "Статус",
];
const position = (
  id: number,
  title: string,
  user: string,
  zones: string,
  roles: string,
  manager: string,
): Cell[] => [id, title, marked(user), zones, roles, manager, "01.10.2026 09:00:00", "Активный"];

// Smart Up's «Конструктор отчётов по продажам»: the lines of the filters it was made with, the
// header, a row per product delivered to a store on a day (in blocks of 10 packs), and the totals.
// The client ID, the order ID and the day are text in it.
const SALE_HEADERS = [
  "Организация",
  "Клиент",
  "ИД клиента",
  "Адрес",
  "Регион",
  "ТМЦ",
  "Штат",
  "ХЮ:Responsible TSM",
  "ИД заказа",
  "Дата доставки",
  "Количество продажи",
  "Сумма без скидки/наценки",
];
const BLOCK_PRICE = 150000;
// What was delivered: the first two rows are order #TST-0001 of the orders sheet.
const SALES: [Store, string, string, Sku, number][] = [
  [0, "TSM_TST_1", "03.11.2026", "ESSE Change", 2],
  [0, "TSM_TST_1", "03.11.2026", "Pine Blue", 1],
  [1, "TSM_TST_1", "04.11.2026", "ESSE Blue", 3],
  [2, "TSM_TST_2", "07.11.2026", "Pine Green", 2],
];
const saleRows = SALES.map(([store, tsm, day, sku, blocks], index): Cell[] => [
  ORGANIZATION,
  STORES[store].name,
  String(STORES[store].code),
  `Тестоград, Тестовая улица, ${store + 1}`,
  "Тестовый район",
  sku,
  "DR_TST_1",
  tsm,
  // The two products of an order share its ID.
  String(900000001 + Math.max(0, index - 1)),
  day,
  blocks,
  blocks * BLOCK_PRICE,
]);
const soldBlocks = SALES.reduce((sum, sale) => sum + sale[4], 0);

// One sample per kind; the workbook has its sheets in this order.
export const CONNECT_SAMPLES: ConnectSample[] = [
  {
    kind: "SU_VISIT",
    sheet: "Visit Detailization (Smart up)",
    before: [],
    headers: [SU_VISIT_HEADERS],
    rows: [
      suVisit("TSM_TST_1", 0, 610001, "02.11.2026", "02.11.2026", ["10:00:00", "10:20:00"]),
      suVisit("TSM_TST_1", 1, null, "03.11.2026", null),
      suVisit("TSM_TST_1", 1, 610002, null, "07.11.2026", ["11:20:00", "11:45:00"]),
      suVisit(
        "TSM_TST_2",
        2,
        610003,
        "03.11.2026",
        "03.11.2026",
        ["09:00:00", "09:05:00"],
        "Торговая точка была закрыта на момент визита ( The outlet was closed at the visit time )",
      ),
    ],
    after: [],
    required: ["Employee", "Client ID", "Visit Plan Date", "Fact Visit Date"],
  },
  {
    kind: "SU_PERSON",
    sheet: "Total Visit info (Smart up)",
    before: [],
    headers: [SU_PERSON_HEADERS, SU_PERSON_HEADERS],
    rows: [
      suPerson("TSM_TST_1", "Тест Первый", 2, 1, 1),
      suPerson("TSM_TST_2", "Тест Второй", 1, 1, 0),
      suPerson("TSM_TST_3", "Тест Третий", 0, 0, 0),
    ],
    after: [["Итого", "Итого", "Итого", "Итого", "Итого", "Итого", null, 3, 2, null, 1, 1]],
    required: ["Employee", "Name of Employee", "Planned Visits"],
  },
  {
    kind: "VISIT",
    sheet: "Market Visit",
    before: [],
    headers: [[...VISIT_HEADERS, ...VISIT_QUESTIONS]],
    rows: [
      visit(
        7001,
        0,
        TSM1,
        "02.11.2026 10:05",
        "02.11.2026 10:15",
        93.33,
        [],
        VISIT_TEMPLATE,
        visitAnswers(),
      ),
      visit(
        7002,
        1,
        TSM1,
        "07.11.2026 11:25",
        "07.11.2026 11:40",
        80,
        [VISIT_QUESTIONS[7]!, VISIT_QUESTIONS[9]!],
        VISIT_TEMPLATE,
        visitAnswers({ 7: "Нет", 9: "Выше рекомендованной" }),
      ),
      // A closed store: nothing after «Торговая точка открыта?».
      visit(7003, 2, TSM2, "03.11.2026 09:02", "03.11.2026 09:04", 6.67, [], VISIT_TEMPLATE, [
        null,
        "Нет",
        ...blank(VISIT_QUESTIONS.length - 2),
      ]),
    ],
    after: [],
    required: ["ID проверки", "Код точки", "Статус проверки", "Дата создания", "Шаблон"],
  },
  {
    kind: "OOS",
    sheet: "Проверки остатков",
    before: [],
    headers: [OOS_HEADERS],
    rows: [
      oos(
        5001,
        0,
        "02.11.2026 10:10",
        TSM1,
        ["#TST-0001", "Доставлено — ожидает подтверждения точки"],
        {
          "ESSE Change": "Нет в наличии",
          "Pine Blue": "Нет в наличии",
          "ESSE Blue": "Недостаточно",
        },
      ),
      oos(5002, 1, "07.11.2026 11:30", TSM1, ["#TST-0002", "Точка не ответила"], {
        "ESSE Special Gold": "Нет в наличии",
        "Bohem Cavana Red": "Не было закупа",
      }),
      oos(5003, 2, "05.11.2026 15:40", TSM2, null, {}),
      oos(5004, 2, "06.11.2026 09:50", TSM2, ["#TST-0003", "Точка выбрала дату — ожидает агента"], {
        "Pine Green": "Недостаточно",
      }),
    ],
    after: [],
    required: ["ID проверки", "Код точки", "Дата проверки", "Нет в наличии, поз."],
  },
  {
    kind: "ORDER",
    sheet: "Заказы OOS",
    before: [],
    headers: [ORDER_HEADERS],
    rows: [
      order(
        "#TST-0001",
        0,
        "02.11.2026 10:12",
        "Доставлено — ожидает подтверждения точки",
        TSM1,
        5001,
        { "ESSE Change": 20, "Pine Blue": 10, "ESSE Blue": 10 },
      ),
      order("#TST-0002", 1, "07.11.2026 11:32", "Точка не ответила", TSM1, 5002, {
        "ESSE Special Gold": 10,
      }),
      order("#TST-0003", 2, "06.11.2026 09:53", "Точка выбрала дату — ожидает агента", TSM2, 5004, {
        "Pine Green": 20,
      }),
    ],
    after: [],
    required: ["Номер заказа", "Код точки", "Дата заказа", "ID проверки-источника"],
  },
  {
    kind: "PAYMENT",
    sheet: "ISM · Заявки на оплату",
    before: [],
    headers: [PAYMENT_HEADERS],
    rows: ISM.map(payment),
    after: [],
    required: ["ID заявки", "Код точки", "Дата заявки"],
  },
  {
    kind: "AUDIT",
    // The export calls this sheet «Market Visit» too.
    sheet: "Market Visit (BDM Audit)",
    before: [],
    headers: [[...VISIT_HEADERS, ...AUDIT_QUESTIONS]],
    rows: [
      visit(7101, 0, BDM, "02.11.2026 10:08", "02.11.2026 10:25", 60, [], AUDIT_TEMPLATE, [
        "Да",
        "Нет",
        null,
        null,
        "Да",
        "Да",
        null,
        "Тестовый комментарий",
        "Да",
        null,
      ]),
      visit(7102, 1, BDM, "07.11.2026 11:35", "07.11.2026 11:50", 50, [], AUDIT_TEMPLATE, [
        "Да",
        "Нет",
        null,
        null,
        "Нет",
        "Да",
        null,
        null,
        "Да",
        null,
      ]),
      // Not a joint visit: the BDM came after the TSM.
      visit(7103, 2, BDM, "06.11.2026 14:00", "06.11.2026 14:10", 20, [], AUDIT_TEMPLATE, [
        "Нет",
        "Нет",
        ...blank(AUDIT_QUESTIONS.length - 2),
      ]),
    ],
    after: [],
    required: ["ID проверки", "Код точки", "Статус проверки", "Дата создания", "Шаблон"],
  },
  {
    kind: "ISM_CHECK",
    sheet: "ISM · Чек-листы",
    before: [],
    headers: [ISM_CHECK_HEADERS],
    rows: ISM.map(ismCheck),
    after: [],
    required: ["ID чек-листа", "Код точки", "Дата заполнения", "Шаблон"],
  },
  {
    kind: "ROUTE",
    sheet: "Анализ маршрута",
    before: [
      [],
      ["Предстоящий плановый визит:", null, null, "O", "MML (%):", null, null, "M%"],
      ["Невыполненный плановый визит:", null, null, "X"],
      ["Внеплановый визит без заказа:", null, null, "U"],
      ["Внеплановый визит с заказом:", null, null, "UD"],
      ["Плановый визит без заказа:", null, null, "P"],
      ["Плановый визит с заказом:", null, null, "PD"],
      [],
      [],
    ],
    headers: [ROUTE_TOP, ROUTE_UNDER],
    rows: routeRows,
    after: ROUTE_AFTER,
    // And a weekday («Пн»…«Вс») over each day of the month.
    required: ["Рабочая зона", "ИД клиента", "Итог за неделю"],
  },
  {
    kind: "CLIENT",
    // The export calls this sheet «Sheet», and so does the employee info's.
    sheet: "Sheet (клиенты)",
    before: [],
    headers: [CLIENT_HEADERS],
    rows: [
      client(0, "41.31000,69.24000", "XL", "500000", "TSM_TST_1"),
      client(1, "41.32000,69.25000", "L", "400000", "TSM_TST_1"),
      client(2, "41.33000,69.26000", "M", "600000", "TSM_TST_2"),
    ],
    after: [],
    required: ["ИД", "Название", "GPS координаты", "Responsible TSM"],
  },
  {
    kind: "SU_POSITION",
    sheet: "Sheet (сотрудники)",
    before: [],
    headers: [POSITION_HEADERS],
    rows: [
      position(
        900101,
        "BDM 99",
        "Тест Руководитель",
        "TSM_TST_1, TSM_TST_2",
        "KT&G BDM",
        "BUM TEST",
      ),
      position(900102, "TSM_TST_1", "Тест Первый", "TSM_TST_1", "Мерчендайзер", "BDM 99"),
      position(900103, "TSM_TST_2", "Тест Второй", "TSM_TST_2", "Мерчендайзер", "BDM 99"),
      position(
        900104,
        "Supervisor TST (Тест дистрибьютор)",
        "Тест Супервайзер",
        "DR_TST_1",
        "Супервайзер",
        "Director (Тест дистрибьютор)",
      ),
    ],
    after: [],
    required: ["Название", "Рабочие зоны", "Руководитель"],
  },
  {
    kind: "SALE",
    sheet: "Конструктор отчётов по продажам",
    before: [
      [`ТМЦ: ${new Set(SALES.map((sale) => sale[3])).size} selected`],
      ["Дата доставки: 02.11.2026-08.11.2026"],
      ["Источник: Визит,Заказ"],
      ["Статус: Архив"],
      ["Тип ТМЦ: Товар"],
    ],
    headers: [SALE_HEADERS],
    rows: saleRows,
    after: [[...Array.from({ length: 10 }, () => "ИТОГО"), soldBlocks, soldBlocks * BLOCK_PRICE]],
    required: ["ИД клиента", "ТМЦ", "Дата доставки", "Количество продажи"],
  },
];

const BOLD = { bold: true };

// A sheet's cells, row by row from the first. The columns are as wide as the text of the `sized`
// rows, to a limit (a legend or a filter line above the table runs over the empty cells next to it
// and is not what a column is sized by).
function fill(ws: ExcelJS.Worksheet, rows: Cell[][], sized: Cell[][], maxWidth: number) {
  rows.forEach((cells, r) =>
    cells.forEach((value, c) => {
      if (value !== null) ws.getCell(r + 1, c + 1).value = value;
    }),
  );
  const widths: number[] = [];
  for (const cells of sized)
    cells.forEach((value, c) => {
      if (value !== null) widths[c] = Math.max(widths[c] ?? 0, String(value).length);
    });
  widths.forEach((width, c) => {
    ws.getColumn(c + 1).width = Math.min(Math.max(width + 2, 10), maxWidth);
  });
}

// The samples as a workbook: a sheet per kind, in the samples' order. `guide`: a first sheet of
// text for people (its first row is its header). `created`: the day the workbook says it was made
// on — the route analysis has no month of its own and takes it from there. `samples`: other rows
// in the same sheets (the tests take the mark off them).
export async function connectSampleWorkbook(
  options: {
    kinds?: ConnectKind[];
    guide?: { sheet: string; rows: Cell[][] };
    created?: Date;
    samples?: ConnectSample[];
  } = {},
): Promise<Buffer> {
  const { kinds, guide, created = new Date(), samples = CONNECT_SAMPLES } = options;
  const book = new ExcelJS.Workbook();
  book.created = created;
  if (guide) {
    // A row of the guide that reads as an export's header would be uploaded as that export.
    if (guide.rows.some((row) => detectFormat(row.map((cell) => String(cell ?? "").trim()))))
      throw new Error("connect samples: a guide row reads as the header of an export");
    const ws = book.addWorksheet(guide.sheet, { views: [{ state: "frozen", ySplit: 1 }] });
    fill(ws, guide.rows, guide.rows, 80);
    ws.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
    });
    ws.getRow(1).font = BOLD;
  }
  for (const sample of samples) {
    if (kinds && !kinds.includes(sample.kind)) continue;
    const top = sample.before.length;
    const ws = book.addWorksheet(sample.sheet, {
      // The header stays in sight, with what is above it.
      views: [{ state: "frozen", ySplit: top + sample.headers.length }],
    });
    const table = [...sample.headers, ...sample.rows];
    fill(ws, [...sample.before, ...table, ...sample.after], table, 36);
    sample.headers.forEach((_, index) => {
      ws.getRow(top + index + 1).font = BOLD;
    });
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
