"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/modules/core/auth/current-user";
import { TaskError } from "@/modules/tasks/errors";
import { stopTimer } from "@/modules/tasks/time";

const taskIdSchema = z.string().min(1).max(64);
const partSchema = z.coerce.number().int().min(0);

// «Стоп» on the header pill and the timer card: stops the timer and stays on the page the person
// is on. With hours and minutes («Исправить время» on a forgotten timer) it writes down the time
// really worked instead of what the timer counted.
export async function stopRunningTimerAction(formData: FormData) {
  const user = await requireUser();
  const taskId = taskIdSchema.parse(formData.get("taskId"));
  const fixed = formData.has("hours") || formData.has("minutes");
  const worked = fixed
    ? partSchema.max(24).parse(formData.get("hours") || 0) * 60 +
      partSchema.max(59).parse(formData.get("minutes") || 0)
    : undefined;
  try {
    await stopTimer(user, taskId, new Date(), worked);
  } catch (error) {
    // The task was closed or the person lost access: the timer has been stopped already.
    if (!(error instanceof TaskError)) throw error;
  }
  revalidatePath("/", "layout");
}
