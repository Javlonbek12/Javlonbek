import type { Locale } from "@/lib/i18n";

// The section's instruction, in the order of the work. Plain data: the page lays it out; a step
// with `href` links to where it is done.

export type GuideStep = { title: string; text: string[]; href?: string };
export type GuidePart = { id: string; title: string; intro?: string; steps: GuideStep[] };

const ru: GuidePart[] = [
  {
    id: "start",
    title: "Перед первой кампанией",
    intro:
      "Справочники заполняются один раз и потом только обновляются. Без них система не знает, сколько оборудования и какого размера печать.",
    steps: [
      {
        title: "Загрузите файл оборудования",
        href: "/equipment/uploads",
        text: [
          "«Оборудование» → «Загрузки» → «Файл оборудования». Нужен файл «Daily BW-POG management» (.xlsx).",
          "Это единственный источник количества и региона. Из листа «BW management» берётся каждая единица оборудования: регион, ID точки (Smartup ID), название, ИНН, тип. Display MOD считается как слоты / 18 — везде в этих единицах, как в самом файле.",
          "Строка без Smartup ID, но с ИНН или названием, учитывается («Без ID»); без ID, ИНН и названия — пропускается с причиной («Оборудование → Проверка точек»).",
          "Из блока «Current stock» на листе «Warehouse» берётся оборудование на складах. Лист демонтажа не читается.",
          "Сразу после загрузки — контрольная таблица «закуплено / установлено / склад / неучтённое». Если где-то минус, файл не сохраняется, пока вы не подтвердите.",
          "Новый файл заменяет прежнее оборудование; кампании, отгрузки и журнал закупок не меняются.",
        ],
      },
      {
        title: "Загрузите базу точек",
        href: "/equipment/uploads",
        text: [
          "Там же («Оборудование» → «Загрузки») → «База точек». Нужны колонки «ИД» и «Responsible TSM».",
          "Из неё берётся только «ID → TSM»: по ней доля региона делится между TSM. TSM не хранится в оборудовании — новая база сразу пересчитывает разбивку.",
          "Оборудование точек без TSM в базе (или без ID) — в строке «TSM не назначен» своего региона: оно учтено и получает POSM, на склад региона не уходит.",
          "После загрузки видно, сколько точек BW-файла нет в базе и у скольких регион в базе другой (только для сведения: регион всегда из BW-файла).",
        ],
      },
      {
        title: "Проверьте размеры и цены",
        href: "/equipment/sizes",
        text: [
          "«Оборудование» → «Размеры». Размеры оборудования уже заполнены по таблице KT&G; для Display MOD, Lightbox и Support впишите их сами.",
          "У каждого элемента (Header, Shelftalker, Divider, Ценник…) для каждого оборудования свои: размер печати (высота × ширина, мм), штук на единицу и цена за штуку (сум с НДС). Печать отличается даже у оборудования одного размера — проверяйте каждую пару.",
          "«Шт на ед.» = 0 — элемент на этом оборудовании не используется.",
          "Нажмите на название элемента, чтобы изменить его размеры. Вверху страницы элемента печать нарисована на оборудовании в масштабе; красным — печать шире оборудования.",
          "Можно заполнить файлом: «Excel: что заполнить» → заполните жёлтые ячейки → загрузите обратно. Новые элементы (например, Wobbler) добавляются там же.",
          "Размеры, взятые из старого списка, помечены «размер не подтверждён». Сохранение размера вручную или файлом его подтверждает.",
        ],
      },
    ],
  },
  {
    id: "campaign",
    title: "Кампания по шагам",
    intro:
      "Вкладка «Кампании» → «Новая кампания»: название (например, «Pine Purple 4 SKU») и описание. Дальше всё на странице кампании. Шаги вверху загораются зелёным сами, когда выполнены. Страница открывается на текущем шаге; остальные свёрнуты в строку с итогом («заказано 20 окт.», «подтверждено 8 из 10») — «Открыть» разворачивает шаг.",
    steps: [
      {
        title: "1. Концепт",
        text: [
          "Описание, файлы концепта, связь с проектом из раздела «Проекты» (если работа над концептом идёт там задачами и этапами).",
          "Когда концепт утверждён — отметьте «Концепт утверждён» и сохраните.",
        ],
      },
      {
        title: "2. Key visual",
        text: [
          "Загрузите варианты key visual (картинки или PDF) и нажмите «Сделать финальным» у выбранного.",
        ],
      },
      {
        title: "3. Оборудование и элементы",
        text: [
          "Вид «На оборудовании»: каждое оборудование нарисовано в масштабе. Под рисунком — кнопки элементов: нажмите, и элемент встанет на оборудование. Видны размер печати, штук на единицу и сколько заказать.",
          "У каждого элемента своё оборудование: например, Header на POSI XL, L, M, Metawerk L, DG L, M, а Shelftalker — на другом наборе. Ценники — по желанию.",
          "Количество оборудования — всё, без разницы, где оно стоит: установленное плюс склады (галочка «Учитывать оборудование на складах»).",
          "Штук на единицу можно поменять для этой кампании (одна или несколько — по ситуации); пустое поле — значение из каталога.",
          "«всё оборудование / снять» — отметить элемент сразу на всём оборудовании или убрать.",
          "Красный «!» — печать шире оборудования, проверьте размер. «?» — размер или штук на единицу не заполнены в каталоге.",
          "Вид «Списком» — то же самое галочками.",
        ],
      },
      {
        title: "4. Запас",
        text: [
          "Процент запаса: +10 %, +15 %, +20 % или свой. Количество = единицы оборудования × штук на единицу + запас, округлено вверх.",
          "Запас остаётся на центральном складе; в регионы уходит количество по оборудованию.",
          "Нажмите «Сохранить и сформировать список».",
        ],
      },
      {
        title: "5. Список",
        text: [
          "Элемент | оборудование | размер печати | материал | единиц оборудования | шт на ед. | количество | цена | сумма.",
          "Оборудование с одинаковым размером печати, количеством и ценой объединяется в одну строку.",
          "«Список в Excel» — файл для типографии.",
          "Пока кампания не заказана, состав можно менять и формировать список заново: подтверждённые цены сохраняются.",
        ],
      },
      {
        title: "6. Цены типографии",
        text: [
          "Типография даёт новые цены или подтверждает старые. Введите цену за штуку (сум с НДС) и отметьте «подтвердить».",
          "Укажите типографию, номер и дату КП, приложите файлы КП.",
          "Подтверждённая цена записывается в каталог и в историю цен — в следующей кампании она уже будет.",
        ],
      },
      {
        title: "7. EAS и заказ",
        text: [
          "«Сформировать EAS»: документ собирается из кампании — запрошенная сумма, остаток бюджета, Coverage, сводка POSM по группам, итоговый запрос, вложения.",
          "Заполните поля бюджета (в следующей кампании они подставятся сами), Background, Purpose, Expected benefits, назначение групп POSM и типографии для сравнения — разница с самой дешёвой считается сама.",
          "«Скопировать» и вставьте в EAS — таблицы сохранятся. Или скачайте для Word, или распечатайте в PDF.",
          "Когда заказали в типографии — «Отметить: заказано» с датой. После этого список не меняется (отметку можно снять до первой отгрузки).",
        ],
      },
      {
        title: "8. Распределение по регионам и TSM",
        href: "/distribution/plan",
        text: [
          "«Открыть распределение» на странице кампании, или вкладка «Распределение». Кампания выбирается вверху вкладок «Распределение», «Отгрузки» и «Анализ»; по умолчанию открыта идущая (заказанная и не закрытая) кампания, черновик — только если заказанных нет.",
          "Доля региона = его оборудование нужных типов; округление вниз, остаток — на центральном складе.",
          "«Разбивка по TSM»: доля региона делится между его TSM по их оборудованию (оборудование без TSM в базе — строка «TSM не назначен»); доля складского оборудования и остаток от округления — на складе региона.",
          "«Отгрузки»: «Кому что отправить» — каждый регион и TSM с планом, отгруженным, остатком и статусом (не начато, частично, готово, сверх плана), фильтры «Осталось отправить» и «Сверх плана», кнопка «Накладная». Ниже — отдельная отгрузка строкой, склад и журнал, сгруппированный по накладным.",
          "Накладная: количество в строке можно уменьшить (частичная отгрузка); «Записать отгрузку» даёт накладной номер и открывает её как документ — номер, дата, кампания, строки, места для подписей «Отпустил» и «Получил». Печатается на листе A4 альбомной ориентации без меню.",
          "Excel со всей разбивкой — кнопка «Excel» на вкладке «Анализ».",
        ],
      },
      {
        title: "9. Замена в магазинах",
        text: [
          "Система сама знает, в каких точках стоит оборудование из состава кампании (по файлу оборудования), и с каким TSM.",
          "«Список точек (Excel)» → в колонке «Заменено» поставьте «да» или «нет» → загрузите файл обратно. Пустая отметка не меняет точку. Загружать могут все, у кого есть раздел.",
          "Видно, сколько точек заменено — всего, по регионам и по TSM («По TSM»).",
          "Загружайте файл по мере замены — цифры обновляются.",
        ],
      },
    ],
  },
  {
    id: "more",
    title: "Ещё",
    steps: [
      {
        title: "Анализ",
        href: "/distribution",
        text: [
          "Вкладка «Анализ»: главное по выбранной кампании — дефициты по норме, оборудование без позиций, ценники по планограммам, регионы, контроль по позициям.",
        ],
      },
      {
        title: "Оборудование (отдельный пункт меню)",
        href: "/equipment",
        text: [
          "«Карта»: Узбекистан по регионам — сколько установлено, на складах и в скольких точках; нажмите на регион, чтобы открыть его.",
          "Страница региона: оборудование по типам с моделями, по TSM, склад.",
          "«Типы оборудования»: каждый тип — модель в масштабе, размеры, слоты, сколько установлено и где больше всего, и его модель в «Планограммах» (связь меняется в «Оборудование → Справочник → Модели»; без модели — кнопка «Связать с моделью»). Типы без оборудования свёрнуты в «Ещё типов без оборудования».",
          "«Контроль»: по каждому типу Закуплено = Установлено + На складе + Неучтённое. Неучтённое — разница, не вводится: небольшой плюс — норма, большой плюс (больше 5% закупки) — что-то не внесли на склад, минус — ошибка в файле (дубли или неубранный демонтаж). Ниже — журнал закупок: вносится вручную (тип или группа типов, количество, дата, документ) или загрузкой шаблона запуска POSM («Распределение POSM → Шаблон запуска», лист «Parameters»); исправление — строкой с минусом. Группа (например, Display L = DG L + Metawerk L) проверяется целиком.",
          "«Проверка точек» (число на вкладке — сколько всего): точки с ID, которых нет в базе (с датой появления в файле), точки без ID, пропущенные строки с причиной и точки, у которых регион в базе другой. «Excel для базы точек» — все четыре списка файлом для того, кто ведёт базу. Если что-то есть, на «Карте» сверху плашка «Требует внимания».",
          "На «Карте», в регионе, в «Контроле» и в «Проверке точек» вверху строка «Данные: файл оборудования от … (загрузил …) · база точек от …»; если файлу больше 7 дней — она жёлтая.",
          "«Таблицы»: оборудование по регионам, база для распределения, регионы по TSM, связь с планограммами; переключатель «Учитывать оборудование на складах».",
        ],
      },
      {
        title: "Кампании: закрыть, удалить, другие способы",
        href: "/distribution/campaigns",
        text: [
          "Закрытая кампания остаётся в истории и не меняется; вернуть в работу можно в списке кампаний.",
          "Удалить можно только кампанию без отгрузок.",
          "«Другие способы»: создать кампанию из файла со списком POSM или копией прошлой (позиции и настройки те же, «на складе» = остаток прошлой).",
        ],
      },
      {
        title: "Кто что может",
        text: [
          "Все, у кого есть раздел: смотрят всё, записывают отгрузки, загружают отметки о замене.",
          "Владелец и руководители: создают и меняют кампании, загружают файлы оборудования и базы, меняют размеры и цены.",
          "Кому виден раздел, решает владелец: «Настройки → Роли и доступ».",
        ],
      },
    ],
  },
];

const en: GuidePart[] = [
  {
    id: "start",
    title: "Before the first campaign",
    intro:
      "The reference data is filled in once and then only updated. Without it the system doesn't know how much equipment there is and what size the prints are.",
    steps: [
      {
        title: "Upload the equipment file",
        href: "/equipment/uploads",
        text: [
          "“Equipment” → “Uploads” → “Equipment file”. The “Daily BW-POG management” file (.xlsx).",
          "It is the only source of quantities and regions. Every unit comes from the “BW management” sheet: region, outlet ID (Smartup ID), name, TIN, type. Display MOD counts as its slots / 18 — in these units everywhere, as in the file itself.",
          "A row without a Smartup ID but with a TIN or a name is counted (“Without an ID”); one with neither an ID, a TIN nor a name is skipped with its reason (“Equipment → Outlet check”).",
          "Warehouse equipment comes from the “Current stock” block of the “Warehouse” sheet. The dismantling sheet is not read.",
          "Right after the upload you see the “bought / installed / in stock / unaccounted” table. With a minus anywhere the file is not saved until you confirm.",
          "A new file replaces the equipment; campaigns, shipments and the purchase journal don't change.",
        ],
      },
      {
        title: "Upload the outlet base",
        href: "/equipment/uploads",
        text: [
          "Same page (“Equipment” → “Uploads”) → “Outlet base”. The “ИД” and “Responsible TSM” columns are needed.",
          "Only “ID → TSM” is taken from it: a region's share is split between TSMs by it. The TSM is not stored with the equipment — a new base re-splits at once.",
          "Equipment of outlets without a TSM in the base (or without an ID) is the region's «TSM не назначен» (no TSM) row: counted and getting POSM, never sent to the region's warehouse.",
          "After the upload you see how many outlets of the BW file the base lacks and how many have another region there (for information only: the region always comes from the BW file).",
        ],
      },
      {
        title: "Check sizes and prices",
        href: "/equipment/sizes",
        text: [
          "“Equipment” → “Sizes”. Equipment dimensions are filled in from the KT&G table; enter Display MOD, Lightbox and Support yourself.",
          "Every element (Header, Shelftalker, Divider, price tag…) has, on every equipment, its own print size (height × width, mm), pieces per unit and price per piece (UZS incl. VAT). Prints differ even on equipment of the same size — check every pair.",
          "Pieces per unit = 0 — the element isn't used on that equipment.",
          "Click an element's name to change its sizes. Its page draws the print on each display to scale; red — wider than the display.",
          "Or by file: “Excel: to fill in” → fill the yellow cells → upload it back. New elements (e.g. Wobbler) are added there too.",
          "Sizes taken from an old list are marked “size not confirmed”. Saving a size by hand or from the file confirms it.",
        ],
      },
    ],
  },
  {
    id: "campaign",
    title: "A campaign step by step",
    intro:
      "“Campaigns” tab → “New campaign”: a name (e.g. “Pine Purple 4 SKU”) and a description. The rest is on the campaign page. The steps on top turn green by themselves when done. The page opens on the current step; the others are folded into a line with their result (“ordered 20 Oct”, “8 of 10 confirmed”) — “Open” unfolds a step.",
    steps: [
      {
        title: "1. Concept",
        text: [
          "Description, concept files, a link to a project in “Projects” (if the concept is worked on there in tasks and phases).",
          "When it is approved, tick “Concept approved” and save.",
        ],
      },
      {
        title: "2. Key visual",
        text: [
          "Upload the key visual options (pictures or PDF) and press “Make final” on the chosen one.",
        ],
      },
      {
        title: "3. Equipment and elements",
        text: [
          "“On the equipment” view: every display is drawn to scale. Under it are the element buttons: press one and the element goes on the display. You see the print size, pieces per unit and how many to order.",
          "Every element has its own equipment: e.g. Header on POSI XL, L, M, Metawerk L, DG L, M, and Shelftalker on another set. Price tags if needed.",
          "Equipment counts are all of it, wherever it is: installed plus warehouses (“Count equipment in warehouses”).",
          "Pieces per unit can be changed for this campaign; empty — the catalog's value.",
          "“all equipment / clear” puts an element on all equipment at once or removes it.",
          "A red “!” — the print is wider than the display. “?” — the size or pieces per unit are missing in the catalog.",
          "“As a list” — the same with checkboxes.",
        ],
      },
      {
        title: "4. Reserve",
        text: [
          "The reserve: +10%, +15%, +20% or your own. Quantity = equipment units × pieces per unit + reserve, rounded up.",
          "The reserve stays at the central warehouse; the regions get the quantity by equipment.",
          "Press “Save and make the list”.",
        ],
      },
      {
        title: "5. List",
        text: [
          "Element | equipment | print size | material | equipment units | pcs per unit | quantity | price | total.",
          "Equipment with the same print size, pieces and price is merged into one line.",
          "“List in Excel” — the file for the printer.",
          "Until the campaign is ordered, the items can change and the list be made again; confirmed prices stay.",
        ],
      },
      {
        title: "6. The printer's prices",
        text: [
          "The printer gives new prices or confirms the old ones. Enter the price per piece (UZS incl. VAT) and tick “confirm”.",
          "Enter the printer, quote number and date; attach the quote files.",
          "A confirmed price goes to the catalog and the price history — the next campaign has it already.",
        ],
      },
      {
        title: "7. EAS and the order",
        text: [
          "“Make the EAS”: the document is built from the campaign — requested amount, remaining budget, coverage, POSM summary by group, final request, attachments.",
          "Fill in the budget fields (the next campaign takes them over), Background, Purpose, Expected benefits, the purpose of each POSM group and the printers compared — the difference to the lowest is counted.",
          "“Copy” and paste into the EAS — the tables stay. Or download it for Word, or print to PDF.",
          "When ordered from the printer — “Mark as ordered” with the date. The list doesn't change after that (the mark can be undone before the first shipment).",
        ],
      },
      {
        title: "8. Split by region and TSM",
        href: "/distribution/plan",
        text: [
          "“Open the distribution” on the campaign page, or the “Distribution” tab. The campaign is picked at the top of the “Distribution”, “Shipments” and “Analysis” tabs; the running (ordered, not closed) campaign opens by default, a draft only when none was ordered.",
          "A region's share = its equipment of the matching types; rounded down, the rest at the central warehouse.",
          "“Breakdown by TSM”: a region's share is split between its TSMs by their equipment (equipment without a TSM in the base is the «TSM не назначен» row); the warehouse equipment's share and the rounding rest stay at the region's warehouse.",
          "“Shipments”: “Who gets what” — every region and TSM with the plan, what was shipped, what is left and a status (not started, partly, done, over the plan), the “Still to send” and “Over the plan” filters and a “Waybill” button. Below: a single shipment line, the warehouse and the log grouped by waybill.",
          "A waybill: a line's quantity can be lowered (a partial shipment); “Record the shipment” gives it a number and opens it as a document — number, date, campaign, lines and places to sign “Issued by” and “Received by”. It prints on a landscape A4 sheet without the menus.",
          "Excel with the whole split — the “Excel” button on the “Analysis” tab.",
        ],
      },
      {
        title: "9. Replacement in the shops",
        text: [
          "The system knows which outlets have the campaign's equipment (from the equipment file) and their TSM.",
          "“List of outlets (Excel)” → put “yes” or “no” in the “Заменено” column → upload it back. An empty mark leaves the outlet as it was. Everyone with the section can upload.",
          "You see how many outlets are replaced — in total, by region and by TSM (“By TSM”).",
          "Upload the file as the replacement goes — the numbers update.",
        ],
      },
    ],
  },
  {
    id: "more",
    title: "More",
    steps: [
      {
        title: "Analysis",
        href: "/distribution",
        text: [
          "“Analysis” tab: the main points of the chosen campaign — norm deficits, equipment without items, price tags by planograms, regions, item checks.",
        ],
      },
      {
        title: "Equipment (its own menu item)",
        href: "/equipment",
        text: [
          "“Map”: Uzbekistan by region — installed, in warehouses and in how many outlets; click a region to open it.",
          "A region's page: equipment by type with the models, by TSM, the warehouse.",
          "“Equipment types”: every type — a to-scale model, dimensions, slots, how many are installed and where most are, and its model in “Planograms” (the link is set in “Equipment → Reference → Models”; without one — the “Link a model” button). Types without equipment are folded into “More types without equipment”.",
          "“Control”: per type, Bought = Installed + In stock + Unaccounted. Unaccounted is the difference, never entered: a small plus is normal, a large plus (over 5% of the purchase) means something was not entered in the warehouse, a minus is an error in the file (duplicates or dismantling not removed). Below is the purchase journal: entered by hand (a type or a group of types, quantity, date, document) or by uploading a POSM launch template (“POSM distribution → Launch template”, the “Parameters” sheet); a correction is a line with a minus. A group (e.g. Display L = DG L + Metawerk L) is checked as a whole.",
          "“Outlet check” (the number on the tab is the total): outlets with an ID the base lacks (with the date they appeared in the file), outlets without an ID, skipped rows with the reason, and outlets with another region in the base. “Excel for the outlet base” — all four lists as a file for whoever keeps the base. When anything is there, the “Map” shows a “Needs attention” bar on top.",
          "The “Map”, a region, the “Control” and the “Outlet check” start with “Data: equipment file of … (uploaded by …) · outlet base of …”; when the file is over 7 days old the line is amber.",
          "“Tables”: equipment by region, the base for the split, regions by TSM, the link to planograms; the “Count equipment in warehouses” switch.",
        ],
      },
      {
        title: "Campaigns: close, delete, other ways",
        href: "/distribution/campaigns",
        text: [
          "A closed campaign stays in the history and doesn't change; reopen it in the list.",
          "Only a campaign without shipments can be deleted.",
          "“Other ways”: a campaign from a POSM list file or a copy of a past one (same items and settings, “in stock” = what is left of it).",
        ],
      },
      {
        title: "Who can do what",
        text: [
          "Everyone with the section: sees everything, records shipments, uploads replacement marks.",
          "The owner and managers: create and change campaigns, upload the equipment file and the base, change sizes and prices.",
          "Who sees the section is set by the owner: “Settings → Roles and access”.",
        ],
      },
    ],
  },
];

export const distributionGuide = (locale: Locale): GuidePart[] => (locale === "en" ? en : ru);
