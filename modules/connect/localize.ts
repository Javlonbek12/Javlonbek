import { currentExportLocale, type ExportLocale } from "@/lib/i18n";

// Data values in the Connect downloads (English and Korean files). Much of the data arrives in
// Russian: answers, delivery and payment statuses, Market Visit questions, equipment names, Smart Up
// comments. A value known here is translated (exact match after trim); everything else — stores,
// people, products, regions, unknown answers — stays as it came. Only the files use this: the page
// keeps showing the data as uploaded. Numbers, dates and object keys are never passed here.

type Translation = { en: string; ko: string };

const KNOWN: Record<string, Translation> = {
  // Answers.
  Да: { en: "Yes", ko: "예" },
  Нет: { en: "No", ko: "아니요" },
  Частично: { en: "Partly", ko: "부분적" },
  "Выше рекомендованной": { en: "Above recommended", ko: "권장가보다 높음" },
  "Ниже рекомендованной": { en: "Below recommended", ko: "권장가보다 낮음" },
  "Нет контракта KT&G": { en: "No KT&G contract", ko: "KT&G 계약 없음" },
  // Products in a stock check.
  "В наличии": { en: "In stock", ko: "재고 있음" },
  "Нет в наличии": { en: "Out of stock", ko: "재고 없음" },
  Недостаточно: { en: "Not enough", ko: "부족" },
  "Не было закупа": { en: "Not purchased", ko: "미구매" },
  // Orders and their delivery (the English exports and the earlier Russian ones).
  Отправлен: { en: "Sent", ko: "발송됨" },
  "Точка не ответила": { en: "Store did not respond", ko: "매장 무응답" },
  "Точка выбрала дату — ожидает агента": {
    en: "Store chose a date — waiting for the agent",
    ko: "매장 날짜 선택 — 에이전트 대기",
  },
  "Агент принял — готовит доставку": {
    en: "Agent accepted — preparing delivery",
    ko: "에이전트 수락 — 배송 준비 중",
  },
  "Доставлено — ожидает подтверждения точки": {
    en: "Delivered — awaiting store confirmation",
    ko: "배송 완료 — 매장 확인 대기",
  },
  "Доставлено и подтверждено точкой": {
    en: "Delivered and confirmed by the store",
    ko: "배송 완료 — 매장 확인 완료",
  },
  "Ожидает экспресс-доставщика": { en: "Waiting for an express courier", ko: "퀵배송 기사 대기" },
  "Точка отказалась от заказа": { en: "Store refused the order", ko: "매장 주문 거절" },
  "В ожидании": { en: "Pending", ko: "대기 중" },
  Доставлено: { en: "Delivered", ko: "배송 완료" },
  "Не доставлено": { en: "Not delivered", ko: "미배송" },
  Отказался: { en: "Refused", ko: "거절" },
  // ISM payment requests: decisions and accounting.
  Подтверждено: { en: "Approved", ko: "승인" },
  Отклонено: { en: "Rejected", ko: "반려" },
  Оплачено: { en: "Paid", ko: "지급 완료" },
  "Не одобрено": { en: "Not approved", ko: "미승인" },
  "В процессе оплаты": { en: "Payment in progress", ko: "지급 진행 중" },
  "Счёт-фактура не подтверждена": { en: "Invoice not confirmed", ko: "세금계산서 미확인" },
  "Документ не подписан в Didox": {
    en: "Document not signed in Didox",
    ko: "Didox 문서 미서명",
  },
  Выполнено: { en: "Done", ko: "완료" },
  // Smart Up.
  "Аудиторский визит": { en: "Audit visit", ko: "감사 방문" },
  // Market Visit questions (also in the bot's «Frequent Problematic Questions»).
  "Торговая точка открыта?": { en: "Is the outlet open?", ko: "매장이 영업 중입니까?" },
  "Информация о характеристиках торговой точки проверена, обновлена и актуальна на момент визита?":
    {
      en: "Has the outlet profile information been checked and updated, and is it current at the time of the visit?",
      ko: "매장 특성 정보를 확인·갱신했으며 방문 시점 기준 최신입니까?",
    },
  "Какой тип оборудования KT&G установлен в торговой точке?": {
    en: "What type of KT&G equipment is installed in the outlet?",
    ko: "매장에 설치된 KT&G 집기 유형은 무엇입니까?",
  },
  "Подсветка оборудования KT&G включена?": {
    en: "Is the KT&G equipment lighting on?",
    ko: "KT&G 집기 조명이 켜져 있습니까?",
  },
  "У вас есть контактные данные владельца/менеджера торговой точки и он знает, что и зачем вы делаете во время визита?":
    {
      en: "Do you have the contact details of the outlet owner/manager, and do they know what you do during the visit and why?",
      ko: "매장 점주/관리자의 연락처가 있으며, 점주/관리자가 방문 중 하는 일과 그 목적을 알고 있습니까?",
    },
  "Цена на полке на продукцию KT&G соответствует рекомендованной цене?": {
    en: "Does the shelf price of KT&G products match the recommended price?",
    ko: "KT&G 제품의 진열 가격이 권장 가격과 일치합니까?",
  },
  "Соблюдаются ли условия контракта по наличию обязательного ассортимента KT&G?": {
    en: "Are the contract terms on the mandatory KT&G assortment being met?",
    ko: "KT&G 필수 품목 구비에 관한 계약 조건이 지켜지고 있습니까?",
  },
  "Выставлен ли весь обязательный ассортимент KT&G на витрине, видимой потребителям?": {
    en: "Is the entire mandatory KT&G assortment displayed in a showcase visible to consumers?",
    ko: "KT&G 필수 품목 전체가 소비자에게 보이는 진열대에 진열되어 있습니까?",
  },
  "Все необходимые документы от торговой точки (для оплаты со стороны KT&G за последний период) были предоставлены?":
    {
      en: "Has the outlet provided all the required documents (for KT&G's payment for the last period)?",
      ko: "매장이 필요한 서류(직전 기간 KT&G 지급용)를 모두 제출했습니까?",
    },
  "Установлены ли актуальные вставки в оборудование KT&G?": {
    en: "Are current inserts installed in the KT&G equipment?",
    ko: "KT&G 집기에 최신 인서트가 설치되어 있습니까?",
  },
  "Установлены ли временные POSM-материалы KT&G?": {
    en: "Are temporary KT&G POSM materials installed?",
    ko: "KT&G 임시 POSM 자재가 설치되어 있습니까?",
  },
  "Установлены ли фирменные ценники KT&G с актуальными на момент визита ценами?": {
    en: "Are KT&G branded price tags with prices current at the time of the visit in place?",
    ko: "방문 시점 기준 최신 가격이 적힌 KT&G 전용 가격표가 부착되어 있습니까?",
  },
  "Оборудование KT&G в чистом состоянии на момент завершения визита?": {
    en: "Is the KT&G equipment clean at the end of the visit?",
    ko: "방문 종료 시점에 KT&G 집기가 청결한 상태입니까?",
  },
  "Передача лифлетов/«пирамидка» продавцам": {
    en: "Leaflets/«pyramid» handed over to sellers",
    ko: "판매원에게 리플릿/«피라미드» 전달",
  },
  "Имеется ли PET?": { en: "Is there a PET?", ko: "PET이 있습니까?" },
};

// The Russian words inside equipment names: «M (9*6) POSI (Корейский белый)».
const EQUIPMENT_WORDS: { ru: RegExp; en: string; ko: string }[] = [
  { ru: /\(\s*Корейский белый\s*\)/giu, en: "(Korean white)", ko: "(한국산 흰색)" },
  { ru: /\(\s*Казахский металлический\s*\)/giu, en: "(Kazakh metal)", ko: "(카자흐산 금속)" },
  { ru: /\(\s*Китайский пластмассовый\s*\)/giu, en: "(Chinese plastic)", ko: "(중국산 플라스틱)" },
];

// Smart Up comments are bilingual: «Торговая точка была закрыта на момент визита ( The outlet was
// closed at the visit time )». English takes the part in brackets; Korean translates the known ones
// and otherwise takes the English part too.
const BILINGUAL =
  /^([^()]*\p{Script=Cyrillic}[^()]*?)\s*\(\s*([^()\p{Script=Cyrillic}]*\p{Script=Latin}[^()\p{Script=Cyrillic}]*?)\s*\)$/u;
const COMMENTS_KO: { en: RegExp; ko: string }[] = [
  { en: /temporar\w*\s+closed/i, ko: "매장 임시 휴업" },
  { en: /closed\s+at\s+the\s+(time\s+of\s+the\s+)?visit/i, ko: "방문 시 매장 휴무" },
  { en: /refus\w*\s+(to\s+)?cooperat/i, ko: "협력 거부" },
  { en: /no\s+responsible\s+person/i, ko: "담당자 부재" },
  { en: /(does\s+not|doesn't|do\s+not|not)\s+sell\w*\s+cigarettes/i, ko: "담배 미판매" },
  { en: /audit\s+visit/i, ko: "감사 방문" },
];

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

// One value without splitting it: a known value, a bilingual comment, an equipment name.
function translateOne(text: string, lang: "en" | "ko"): string | null {
  const known = KNOWN[text];
  if (known) return known[lang];
  const bilingual = BILINGUAL.exec(text);
  if (bilingual) {
    const english = tidy(bilingual[2]!);
    if (lang === "en") return english;
    return COMMENTS_KO.find((c) => c.en.test(english))?.ko ?? english;
  }
  let changed = text;
  for (const word of EQUIPMENT_WORDS) changed = changed.replace(word.ru, word[lang]);
  return changed === text ? null : changed;
}

// «A, B» split at the commas outside brackets: equipment lists, combined comments.
function splitList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map(tidy).filter(Boolean);
}

function translate(text: string, lang: "en" | "ko"): string | null {
  const whole = translateOne(text, lang);
  if (whole !== null) return whole;
  // A problem with its answer: «<question> — <answer>».
  const dash = text.indexOf(" — ");
  if (dash > 0) {
    const [head, tail] = [text.slice(0, dash), text.slice(dash + 3)];
    const [a, b] = [translate(tidy(head), lang), translate(tidy(tail), lang)];
    if (a !== null || b !== null) return `${a ?? tidy(head)} — ${b ?? tidy(tail)}`;
  }
  const parts = splitList(text);
  if (parts.length > 1) {
    const done = parts.map((part) => translateOne(part, lang));
    if (done.some((part) => part !== null))
      return done.map((part, i) => part ?? parts[i]).join(", ");
  }
  return null;
}

// A data value for a file in `lang`: translated when known, otherwise as it came.
export function localizeData<T extends string | null | undefined>(
  value: T,
  lang: ExportLocale = currentExportLocale(),
): T | string {
  if (lang === "ru" || !value) return value;
  const text = tidy(value);
  return translate(text, lang) ?? value;
}
