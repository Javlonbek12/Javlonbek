import { ATTENTION_SHOWN } from "./attention";
import { PATH_STORES_SHOWN } from "./oos-path";
import { RECOVERY_STORES_SHOWN } from "./recovery";

// How many rows of each list the page shows — and so the first sheet of the Excel file, which is
// the page (xlsx-page.ts): the rest of a list is on its own sheet. One place, so the two never
// cut a list differently.
export const SHOWN = {
  // A table without a limit of its own.
  table: 50,
  attention: ATTENTION_SHOWN,
  worst: 5,
  regions: 30,
  people: 100,
  // «Маршруты и дисциплина».
  calendar: { exec: 20, manager: 40 },
  matrixOrganizations: 30,
  ranking: 15,
  organizations: 40,
  zones: 100,
  missed: 30,
  noOrder: 30,
  // «Продажи по зонам».
  zoneSales: { exec: 20, manager: 40, executor: 1 },
  idle: 30,
  // «Восстановление наличия» and the distributor's orders after an OOS.
  recovery: 15,
  recoveryStores: RECOVERY_STORES_SHOWN,
  recoverySkus: 6,
  followUp: 15,
  // «Путь OOS».
  path: { exec: 20, manager: 40, executor: 40 },
  pathGroups: 30,
  pathStores: PATH_STORES_SHOWN,
  pathSkus: 4,
  equipment: 12,
  ismWaiting: 15,
  // An executor's own lists.
  own: 100,
} as const;
