import { RULES, type Finding, type RuleId } from "./findings";

// The month of S&OP: what is done around which day, and the nine points to tick before the
// cycle is closed. The texts are in the dictionary (sop.calendar.*, sop.checklist.*).

// The day of the month each step starts on (the days are «around»: HQ moves them a little).
export const CALENDAR_STEPS = [
  { key: "newFile", day: 3 },
  { key: "closeMonth", day: 5 },
  { key: "send", day: 9 },
  { key: "agenda", day: 12 },
  { key: "meetings", day: 17 },
  { key: "final", day: 20 },
] as const;
export type CalendarStepKey = (typeof CALENDAR_STEPS)[number]["key"];

// Which step today falls on: the last one that has started («now»); before the first one of the
// month — the first, as the next thing to do.
export function currentStep(dayOfMonth: number): { key: CalendarStepKey; state: "now" | "next" } {
  const started = CALENDAR_STEPS.filter((step) => step.day <= dayOfMonth).at(-1);
  return started
    ? { key: started.key, state: "now" }
    : { key: CALENDAR_STEPS[0].key, state: "next" };
}

export const CHECKLIST_ITEMS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];

export const isChecklistItem = (value: unknown): value is ChecklistItem =>
  typeof value === "number" && (CHECKLIST_ITEMS as readonly number[]).includes(value);

// The ticks of a cycle as they are stored (SopCycle.checklist): the point → who ticked it, when.
export type ChecklistState = Partial<Record<`${ChecklistItem}`, { by: string; at: string }>>;

export function parseChecklist(saved: unknown): ChecklistState {
  const state: ChecklistState = {};
  if (!saved || typeof saved !== "object") return state;
  for (const item of CHECKLIST_ITEMS) {
    const value = (saved as Record<string, unknown>)[String(item)];
    if (value && typeof value === "object") {
      const { by, at } = value as { by?: unknown; at?: unknown };
      if (typeof by === "string" && typeof at === "string") state[`${item}`] = { by, at };
    }
  }
  return state;
}

// The rules whose findings belong to a point of the checklist.
export const checklistRules = (item: ChecklistItem): RuleId[] =>
  (Object.keys(RULES) as RuleId[]).filter((rule) => RULES[rule].checklist === item);

// How many findings that nobody marked yet stand behind each point.
export function checklistCounts(
  findings: Finding[],
  marked: ReadonlySet<string>,
): Record<ChecklistItem, number> {
  const counts = Object.fromEntries(CHECKLIST_ITEMS.map((item) => [item, 0])) as Record<
    ChecklistItem,
    number
  >;
  for (const finding of findings) {
    const item = RULES[finding.rule].checklist;
    if (item !== null && isChecklistItem(item) && !marked.has(finding.key)) counts[item]++;
  }
  return counts;
}
