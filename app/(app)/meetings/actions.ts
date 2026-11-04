"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { TaskPriority } from "@/lib/generated/prisma/enums";
import { isDateString } from "@/lib/dates";
import { createRateLimiter } from "@/lib/rate-limit";
import { AiError } from "@/modules/ai/run";
import { requireUser } from "@/modules/core/auth/current-user";
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
import { t } from "@/lib/i18n";

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

export async function createMeetingAction(formData: FormData) {
  const user = await actor();
  let id: string;
  try {
    id = (await createMeeting(user, meetingInput(formData))).id;
  } catch (error) {
    if (!(error instanceof MeetingError)) throw error;
    redirect(`/meetings/new?error=${error.code}`);
  }
  revalidatePath("/", "layout");
  redirect(`/meetings/${id}`);
}

export async function updateMeetingAction(formData: FormData) {
  const user = await actor();
  const id = idSchema.parse(str(formData, "meetingId"));
  try {
    await updateMeeting(user, id, meetingInput(formData));
  } catch (error) {
    if (!(error instanceof MeetingError)) throw error;
    redirect(`/meetings/${id}/edit?error=${error.code}`);
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

export async function saveNotesAction(formData: FormData) {
  const user = await actor();
  const id = idSchema.parse(str(formData, "meetingId"));
  let error: string | null = null;
  try {
    await saveNotes(user, id, str(formData, "text"));
  } catch (e) {
    if (!(e instanceof MeetingError)) throw e;
    error = e.code;
  }
  revalidatePath(`/meetings/${id}`);
  redirect(`/meetings/${id}?${error ? `error=${error}` : "notes=saved"}`);
}

export type ProposalState = {
  error: string | null;
  tasks:
    | {
        title: string;
        assigneeId: string | null;
        dueDate: string | null;
        priority: string | null;
        project: string | null;
      }[]
    | null;
  // Route hints (routing v2): what happens to a task for each person; "me" = personal.
  people: { id: string; name: string; route: string }[];
};

export async function proposeActionItemsAction(
  _: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  const user = await actor();
  const id = idSchema.parse(str(formData, "meetingId"));
  const hints = await routeHints(user.id);
  const people = (await db.user.findMany({ orderBy: { firstName: "asc" } })).map((u) => ({
    id: u.id,
    name: displayName(u),
    route: u.id === user.id ? t("tasks.route.shortPersonal") : (hints[u.id]?.plain.short ?? ""),
  }));
  try {
    const tasks = await proposeActionItems(user, id);
    return {
      error: null,
      people,
      // Unresolved names are left without an assignee for the user to pick.
      tasks: tasks.map(({ title, assigneeId, dueDate, priority, project }) => ({
        title,
        assigneeId,
        dueDate,
        priority,
        project,
      })),
    };
  } catch (error) {
    if (error instanceof AiError) return { error: `ai.errors.${error.code}`, tasks: null, people };
    if (error instanceof MeetingError)
      return { error: `meetings.errors.${error.code}`, tasks: null, people };
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

export async function createActionItemsAction(formData: FormData) {
  const user = await actor();
  const id = idSchema.parse(str(formData, "meetingId"));
  const count = Number(str(formData, "count")) || 0;
  const tasks = [];
  for (let i = 0; i < Math.min(count, 50); i++) {
    if (formData.get(`include_${i}`) !== "on") continue;
    const row = rowSchema.safeParse({
      title: str(formData, `title_${i}`),
      assignee: str(formData, `assignee_${i}`),
      dueDate: str(formData, `due_${i}`),
      priority: str(formData, `priority_${i}`) || null,
      project: str(formData, `project_${i}`) || null,
    });
    if (!row.success) continue;
    tasks.push({
      title: row.data.title,
      assigneeId: row.data.assignee === "me" || !row.data.assignee ? null : row.data.assignee,
      dueDate: row.data.dueDate || null,
      priority: row.data.priority,
      project: row.data.project,
    });
  }
  const { saved } = await createProposedTasks(user, tasks, id);
  revalidatePath("/", "layout");
  redirect(`/meetings/${id}?created=${saved}`);
}
