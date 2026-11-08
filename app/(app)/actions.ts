"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createRateLimiter } from "@/lib/rate-limit";
import { parseTimeOfDay } from "@/lib/time";
import { syncBotCommands } from "@/modules/bot/commands";
import { requireUser } from "@/modules/core/auth/current-user";
import { createInvite, revokeInvite } from "@/modules/core/invites/service";
import {
  markAllRead,
  markManyRead,
  markRead,
  openNotification,
  sendTestNotification,
} from "@/modules/core/notifications/service";
import { OPTIONAL_NOTIFICATION_TYPES } from "@/modules/core/notifications/types";
import { getSettings, settingsInputSchema, updateSettings } from "@/modules/core/settings/service";
import { changeRole } from "@/modules/core/users/service";
import { decideCoAssignee } from "@/modules/tasks/co-assignees";
import { TaskError } from "@/modules/tasks/errors";
import { changeStatus } from "@/modules/tasks/service";
import { TeamError, updateOwnContacts } from "@/modules/team/service";

// Server actions are reachable by direct POST, so every action checks the user
// and passes it to a service, which checks permissions.
const allowAction = createRateLimiter({ limit: 30, windowMs: 60_000 });

async function actor() {
  const user = await requireUser();
  if (!allowAction(user.id)) throw new Error("Too many requests");
  return user;
}

const roleSchema = z.enum(["OWNER", "MANAGER", "MEMBER", "LAWYER"]);
const idSchema = z.string().min(1).max(64);

// Only our own team pages and Settings are allowed as a return address.
const backTo = (value: FormDataEntryValue | null, fallback: string) => {
  const back = String(value ?? "");
  return /^\/team(\/[A-Za-z0-9]{1,64})?$/.test(back) || back === "/settings" ? back : fallback;
};

// Invites live on /team and on /settings/invites (managers without the Team section). The new
// invite is marked in the list (`?new=<id>`), so the person sees which link to send.
export async function createInviteAction(formData: FormData) {
  const user = await actor();
  const forName = String(formData.get("forName") ?? "");
  const role = roleSchema.parse(formData.get("role"));
  const invite = await createInvite(user, role, new Date(), undefined, forName);
  revalidatePath("/team");
  revalidatePath("/settings/invites");
  const page = formData.get("from") === "settings" ? "/settings/invites" : "/team";
  redirect(`${page}?${new URLSearchParams({ invite: "1", new: invite.id })}#invites`);
}

export async function revokeInviteAction(formData: FormData) {
  const user = await actor();
  await revokeInvite(user, idSchema.parse(formData.get("inviteId")));
  revalidatePath("/team");
  revalidatePath("/settings/invites");
}

export async function changeRoleAction(formData: FormData) {
  const user = await actor();
  const userId = idSchema.parse(formData.get("userId"));
  await changeRole(user, userId, roleSchema.parse(formData.get("role")));
  revalidatePath("/", "layout");
  const back = backTo(formData.get("back"), "");
  if (back) redirect(`${back}?tab=manage&roleChanged=1`);
}

export async function sendTestNotificationAction(formData: FormData) {
  const user = await actor();
  const targetId = idSchema.parse(formData.get("userId"));
  const outcome = await sendTestNotification(user, targetId);
  revalidatePath("/", "layout");
  const back = backTo(formData.get("back"), "/notifications");
  const tab = back.startsWith("/team/") ? "&tab=manage" : "";
  redirect(`${back}?notice=testSent&tg=${outcome}${tab}`);
}

export async function markReadAction(formData: FormData) {
  const user = await actor();
  await markRead(user.id, idSchema.parse(formData.get("notificationId")));
  revalidatePath("/", "layout");
}

// «Прочитано» on a collapsed group of similar notifications.
export async function markGroupReadAction(formData: FormData) {
  const user = await actor();
  const ids = z.array(idSchema).max(100).parse(formData.getAll("notificationId"));
  await markManyRead(user.id, ids);
  revalidatePath("/", "layout");
}

export async function markAllReadAction() {
  const user = await actor();
  await markAllRead(user.id);
  revalidatePath("/", "layout");
}

export async function openNotificationAction(formData: FormData) {
  const user = await actor();
  const target = await openNotification(user.id, idSchema.parse(formData.get("notificationId")));
  revalidatePath("/", "layout");
  redirect(target ?? "/notifications");
}

// «Утвердить» / «Принять» right in the notification list (the same as on «Сегодня» and in the
// bot). Returning and declining need a reason: they open the task's decision panel. A refusal
// (someone decided first, a blocking task is open) is explained there too.
export async function decideFromNotificationAction(formData: FormData) {
  const user = await actor();
  const notificationId = idSchema.parse(formData.get("notificationId"));
  const taskId = idSchema.parse(formData.get("taskId"));
  const to = z.enum(["APPROVED", "DONE"]).parse(formData.get("to"));
  let error: string | null = null;
  try {
    await changeStatus(user, taskId, to);
  } catch (e) {
    if (!(e instanceof TaskError)) throw e;
    error = e.code;
  }
  await markRead(user.id, notificationId);
  revalidatePath("/", "layout");
  if (error) redirect(`/tasks/decide?task=${encodeURIComponent(taskId)}&error=${error}`);
}

// «Добавить» / «Отказать» on a request to add a co-assignee.
export async function decideCoAssigneeFromNotificationAction(formData: FormData) {
  const user = await actor();
  const notificationId = idSchema.parse(formData.get("notificationId"));
  try {
    await decideCoAssignee(
      user,
      idSchema.parse(formData.get("requestId")),
      formData.get("approve") === "1",
    );
  } catch (e) {
    if (!(e instanceof TaskError)) throw e;
  }
  await markRead(user.id, notificationId);
  revalidatePath("/", "layout");
}

export async function saveSettingsAction(formData: FormData) {
  const user = await actor();
  const current = await getSettings(user.id);
  // Settings show only the groups that concern the person; the hidden ones keep their value.
  const shown = new Set(formData.getAll("shownTypes"));
  const quietHoursStart = parseTimeOfDay(String(formData.get("quietFrom") ?? ""));
  const quietHoursEnd = parseTimeOfDay(String(formData.get("quietTo") ?? ""));
  if ((quietHoursStart === null) !== (quietHoursEnd === null)) redirect("/settings?error=quiet");
  const parsed = settingsInputSchema.safeParse({
    timezone: String(formData.get("timezone") ?? ""),
    // Without the bot the switch is shown off and locked: the saved choice is kept for later.
    telegramEnabled: formData.has("telegramShown")
      ? formData.get("telegramEnabled") === "on"
      : current.telegramEnabled,
    quietHoursStart,
    quietHoursEnd,
    disabledTypes: OPTIONAL_NOTIFICATION_TYPES.filter((type) =>
      shown.has(type)
        ? formData.get(`type_${type}`) !== "on"
        : current.disabledTypes.includes(type),
    ),
    digestTime: parseTimeOfDay(String(formData.get("digestTime") ?? "")) ?? 510,
    locale: String(formData.get("locale") ?? "ru"),
  });
  if (!parsed.success)
    redirect(
      parsed.error.issues.some((i) => i.path[0] === "timezone")
        ? "/settings?error=timezone"
        : "/settings?error=1",
    );
  await updateSettings(user.id, parsed.data);
  if (parsed.data.locale !== user.locale) await syncBotCommands(user.id, parsed.data.locale);
  revalidatePath("/", "layout");
  redirect("/settings?saved=1");
}

// Settings → Профиль: one's own phone and email.
export async function saveContactsAction(formData: FormData) {
  const user = await actor();
  try {
    await updateOwnContacts(user, {
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? "").trim(),
    });
  } catch (error) {
    if (!(error instanceof TeamError)) throw error;
    redirect("/settings?error=contacts");
  }
  revalidatePath("/", "layout");
  redirect("/settings?saved=contacts");
}
