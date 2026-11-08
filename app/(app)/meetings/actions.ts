"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { TaskPriority } from "@/lib/generated/prisma/enums";
import { isDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { createRateLimiter } from "@/lib/rate-limit";
import { formatDateTime } from "@/lib/time";
import { AiError } from "@/modules/ai/run";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { proposeActionItems } from "@/modules/meetings/minutes";
import {
  createMeeting,
  deleteMeeting,
  MeetingError,
  saveNotes,
  updateMeeting,
  type MeetingInput,
} from "@/modules/meetings/service";
import { createProposedTasks } from "@/modules/tasks/batch";
import { routeHints } from "@/modules/tasks/route-hints";
import { db } from "@/lib/db";

const allowAction = createRateLimiter({ limit: 60, windowMs: 60_000 });

async function actor() {
  const user = await requireUser();
  if (!allowAction(user.id)) throw new Error("Too many requests");
  return user;
}

const str = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};
const idSchema = z.string().min(1).max(64);

function meetingInput(formData: FormData): MeetingInput {
  return {
    title: str(formData, "title"),
    startsLocal: str(formData, "startsLocal"),
    durationMinutes: Number(str(formData, "durationMinutes") || 60),
    agenda: str(formData, "agenda"),
    link: str(formData, "link").trim(),
    participantIds: formData
      .getAll("participantIds")
      .filter((v): v is string => typeof v === "string"),
    repeatUntil: str(formData, "repeatUntil") || null,
  };
}

// The meeting form keeps what was typed when the server refuses it.
export type MeetingFormValues = {
  title: string;
  startsLocal: string;
  durationMinutes: string;
  agenda: string;
  link: string;
  repeatUntil: string;
  participantIds: string[];
  following: string;
};
export type MeetingFormState = { error: string | null; values: MeetingFormValues };

function formValues(formData: FormData): MeetingFormValues {
  const input = meetingInput(formData);
  return {
    title: input.title,
    startsLocal: input.startsLocal,
    durationMinutes: str(formData, "durationMinutes"),
    agenda: input.agenda,
    link: input.link,
    repeatUntil: input.repeatUntil ?? "",
    participantIds: input.participantIds,
    following: str(formData, "following"),
  };
}

export async function createMeetingAction(
  _: MeetingFormState,
  formData: FormData,
): Promise<MeetingFormState> {
  const user = await actor();
  let id: string;
  try {
    id = (await createMeeting(user, meetingInput(formData))).id;
  } catch (error) {
    if (!(error instanceof MeetingError)) throw error;
    return { error: error.code, values: formValues(formData) };
  }
  revalidatePath("/", "layout");
  redirect(`/meetings/${id}`);
}

export async function updateMeetingAction(
  _: MeetingFormState,
  formData: FormData,
): Promise<MeetingFormState> {
  const user = await actor();
  const id = idSchema.parse(str(formData, "meetingId"));
  try {
    await updateMeeting(user, id, meetingInput(formData), formData.get("following") === "1");
  } catch (error) {
    if (!(error instanceof MeetingError)) throw error;
    return { error: error.code, values: formValues(formData) };
  }
  revalidatePath("/", "layout");
  redirect(`/meetings/${id}`);
}

export async function deleteMeetingAction(formData: FormData) {
  const user = await actor();
  await deleteMeeting(
    user,
    idSchema.parse(str(formData, "meetingId")),
    formData.get("following") === "1",
  );
  revalidatePath("/", "layout");
  redirect("/meetings");
}

export type NotesState = {
  error: string | null;
  saved: boolean;
  // After a refusal: what the user typed; after a clash also the minutes as they are now.
  text?: string;
  current?: { text: string; by: string; at: string; version: string };
};

export async function saveNotesAction(_: NotesState, formData: FormData): Promise<NotesState> {
  const user = await actor();
  const id = idSchema.parse(str(formData, "meetingId"));
  const text = str(formData, "text");
  try {
    await saveNotes(user, id, text, str(formData, "version"));
  } catch (e) {
    if (!(e instanceof MeetingError)) throw e;
    if (e.code !== "conflict") return { error: e.code, saved: false, text };
    const notes = await db.meetingNotes.findUnique({
      where: { meetingId: id },
      include: { author: true },
    });
    const { timezone } = await getSettings(user.id);
    return {
      error: "conflict",
      saved: false,
      text,
      current: notes
        ? {
            text: notes.text,
            by: displayName(notes.author),
            at: formatDateTime(notes.updatedAt, timezone),
            version: notes.updatedAt.toISOString(),
          }
        : undefined,
    };
  }
  revalidatePath(`/meetings/${id}`);
  return { error: null, saved: true };
}

// A proposed task as the meeting page shows it: a name the AI could not match stays empty
// (saidName shows what was said) until the user picks someone.
export type ProposedRow = {
  title: string;
  assigneeId: string | null;
  personal: boolean;
  unresolved: boolean;
  saidName: string | null;
  candidateIds: string[];
  dueDate: string | null;
  priority: string | null;
  project: string | null;
};

export type ProposalState = {
  error: string | null;
  tasks: ProposedRow[] | null;
  // Route hints (routing v2): what happens to a task for each person; "me" = a team task on
  // oneself (its route is `self`), "mine" = a personal one.
  people: { id: string; name: string; route: string }[];
  self?: string;
  // After «Создать»: the proposal is cleared and this says what happened to the rows.
  result?: { created: number; pending: number; errors: string[] };
};

// One action for both steps of "tasks from the minutes", so that creating clears the proposal and
// a second click can't create the same tasks twice.
export async function actionItemsAction(
  state: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  return formData.get("intent") === "create"
    ? createActionItems(state, formData)
    : proposeFromMinutes(formData);
}

async function proposeFromMinutes(formData: FormData): Promise<ProposalState> {
  const user = await actor();
  const id = idSchema.parse(str(formData, "meetingId"));
  const hints = await routeHints(user.id);
  const people = (
    await db.user.findMany({ where: { deactivatedAt: null }, orderBy: { firstName: "asc" } })
  )
    .filter((u) => u.id !== user.id)
    .map((u) => ({ id: u.id, name: displayName(u), route: hints[u.id]?.plain.short ?? "" }));
  const self = hints[user.id]?.plain.short ?? "";
  try {
    const tasks = await proposeActionItems(user, id);
    return {
      error: null,
      people,
      self,
      tasks: tasks.map((task) => ({
        title: task.title,
        assigneeId: task.assigneeId,
        personal: task.personal === true,
        unresolved: task.unresolved,
        saidName: task.saidName,
        candidateIds: task.candidateIds,
        dueDate: task.dueDate,
        priority: task.priority,
        project: task.project,
      })),
    };
  } catch (error) {
    if (error instanceof AiError)
      return { error: `ai.errors.${error.code}`, tasks: null, people, self };
    if (error instanceof MeetingError)
      return { error: `meetings.errors.${error.code}`, tasks: null, people, self };
    throw error;
  }
}

const rowSchema = z.object({
  title: z.string().trim().min(1).max(200),
  assignee: z.string().max(64),
  dueDate: z.string().refine((v) => v === "" || isDateString(v)),
  priority: z.enum(TaskPriority).nullable(),
  project: z.string().max(60).nullable(),
});

async function createActionItems(state: ProposalState, formData: FormData): Promise<ProposalState> {
  const user = await actor();
  const id = idSchema.parse(str(formData, "meetingId"));
  const count = Number(str(formData, "count")) || 0;
  const tasks = [];
  const skipped: string[] = [];
  for (let i = 0; i < Math.min(count, 50); i++) {
    if (formData.get(`include_${i}`) !== "on") continue;
    const title = str(formData, `title_${i}`).trim() || `#${i + 1}`;
    const row = rowSchema.safeParse({
      title: str(formData, `title_${i}`),
      assignee: str(formData, `assignee_${i}`),
      dueDate: str(formData, `due_${i}`),
      priority: str(formData, `priority_${i}`) || null,
      project: str(formData, `project_${i}`) || null,
    });
    if (!row.success) {
      skipped.push(t("meetings.actions.rowInvalid", { title }));
      continue;
    }
    // Nobody picked for a name the AI could not match: never fall back to «Я».
    if (row.data.assignee === "") {
      skipped.push(t("meetings.actions.rowNoAssignee", { title }));
      continue;
    }
    tasks.push({
      title: row.data.title,
      // «Я» — a team task on oneself, «Я (личная)» — a personal one.
      assigneeId: ["me", "mine"].includes(row.data.assignee) ? null : row.data.assignee,
      personal: row.data.assignee === "mine",
      dueDate: row.data.dueDate || null,
      priority: row.data.priority,
      project: row.data.project,
    });
  }
  const { saved, pending, errors } = await createProposedTasks(user, tasks, id);
  revalidatePath("/", "layout");
  return {
    error: null,
    tasks: null,
    people: state.people,
    self: state.self,
    result: { created: saved - pending, pending, errors: [...skipped, ...errors] },
  };
}
