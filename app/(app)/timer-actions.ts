"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/modules/core/auth/current-user";
import { TaskError } from "@/modules/tasks/errors";
import { stopTimer } from "@/modules/tasks/time";

// «Стоп» on the header pill: stops the timer and stays on the page the person is on.
export async function stopRunningTimerAction(formData: FormData) {
  const user = await requireUser();
  const taskId = z.string().min(1).max(64).parse(formData.get("taskId"));
  try {
    await stopTimer(user, taskId);
  } catch (error) {
    // The task was closed or the person lost access: the timer has been stopped already.
    if (!(error instanceof TaskError)) throw error;
  }
  revalidatePath("/", "layout");
}
