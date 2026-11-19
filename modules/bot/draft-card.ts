import { formatDay } from "@/lib/dates";
import type { DraftStep } from "@/modules/tasks/draft-steps";
import type { TaskPriority } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";

import type { TelegramButton } from "./keyboard";

// A task waiting in the confirmation card.
export type DraftTask = {
  title: string;
  // null = the speaker themselves: a team task on themselves, or a personal one if `personal`.
  assigneeId: string | null;
  personal?: boolean;
  // The name as the user said it, when it is not resolved yet.
  saidName: string | null;
  unresolved: boolean;
  // People to offer when the name matched several (empty = offer everyone).
  candidateIds: string[];
  dueDate: string | null;
  priority: TaskPriority | null;
  project: string | null;
  // The task written out by the AI: description (what / why / done when / materials), steps, and
  // questions about what it still lacks (shown on the card, never saved). Absent in older drafts.
  description?: string | null;
  steps?: DraftStep[];
  missing?: string[];
};

// meetingId: set when the tasks come from meeting minutes.
export type DraftPayload = { tasks: DraftTask[]; meetingId?: string };

type Person = { id: string; firstName: string; lastName: string | null };

const name = (p: { firstName: string; lastName: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(" ");

// A card longer than this drops the written-out parts (a Telegram message holds 4096 characters).
const MAX_CARD_TEXT = 3500;

// routes: what will happen to each task (routing v2), shown under it before saving.
export function renderCardText(
  payload: DraftPayload,
  people: Person[],
  routes: string[] = [],
): string {
  const full = cardText(payload, people, routes, true);
  return full.length <= MAX_CARD_TEXT ? full : cardText(payload, people, routes, false);
}

function cardText(payload: DraftPayload, people: Person[], routes: string[], full: boolean) {
  const lines = [t("bot.card.title")];
  payload.tasks.forEach((task, i) => {
    const who = task.unresolved
      ? t("bot.card.unresolved", { name: task.saidName ?? "?" })
      : task.assigneeId === null
        ? t(task.personal ? "bot.card.mePersonal" : "bot.card.me")
        : name(people.find((p) => p.id === task.assigneeId) ?? { firstName: "?", lastName: null });
    const details = [
      `👤 ${who}`,
      `📅 ${task.dueDate ? formatDay(task.dueDate) : t("bot.card.noDue")}`,
      task.priority && task.priority !== "MEDIUM"
        ? `⚡ ${t(`tasks.priority.${task.priority}`)}`
        : null,
      task.project ? `🏷 ${task.project}` : null,
    ].filter(Boolean);
    lines.push("", `${i + 1}. ${task.title}`, `   ${details.join(" · ")}`);
    if (routes[i] && !task.unresolved) lines.push(`   ${routes[i]}`);
    lines.push(...writtenOut(task, full));
  });
  return lines.join("\n");
}

// The description, steps and questions under a task; `full: false` keeps only the step count.
function writtenOut(task: DraftTask, full: boolean): string[] {
  const steps = task.steps ?? [];
  if (!full)
    return steps.length > 0 ? [`   ☑️ ${t("bot.card.stepsCount", { count: steps.length })}`] : [];
  const lines: string[] = [];
  const description = (task.description ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  description.forEach((line, i) => lines.push(`   ${i === 0 ? "📝" : "  "} ${line}`));
  if (steps.length > 0) {
    lines.push(`   ☑️ ${t("bot.card.steps")}`);
    steps.forEach((step, i) =>
      lines.push(
        `      ${i + 1}) ${step.title}${step.dueDate ? ` — ${t("bot.card.stepUntil", { date: formatDay(step.dueDate) })}` : ""}`,
      ),
    );
  }
  for (const question of task.missing ?? []) lines.push(`   ❓ ${question}`);
  return lines;
}

// Card buttons: first resolve unknown people, then save / edit / cancel.
export function renderCardButtons(
  draftId: string,
  payload: DraftPayload,
  people: Person[],
): TelegramButton[][] {
  const index = payload.tasks.findIndex((task) => task.unresolved);
  if (index >= 0) return assigneeButtons(draftId, index, payload.tasks[index], people);

  const rows: TelegramButton[][] = [
    [
      { text: t("bot.card.save"), data: `d:${draftId}:save` },
      { text: t("bot.card.cancel"), data: `d:${draftId}:cancel` },
    ],
  ];
  if (payload.tasks.length === 1) {
    rows.push([{ text: t("bot.card.edit"), data: `d:${draftId}:e:0` }]);
  } else {
    const edits = payload.tasks.map((_, i) => ({
      text: t("bot.card.editN", { n: i + 1 }),
      data: `d:${draftId}:e:${i}`,
    }));
    for (let i = 0; i < edits.length; i += 4) rows.push(edits.slice(i, i + 4));
  }
  return rows;
}

// People shown at once when choosing an assignee; the rest are a page away («Ещё ▶»).
export const PEOPLE_PER_PAGE = 10;

// Who does the task: the people the name matched, or everyone page by page (`page`, from 0),
// two to a row, then «Я» / «Я (личная)».
export function assigneeButtons(
  draftId: string,
  index: number,
  task: DraftTask,
  people: Person[],
  showAll = false,
  page = 0,
): TelegramButton[][] {
  const candidates = !showAll && task.candidateIds.length > 0;
  const pages = Math.max(1, Math.ceil(people.length / PEOPLE_PER_PAGE));
  const current = Math.min(Math.max(0, page), pages - 1);
  const offered = candidates
    ? people.filter((p) => task.candidateIds.includes(p.id))
    : people.slice(current * PEOPLE_PER_PAGE, (current + 1) * PEOPLE_PER_PAGE);
  const buttons = offered.map((p) => ({
    text: `👤 ${name(p)}`,
    data: `d:${draftId}:av:${index}:${p.id}`,
  }));
  const rows: TelegramButton[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  if (!candidates && pages > 1) {
    const nav: TelegramButton[] = [];
    if (current > 0)
      nav.push({ text: t("bot.card.prevPage"), data: `d:${draftId}:as:${index}:${current - 1}` });
    nav.push({ text: `${current + 1}/${pages}`, data: `d:${draftId}:as:${index}:${current}` });
    if (current < pages - 1)
      nav.push({ text: t("bot.card.nextPage"), data: `d:${draftId}:as:${index}:${current + 1}` });
    rows.push(nav);
  }
  rows.push([
    { text: t("bot.edit.me"), data: `d:${draftId}:av:${index}:me` },
    { text: t("bot.edit.mePersonal"), data: `d:${draftId}:av:${index}:mine` },
  ]);
  if (candidates) {
    rows.push([{ text: t("bot.card.someoneElse"), data: `d:${draftId}:as:${index}:0` }]);
  }
  return rows;
}

// `writtenOut`: the task has a description or steps, which can be dropped («Без описания и шагов»).
export function editMenuButtons(
  draftId: string,
  index: number,
  writtenOut = false,
): TelegramButton[][] {
  const rows: TelegramButton[][] = [
    [
      { text: t("bot.edit.title"), data: `d:${draftId}:t:${index}` },
      { text: t("bot.edit.due"), data: `d:${draftId}:due:${index}` },
      { text: t("bot.edit.assignee"), data: `d:${draftId}:as:${index}` },
    ],
  ];
  if (writtenOut) rows.push([{ text: t("bot.edit.plain"), data: `d:${draftId}:pl:${index}` }]);
  rows.push([
    { text: t("bot.edit.remove"), data: `d:${draftId}:rm:${index}` },
    { text: t("bot.edit.back"), data: `d:${draftId}:menu` },
  ]);
  return rows;
}

export function dueButtons(
  draftId: string,
  index: number,
  options: { today: string; tomorrow: string; week: string; monthEnd: string },
) {
  const compact = (date: string) => date.replaceAll("-", "");
  const set = (label: string, value: string) => ({
    text: label,
    data: `d:${draftId}:dv:${index}:${value}`,
  });
  return [
    [
      set(t("bot.edit.today"), compact(options.today)),
      set(t("bot.edit.tomorrow"), compact(options.tomorrow)),
    ],
    [
      set(t("bot.edit.week"), compact(options.week)),
      set(t("bot.edit.monthEnd"), compact(options.monthEnd)),
    ],
    [
      set(t("bot.edit.none"), "none"),
      { text: t("bot.edit.typeDate"), data: `d:${draftId}:dt:${index}` },
    ],
    [{ text: t("bot.edit.back"), data: `d:${draftId}:menu` }],
  ];
}
