import { formatDay } from "@/lib/dates";
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
};

// meetingId: set when the tasks come from meeting minutes.
export type DraftPayload = { tasks: DraftTask[]; meetingId?: string };

type Person = { id: string; firstName: string; lastName: string | null };

const name = (p: { firstName: string; lastName: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(" ");

// routes: what will happen to each task (routing v2), shown under it before saving.
export function renderCardText(
  payload: DraftPayload,
  people: Person[],
  routes: string[] = [],
): string {
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
  });
  return lines.join("\n");
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

export function assigneeButtons(
  draftId: string,
  index: number,
  task: DraftTask,
  people: Person[],
  showAll = false,
): TelegramButton[][] {
  const offered =
    !showAll && task.candidateIds.length > 0
      ? people.filter((p) => task.candidateIds.includes(p.id))
      : people.slice(0, 20);
  const rows = offered.map((p) => [
    { text: `👤 ${name(p)}`, data: `d:${draftId}:av:${index}:${p.id}` },
  ]);
  rows.push([
    { text: t("bot.edit.me"), data: `d:${draftId}:av:${index}:me` },
    { text: t("bot.edit.mePersonal"), data: `d:${draftId}:av:${index}:mine` },
  ]);
  if (!showAll && task.candidateIds.length > 0) {
    rows.push([{ text: t("bot.card.someoneElse"), data: `d:${draftId}:as:${index}` }]);
  }
  return rows;
}

export function editMenuButtons(draftId: string, index: number): TelegramButton[][] {
  return [
    [
      { text: t("bot.edit.title"), data: `d:${draftId}:t:${index}` },
      { text: t("bot.edit.due"), data: `d:${draftId}:due:${index}` },
      { text: t("bot.edit.assignee"), data: `d:${draftId}:as:${index}` },
    ],
    [
      { text: t("bot.edit.remove"), data: `d:${draftId}:rm:${index}` },
      { text: t("bot.edit.back"), data: `d:${draftId}:menu` },
    ],
  ];
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
