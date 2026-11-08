import { beforeEach, describe, expect, it, vi } from "vitest";

// getCurrentUser reads the session cookie through next/headers: the test hands it a token.
const jar = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.token ? { name, value: jar.token } : undefined),
  }),
  headers: async () => new Headers(),
}));

import { POST as devLogin } from "@/app/api/auth/dev-login/route";
import { GET as telegramCallback } from "@/app/api/auth/telegram/route";
import { db } from "@/lib/db";
import { createBot } from "@/modules/bot/bot";
import type { ConversationDeps } from "@/modules/bot/conversation";
import { getCurrentUser, requireUser } from "@/modules/core/auth/current-user";
import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { createSessionToken, SESSION_COOKIE } from "@/modules/core/auth/session";
import { signTelegramLoginData } from "@/modules/core/auth/telegram";
import { createInvite } from "@/modules/core/invites/service";
import { notify } from "@/modules/core/notifications/service";
import { updateSettings } from "@/modules/core/settings/service";
import { loginWithTelegram } from "@/modules/core/users/service";
import { listContentAuthors } from "@/modules/content/service";
import { createMeeting, getMeetingDetail } from "@/modules/meetings/service";
import { getOrgTree, saveOrgNode } from "@/modules/org/service";
import { runSchedulerTick } from "@/modules/scheduler/tick";
import { reviewerOf } from "@/modules/tasks/access";
import { addCoAssignee } from "@/modules/tasks/co-assignees";
import { addComment, listComments } from "@/modules/tasks/comment-service";
import { parseTaskFilters } from "@/modules/tasks/filters";
import { completeTask, updateTaskField } from "@/modules/tasks/quick-actions";
import {
  changeStatus,
  createTask,
  getTaskDetail,
  listAssignableUsers,
  listDecisions,
  listTaskPeople,
  listTasks,
} from "@/modules/tasks/service";
import { startTimer } from "@/modules/tasks/time";
import { deactivateUser, reactivateUser } from "@/modules/team/deactivation";
import { getEmployeeCard, listManagerCandidates, listTeamCards } from "@/modules/team/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";
import { telegramMock } from "@/tests/helpers/telegram";

const BOT_TOKEN = "123456:TEST-TOKEN";
const SECRET = "test-session-secret-test-session-secret";
const TODAY = "2026-11-09";
let ip = 0;

// The owner, a senior manager over a manager with two people, and an employee under the owner.
async function company() {
  const owner = await createTestUser("OWNER", { firstName: "Тестовладелец" });
  const senior = await createTestUser("MANAGER", { firstName: "Тестстарший" });
  const manager = await createTestUser("MANAGER", { firstName: "Тестменеджер" });
  const a1 = await createTestUser("MEMBER", { firstName: "Тестазиз" });
  const a2 = await createTestUser("MEMBER", { firstName: "Тестдилноза" });
  const loose = await createTestUser("MEMBER", { firstName: "Тестсардор" });
  await db.user.update({ where: { id: manager.id }, data: { managerId: senior.id } });
  await db.user.updateMany({
    where: { id: { in: [a1.id, a2.id] } },
    data: { managerId: manager.id },
  });
  return { owner, senior, manager, a1, a2, loose };
}

const task = (id: string) => db.task.findUniqueOrThrow({ where: { id } });
const notices = (userId: string, type?: string) =>
  db.notification.count({ where: { userId, ...(type ? { type } : {}) } });

function widgetRequest(telegramId: bigint, firstName: string, invite?: string) {
  const fields = {
    id: String(telegramId),
    first_name: firstName,
    auth_date: String(Math.floor(Date.now() / 1000)),
  };
  const hash = signTelegramLoginData(fields, BOT_TOKEN);
  const params = new URLSearchParams({ ...fields, hash, ...(invite ? { invite } : {}) });
  return new Request(`http://localhost:3000/api/auth/telegram?${params}`, {
    headers: { "x-forwarded-for": `10.9.0.${++ip}` },
  });
}

// A bot whose outgoing Telegram API calls are recorded instead of sent.
function testBot() {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const deps: ConversationDeps = {
    now: new Date(`${TODAY}T09:00:00+05:00`),
    interpret: async () => ({ intent: "create_tasks", taskQuery: null, newDueDate: null }),
    extract: async () => [],
  };
  const bot = createBot("123:TEST", deps, undefined, {
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: "Assistant",
      username: "test_assistant_bot",
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    } as never,
  });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result =
      method === "sendMessage"
        ? { message_id: 77, date: 0, chat: { id: 1, type: "private" } }
        : true;
    return { ok: true, result } as never;
  });
  return { bot, calls };
}

let updateId = 1;
const message = (telegramId: bigint, text: string) => ({
  update_id: updateId++,
  message: {
    message_id: updateId,
    date: 0,
    chat: { id: Number(telegramId), type: "private" as const, first_name: "Тест" },
    from: { id: Number(telegramId), is_bot: false, first_name: "Тест" },
    text,
    ...(text.startsWith("/")
      ? { entities: [{ type: "bot_command" as const, offset: 0, length: text.length }] }
      : {}),
  },
});

describe("deactivating an employee", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
    jar.token = "";
  });

  it("only the owner deactivates and turns back on; not oneself; both are logged", async () => {
    const { owner, manager, a1, a2 } = await company();
    await expect(deactivateUser(manager, a1.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(deactivateUser(owner, owner.id)).rejects.toMatchObject({ code: "self" });

    await deactivateUser(owner, a2.id);
    // Tasks go only to someone who still works.
    await expect(deactivateUser(owner, a1.id, { handOverTo: a2.id })).rejects.toMatchObject({
      code: "handOver",
    });
    await expect(deactivateUser(owner, a2.id)).rejects.toMatchObject({ code: "state" });
    expect(await db.user.findUniqueOrThrow({ where: { id: a2.id } })).toMatchObject({
      deactivatedById: owner.id,
    });

    await expect(reactivateUser(manager, a2.id)).rejects.toMatchObject({ code: "forbidden" });
    await reactivateUser(owner, a2.id);
    await expect(reactivateUser(owner, a2.id)).rejects.toMatchObject({ code: "state" });
    expect(await db.user.findUniqueOrThrow({ where: { id: a2.id } })).toMatchObject({
      deactivatedAt: null,
      deactivatedById: null,
    });
    const log = await db.activityLog.findMany({
      where: { entityType: "User", entityId: a2.id },
      orderBy: { createdAt: "asc" },
    });
    expect(log.map((l) => [l.action, l.actorId])).toEqual([
      ["user.deactivated", owner.id],
      ["user.reactivated", owner.id],
    ]);
  });

  it("the last owner can't be deactivated, even by two owners at once", async () => {
    const first = await createTestUser("OWNER");
    const second = await createTestUser("OWNER");
    const results = await Promise.allSettled([
      deactivateUser(first, second.id),
      deactivateUser(second, first.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: "lastOwner" });
    expect(await db.user.count({ where: { role: "OWNER", deactivatedAt: null } })).toBe(1);
  });

  it("hands open tasks over through the usual route; handed-in and personal work stays", async () => {
    const { owner, manager, a1, a2 } = await company();
    const given = await createTask(
      manager,
      taskInput({ title: "Отчёт", assigneeId: a1.id }),
      "create",
    );
    const own = await createTask(a1, taskInput({ title: "Своя", assigneeId: a1.id }), "create", {
      startOwn: true,
    });
    expect(own).toMatchObject({ status: "IN_PROGRESS", reviewerId: manager.id });
    await startTimer(a1, own.id);
    const handedIn = await createTask(
      manager,
      taskInput({ title: "Сдана", assigneeId: a1.id }),
      "create",
    );
    await changeStatus(a1, handedIn.id, "IN_PROGRESS");
    await changeStatus(a1, handedIn.id, "IN_REVIEW");
    const personal = await createTask(
      a1,
      taskInput({ title: "Личная", isPersonal: true }),
      "start",
    );
    const helped = await createTask(
      manager,
      taskInput({ title: "Вместе", assigneeId: a2.id }),
      "create",
    );
    expect(await addCoAssignee(manager, helped.id, a1.id)).toBe("added");
    const assignedBefore = await notices(a2.id, "task_assigned");
    const a1Before = await notices(a1.id);

    expect(await deactivateUser(owner, a1.id, { handOverTo: a2.id })).toEqual({
      moved: 2,
      notMoved: 0,
    });
    // Moved by the route: the new assignee takes it into work; the manager still accepts.
    expect(await task(given.id)).toMatchObject({
      assigneeId: a2.id,
      status: "APPROVED",
      reviewerId: manager.id,
    });
    expect(await task(own.id)).toMatchObject({
      creatorId: a1.id,
      assigneeId: a2.id,
      status: "APPROVED",
      reviewerId: manager.id,
    });
    expect(await notices(a2.id, "task_assigned")).toBe(assignedBefore + 2);
    expect(
      await db.activityLog.count({ where: { entityId: own.id, action: "task.updated" } }),
    ).toBe(1);
    // Work handed in waits for acceptance as theirs; a personal task is nobody else's.
    expect(await task(handedIn.id)).toMatchObject({ assigneeId: a1.id, status: "IN_REVIEW" });
    expect(await task(personal.id)).toMatchObject({ assigneeId: a1.id, status: "IN_PROGRESS" });
    // Off the task they helped with; their timer stopped.
    expect((await task(helped.id)).coAssigneeIds).toEqual([]);
    expect(await db.taskTimeEntry.count({ where: { userId: a1.id, endedAt: null } })).toBe(0);
    // They heard nothing of it.
    expect(await notices(a1.id)).toBe(a1Before);

    // The manager accepts the handed-in work: it stays theirs in the history.
    await changeStatus(manager, handedIn.id, "DONE");
    expect(await task(handedIn.id)).toMatchObject({ assigneeId: a1.id, status: "DONE" });
  });

  it("work in progress of a deactivated person can be given to someone else later", async () => {
    const { owner, manager, a1, a2 } = await company();
    const given = await createTask(manager, taskInput({ assigneeId: a1.id }), "create");
    await changeStatus(a1, given.id, "IN_PROGRESS");
    await deactivateUser(owner, a1.id);
    // Usually locked after «В работе»; the deactivated assignee lets it go.
    await updateTaskField(manager, given.id, "assigneeId", a2.id);
    expect(await task(given.id)).toMatchObject({ assigneeId: a2.id, status: "APPROVED" });
    // Nobody new gets a deactivated person.
    await expect(updateTaskField(manager, given.id, "assigneeId", a1.id)).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("nothing open waits only on a deactivated person", async () => {
    const { owner, senior, manager, a1, a2, loose } = await company();
    // Waits for the manager: a task from another team for their person.
    const foreign = await createTask(
      loose,
      taskInput({ title: "Чужая", assigneeId: a1.id }),
      "create",
    );
    expect(foreign).toMatchObject({ status: "PENDING_APPROVAL", deciderIds: [manager.id] });
    // The manager accepts their person's own work, and the work of a task they gave.
    const own = await createTask(a1, taskInput({ title: "Своя", assigneeId: a1.id }), "create", {
      startOwn: true,
    });
    await changeStatus(a1, own.id, "IN_REVIEW");
    const given = await createTask(
      manager,
      taskInput({ title: "От руководителя", assigneeId: a2.id }),
      "create",
    );
    // A request to add their person as a co-assignee waits for them too.
    const looseOwn = await createTask(
      loose,
      taskInput({ title: "Сардора", assigneeId: loose.id }),
      "create",
      { startOwn: true },
    );
    expect(await addCoAssignee(loose, looseOwn.id, a2.id)).toBe("requested");

    await deactivateUser(owner, manager.id);
    // The next manager up decides and accepts now, and hears what waits for them.
    expect((await task(foreign.id)).deciderIds).toEqual([senior.id]);
    expect((await task(own.id)).reviewerId).toBe(senior.id);
    expect((await task(given.id)).reviewerId).toBe(senior.id);
    const request = await db.taskCoAssigneeRequest.findFirstOrThrow();
    expect(request.deciderIds).toEqual([senior.id]);
    const decisions = await listDecisions(senior);
    expect(decisions.approve.map((t) => t.id)).toEqual([foreign.id]);
    expect(decisions.accept.map((t) => t.id)).toEqual([own.id]);
    expect(decisions.coAssignees.map((r) => r.id)).toEqual([request.id]);
    expect(await notices(senior.id, "task_pending_approval")).toBe(2);
    expect(await notices(senior.id, "task_status")).toBe(1);
    expect(await countWaitingFor(manager.id)).toBe(0);

    // New work passes them by: their people are under the senior manager now.
    const fresh = await createTask(a2, taskInput({ assigneeId: a2.id }), "create", {
      startOwn: true,
    });
    expect(fresh.reviewerId).toBe(senior.id);
    const across = await createTask(loose, taskInput({ assigneeId: a2.id }), "create");
    expect(across.deciderIds).toEqual([senior.id]);
  });

  it("with nobody above the deactivated author, the owner's task closes on hand-in", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    // A request to the owner, accepted and in work.
    const ask = await createTask(member, taskInput({ assigneeId: owner.id }), "create");
    await changeStatus(owner, ask.id, "APPROVED");
    await changeStatus(owner, ask.id, "IN_PROGRESS");
    await deactivateUser(owner, member.id);
    expect(reviewerOf(await task(ask.id))).toBeNull();
    expect(await completeTask(owner, ask.id)).toBe("DONE");
  });

  it("can't sign in anywhere, and a session in use stops working", async () => {
    const { owner, a1 } = await company();
    const token = createSessionToken(a1.id, SECRET);
    await deactivateUser(owner, a1.id);

    expect(await loginWithTelegram({ telegramId: a1.telegramId, firstName: "Тест" })).toEqual({
      ok: false,
      reason: "deactivated",
    });
    const web = await telegramCallback(widgetRequest(a1.telegramId, "Тест"));
    expect(web.headers.get("location")).toBe("http://localhost:3000/login?error=deactivated");
    expect(web.headers.get("set-cookie")).toBeNull();
    const form = new FormData();
    form.set("telegramId", String(a1.telegramId));
    form.set("firstName", "Тест");
    const dev = await devLogin(
      new Request("http://localhost:3000/api/auth/dev-login", {
        method: "POST",
        body: form,
        headers: { "x-forwarded-for": `10.9.1.${++ip}` },
      }),
    );
    expect(dev.headers.get("location")).toBe("http://localhost:3000/login?error=deactivated");

    // An invitation doesn't let them in either, and stays unused.
    const invite = await createInvite(owner, "MEMBER");
    const invited = await telegramCallback(widgetRequest(a1.telegramId, "Тест", invite.code));
    expect(invited.headers.get("location")).toContain(`/invite/${invite.code}?error=deactivated`);
    expect((await db.invite.findUniqueOrThrow({ where: { id: invite.id } })).usedAt).toBeNull();

    // The session they had: API routes and pages treat them as signed out, the page sends them
    // to sign-in with the reason (sign-in is outside the proxy, so no loop).
    const request = new Request("http://localhost:3000/api/x", {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    });
    expect(await getUserFromRequest(request)).toBeNull();
    jar.token = token;
    expect(await getCurrentUser()).toBeNull();
    const redirect = await requireUser().catch((error: { digest?: string }) => error.digest);
    expect(redirect).toContain("/login?error=deactivated");

    // Turned back on: the same session works again.
    await reactivateUser(owner, a1.id);
    expect((await getCurrentUser())?.id).toBe(a1.id);
  });

  it("the bot says once that access is off and does nothing else", async () => {
    const { owner, a1 } = await company();
    const invite = await createInvite(owner, "MEMBER");
    await deactivateUser(owner, a1.id);
    const { bot, calls } = testBot();
    await bot.handleUpdate(message(a1.telegramId, "Подготовить отчёт до пятницы"));
    await bot.handleUpdate(message(a1.telegramId, "/start"));
    await bot.handleUpdate(message(a1.telegramId, `/start ${invite.code}`));
    await bot.handleUpdate(message(a1.telegramId, "/today"));
    const sent = calls.filter((c) => c.method === "sendMessage");
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.text).toBe(
      "Ваш доступ к Assistant отключён. Если это ошибка — обратитесь к руководителю.",
    );
    expect(await db.botDraft.count()).toBe(0);
    expect((await db.invite.findUniqueOrThrow({ where: { id: invite.id } })).usedAt).toBeNull();
  });

  it("gets no notifications, digests or reminders", async () => {
    const { owner, a1 } = await company();
    await updateSettings(a1.id, {
      timezone: "Asia/Tashkent",
      telegramEnabled: true,
      quietHoursStart: null,
      quietHoursEnd: null,
      disabledTypes: [],
      digestTime: 510,
    });
    await createTask(a1, taskInput({ isPersonal: true, dueDate: "2026-11-09" }), "start");
    const meeting = await createMeeting(owner, {
      title: "Планёрка",
      startsLocal: "2026-11-09T14:10",
      durationMinutes: 30,
      agenda: "",
      link: "",
      participantIds: [a1.id],
      repeatUntil: null,
    });
    await deactivateUser(owner, a1.id);
    const before = await notices(a1.id);
    telegramMock.mockClear();

    expect(await notify(a1.id, { type: "test", title: "Тестовое уведомление" })).toBeNull();
    // 03:35 UTC = 08:35 in Tashkent: digest time; 09:00 UTC = 14:00: the meeting is 10 minutes off.
    const writeDigest = async () => "Текст дайджеста";
    await runSchedulerTick(new Date("2026-11-09T03:35:00Z"), { writeDigest });
    await runSchedulerTick(new Date("2026-11-09T09:00:00Z"), { writeDigest });
    expect(await notices(a1.id)).toBe(before);
    expect(telegramMock.mock.calls.filter(([chat]) => chat === a1.botChatId)).toEqual([]);
    // They stay in the meeting's history.
    const detail = await getMeetingDetail(owner, meeting.id);
    expect(detail?.meeting.participants.map((p) => p.userId)).toContain(a1.id);
  });

  it("drops out of every people picker but stays in the history by name", async () => {
    const { owner, manager, a1, a2 } = await company();
    const given = await createTask(
      manager,
      taskInput({ title: "История", assigneeId: a1.id }),
      "create",
    );
    await changeStatus(a1, given.id, "IN_PROGRESS");
    await addComment(a1, given.id, "Сделал половину");
    await db.user.update({ where: { id: a1.id }, data: { role: "MANAGER" } });
    await deactivateUser(owner, a1.id);

    // Pickers: assignees, co-assignees, managers, content authors.
    expect((await listAssignableUsers()).map((u) => u.id)).not.toContain(a1.id);
    expect((await listManagerCandidates()).map((u) => u.id)).not.toContain(a1.id);
    expect((await listContentAuthors()).map((u) => u.id)).not.toContain(a1.id);
    // …but a form that already holds them keeps them.
    expect((await listAssignableUsers([a1.id])).map((u) => u.id)).toContain(a1.id);
    // No new work, co-assignment, meeting or mention reaches them.
    await expect(
      createTask(owner, taskInput({ assigneeId: a1.id }), "create"),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(addCoAssignee(owner, given.id, a1.id)).rejects.toMatchObject({ code: "invalid" });
    const meeting = await createMeeting(owner, {
      title: "Без него",
      startsLocal: "2026-11-20T10:00",
      durationMinutes: 30,
      agenda: "",
      link: "",
      participantIds: [a1.id, a2.id],
      repeatUntil: null,
    });
    expect(
      (await db.meetingParticipant.findMany({ where: { meetingId: meeting.id } }))
        .map((p) => p.userId)
        .sort(),
    ).toEqual([owner.id, a2.id].sort());
    const mentionsBefore = await notices(a1.id);
    await addComment(manager, given.id, "@Тестазиз посмотри");
    expect(await notices(a1.id)).toBe(mentionsBefore);
    // The team list shows them only under «Отключённые».
    expect((await listTeamCards(owner)).map((c) => c.user.id)).not.toContain(a1.id);
    expect((await listTeamCards(owner, "deactivated")).map((c) => c.user.id)).toEqual([a1.id]);

    // History: the task, their comment and the activity keep them by name; the card opens.
    const detail = await getTaskDetail(owner, given.id);
    expect(detail?.task.assignee).toMatchObject({ id: a1.id, firstName: "Тестазиз" });
    expect(detail?.task.assignee.deactivatedAt).not.toBeNull();
    expect((await listComments(given.id)).map((c) => c.author.firstName)).toContain("Тестазиз");
    expect(await db.activityLog.count({ where: { actorId: a1.id } })).toBeGreaterThan(0);
    const ofA1 = await listTasks(owner, parseTaskFilters({ person: a1.id }), TODAY);
    expect(ofA1.map((t) => t.id)).toEqual([given.id]);
    expect((await listTaskPeople(owner)).map((p) => p.id)).toContain(a1.id);
    expect((await getEmployeeCard(owner, a1.id))?.user.deactivatedAt).not.toBeNull();
  });

  it("their place in the org chart shows as off; their people move up and come back", async () => {
    const { owner, a1, a2, loose } = await company();
    await db.user.update({ where: { id: a1.id }, data: { role: "MANAGER" } });
    const top = await saveOrgNode(owner, null, {
      kind: "POSITION",
      title: "Директор",
      userId: owner.id,
    });
    const lead = await saveOrgNode(owner, null, {
      kind: "POSITION",
      title: "Руководитель группы",
      userId: a1.id,
      parentId: top.id,
    });
    await saveOrgNode(owner, null, {
      kind: "POSITION",
      title: "Специалист",
      userId: a2.id,
      parentId: lead.id,
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: a2.id } })).managerId).toBe(a1.id);

    await deactivateUser(owner, a1.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: a2.id } })).managerId).toBe(owner.id);
    // The manager above them stays as is.
    expect((await db.user.findUniqueOrThrow({ where: { id: a1.id } })).managerId).toBe(owner.id);
    const [root] = await getOrgTree();
    expect(root.children[0].user).toMatchObject({ id: a1.id, deactivated: true });
    // Editing their own place keeps them; a new place can't take them.
    await saveOrgNode(owner, lead.id, {
      kind: "POSITION",
      title: "Старший руководитель группы",
      userId: a1.id,
      parentId: top.id,
    });
    await deactivateUser(owner, loose.id);
    await expect(
      saveOrgNode(owner, null, { kind: "POSITION", title: "Другое место", userId: loose.id }),
    ).rejects.toMatchObject({ code: "notFound" });

    await reactivateUser(owner, a1.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: a2.id } })).managerId).toBe(a1.id);
  });
});

async function countWaitingFor(userId: string) {
  const [tasks, reviews, requests] = await Promise.all([
    db.task.count({ where: { status: "PENDING_APPROVAL", deciderIds: { has: userId } } }),
    db.task.count({ where: { status: { notIn: ["DONE", "CANCELLED"] }, reviewerId: userId } }),
    db.taskCoAssigneeRequest.count({ where: { deciderIds: { has: userId } } }),
  ]);
  return tasks + reviews + requests;
}
