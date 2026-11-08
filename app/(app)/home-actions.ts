"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/modules/core/auth/current-user";
import { TaskError } from "@/modules/tasks/errors";
import { changeStatus } from "@/modules/tasks/service";

// «Утвердить» / «Принять» right in the «Ждут вашего решения» list on «Сегодня». Declining and
// returning need a reason, so they open the task's decision panel instead.
export async function decideFromHomeAction(formData: FormData) {
  const user = await requireUser();
  const taskId = z.string().min(1).max(64).parse(formData.get("taskId"));
  const to = z.enum(["APPROVED", "DONE"]).parse(formData.get("to"));
  let error: string | null = null;
  try {
    await changeStatus(user, taskId, to);
  } catch (e) {
    if (!(e instanceof TaskError)) throw e;
    error = e.code;
  }
  revalidatePath("/", "layout");
  // A refusal (someone decided first, a blocking task is open) is explained on the task.
  if (error) redirect(`/tasks/decide?task=${encodeURIComponent(taskId)}&error=${error}`);
}
