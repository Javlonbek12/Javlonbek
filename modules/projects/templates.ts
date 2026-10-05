// Project templates: ready-made phases, tasks (with dates counted from the project's anchor day)
// and, for some, a written plan with sections. The owner picks one when creating a project and
// then adjusts the plan to the project.

export type TemplateTask = {
  code: string;
  title: string;
  responsible: string;
  // Days from the anchor day (negative = before it).
  start: number;
  due: number;
  result?: string;
  milestone?: boolean;
  dependsOn?: string[];
};

export type ProjectTemplate = {
  key: string;
  name: string;
  description: string;
  // What the anchor day means; null = the template has no dated tasks.
  anchor: string | null;
  phases: { title: string; due: number; tasks: TemplateTask[] }[];
  // Sections of the written plan, with what each one must state.
  sections: { key: string; title: string; hint: string }[];
};

const W = 7;

// From "Этапы подготовки и запуска продукта" (based on the PINE Launch Plan, April 2026).
// T = the first day of sales.
const LAUNCH: ProjectTemplate = {
  key: "launch",
  name: "Запуск продукта",
  description:
    "Подготовка товара, систем, команды и документов, запуск, контроль исполнения и закрытие расходов — от T−12 недель до T+3 месяцев.",
  anchor: "Дата начала продаж (T)",
  phases: [
    {
      title: "Подготовка: продукт, данные и Launching Plan",
      due: -4 * W,
      tasks: [
        {
          code: "L01",
          title:
            "Зафиксировать состав продукта, дату T, команду проекта и сроки производства / поставки",
          responsible: "Руководитель проекта + HQ",
          start: -12 * W,
          due: -8 * W,
          result: "Карточка проекта и календарь поставки",
        },
        {
          code: "L02",
          title: "Сверить характеристики SKU, макеты упаковки и обязательные документы",
          responsible: "HQ / продукт + юрист",
          start: -10 * W,
          due: -8 * W,
          result: "Утверждённые спецификации и перечень документов",
          dependsOn: ["L01"],
        },
        {
          code: "L03",
          title:
            "Актуализировать анализ рынка, цену, базу точек, прогноз и бюджет; свести цифры прошлого плана",
          responsible: "Marketing + Sales + Finance",
          start: -8 * W,
          due: -6 * W,
          result: "Единая версия исходных данных и бюджета",
          dependsOn: ["L01"],
        },
        {
          code: "L04",
          title: "Подготовить полный Launching Plan и пройти внутреннее согласование",
          responsible: "Marketing Team Lead",
          start: -8 * W,
          due: -4 * W,
          result: "Утверждённый план с владельцами и сроками",
          milestone: true,
          dependsOn: ["L03"],
        },
        {
          code: "L05",
          title: "Еженедельная встреча по готовности (в последнюю неделю — ежедневная сверка)",
          responsible: "Руководитель проекта",
          start: -8 * W,
          due: -1,
          result: "Статус, владелец и срок по каждой открытой задаче",
        },
      ],
    },
    {
      title: "Готовность: системы, материалы, товар и команда",
      due: -1,
      tasks: [
        {
          code: "L06",
          title:
            "Создать карточки SKU, цены и единицы в учётной системе и ботах; проверить отчёты на тестовых данных",
          responsible: "IT / данные + Sales",
          start: -6 * W,
          due: -3 * W,
          result: "Корректные SKU, цены и отчётность",
          dependsOn: ["L02"],
        },
        {
          code: "L07",
          title:
            "Проверить версии POSM и планограммы, спецификации, закупку, производство и доставку материалов",
          responsible: "Marketing Execution + закупки",
          start: -6 * W,
          due: -2 * W,
          result: "Принятые материалы и реестр доставки",
          dependsOn: ["L02"],
        },
        {
          code: "L08",
          title:
            "Подтвердить поставку товара, приёмку, остатки по SKU и готовность региональных складов",
          responsible: "Supply / Logistics",
          start: -4 * W,
          due: -2 * W,
          result: "Товар принят; региональные остатки подтверждены",
          dependsOn: ["L02"],
        },
        {
          code: "L09",
          title:
            "Согласовать порядок работы, документы и правила учёта активностей; подготовить инструкции команде",
          responsible: "Marketing + Finance + Sales",
          start: -3 * W,
          due: -1 * W,
          result: "Единые инструкции и правила подтверждения расходов",
          dependsOn: ["L04"],
        },
        {
          code: "L10",
          title:
            "Провести обучение: продукт, цена, оформление заказов, оборудование, отчётность и обращения",
          responsible: "Sales + Marketing",
          start: -2 * W,
          due: -1 * W,
          result: "Команда ознакомлена; ошибки тестового заказа устранены",
          dependsOn: ["L06", "L09"],
        },
        {
          code: "L11",
          title: "Провести замену материалов по графику, собрать подтверждения и закрыть дефекты",
          responsible: "Marketing Execution",
          start: -7,
          due: -2,
          result: "Реестр выполнения и список исправлений",
          dependsOn: ["L07"],
        },
        {
          code: "L12",
          title: "Решение о запуске: готовность товара, систем, команды и документов",
          responsible: "Директор + руководитель проекта",
          start: -2,
          due: -1,
          result: "Разрешение на запуск либо план устранения блокирующих проблем",
          milestone: true,
          dependsOn: ["L08", "L10", "L11"],
        },
      ],
    },
    {
      title: "Запуск и первая неделя",
      due: W,
      tasks: [
        {
          code: "L13",
          title:
            "Старт продаж: подтвердить старт в регионах; проверить первые заказы, документы, цены и остатки",
          responsible: "Sales + IT + Logistics",
          start: 0,
          due: 0,
          result: "Работающий процесс заказа и выдачи товара",
          milestone: true,
          dependsOn: ["L12"],
        },
        {
          code: "L14",
          title:
            "Ежедневно сверять статусы регионов, отгрузки, обращения и ошибки данных; владелец каждого отклонения",
          responsible: "Руководитель проекта",
          start: 0,
          due: W,
          result: "Ежедневный отчёт и реестр проблем",
          dependsOn: ["L13"],
        },
        {
          code: "L15",
          title: "Проверить исполнение POSM и планограммы по требованиям; исправить дефекты",
          responsible: "Marketing Execution",
          start: 0,
          due: W,
          result: "Подтверждение установки и закрытые дефекты",
          dependsOn: ["L13"],
        },
        {
          code: "L16",
          title:
            "Закрыть первую неделю: сверить выполнение, документы и активности с недельным сроком",
          responsible: "Marketing + Sales + Finance",
          start: W,
          due: W,
          result: "Обзор недели и подтверждённые обязательства",
          dependsOn: ["L14"],
        },
      ],
    },
    {
      title: "Контроль и закрытие",
      due: 13 * W,
      tasks: [
        {
          code: "L17",
          title:
            "Еженедельно проверять наличие товара, поставки, возвраты, повторные заказы и обратную связь",
          responsible: "Sales + Supply + данные",
          start: 2 * W,
          due: 4 * W,
          result: "Проверенные данные и задачи по отклонениям",
          dependsOn: ["L16"],
        },
        {
          code: "L18",
          title: "Обзор первого месяца: факт против целей по SKU, регионам и типам точек",
          responsible: "Marketing + Sales",
          start: 4 * W,
          due: 4 * W,
          result: "Обзор месяца с причинами расхождений",
          milestone: true,
          dependsOn: ["L17"],
        },
        {
          code: "L19",
          title:
            "Проверить подтверждения, расчёты бонусов, документы подрядчиков и фактические расходы",
          responsible: "Finance + владельцы активностей",
          start: 4 * W,
          due: 6 * W,
          result: "Реестр к оплате и сверка бюджета",
          dependsOn: ["L18"],
        },
        {
          code: "L20",
          title:
            "Проверить регулярность заказов, запасы и качество данных; обновить прогноз поставок",
          responsible: "Supply + Sales + Finance",
          start: 8 * W,
          due: 9 * W,
          result: "Актуальный прогноз и план устранения проблем",
          dependsOn: ["L18"],
        },
        {
          code: "L21",
          title: "Итоговый обзор и передача процессов в регулярную работу",
          responsible: "Руководитель проекта + директор",
          start: 12 * W,
          due: 13 * W,
          result: "Закрытие проекта, выводы и постоянные владельцы",
          milestone: true,
          dependsOn: ["L19", "L20"],
        },
      ],
    },
  ],
  sections: [
    {
      key: "product",
      title: "1. Продукт",
      hint: "Список SKU, характеристики, упаковка, коды и единицы измерения.",
    },
    {
      key: "data",
      title: "2. Исходные данные",
      hint: "Актуальный анализ рынка и причины запуска; исходная база и период данных.",
    },
    {
      key: "price",
      title: "3. Цена",
      hint: "Цена в системе, утверждённые условия и сроки действия; порядок изменения.",
    },
    {
      key: "targets",
      title: "4. Цели",
      hint: "Цели из бизнес-плана по SKU, регионам, каналам и месяцам; формулы расчёта (единицы: пачки / блоки / короба).",
    },
    {
      key: "supply",
      title: "5. Поставка",
      hint: "План производства, приёмки, региональных остатков и ответственность за поставку.",
    },
    {
      key: "materials",
      title: "6. Материалы",
      hint: "Реестр утверждённых версий упаковки, POSM и планограммы; количество и сроки доставки.",
    },
    {
      key: "activities",
      title: "7. Условия активностей",
      hint: "Согласованные активности (механики, бонусы, мотивация), сроки, участники, подтверждения и порядок расчёта — без двойного учёта.",
    },
    {
      key: "budget",
      title: "8. Бюджет",
      hint: "Единый перечень затрат, лимиты, основания оплаты и согласующие; отдельный учёт товара и материалов.",
    },
    {
      key: "execution",
      title: "9. Исполнение",
      hint: "Timeline, владельцы, обучение, готовность систем, решение о старте и порядок эскалации.",
    },
    {
      key: "control",
      title: "10. Контроль",
      hint: "Источники данных, частота отчётов, проверки качества, обзоры месяцев 1–3 и закрытие затрат.",
    },
    {
      key: "kpi",
      title: "Контрольные показатели",
      hint: "Листинг по SKU, поставки и наличие, продажи и повтор, исполнение материалов, затраты — и как каждый проверять (sell-in ≠ sell-out).",
    },
  ],
};

const BLANK: ProjectTemplate = {
  key: "blank",
  name: "Пустой проект",
  description: "Без фаз и задач — план строится с нуля.",
  anchor: null,
  phases: [],
  sections: [],
};

export const TEMPLATES: ProjectTemplate[] = [BLANK, LAUNCH];

export const templateByKey = (key: string | null | undefined) =>
  TEMPLATES.find((tpl) => tpl.key === key) ?? null;
