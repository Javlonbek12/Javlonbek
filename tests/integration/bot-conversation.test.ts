import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { AiError } from "@/modules/ai/run";
import type { InterpretedCommand } from "@/modules/ai/prompts";
import {
  handleCallback,
  handleText,
  handleVoice,
  showList,
  unknownReply,
  type ConversationDeps,
} from "@/modules/bot/conversation";
import { commandsFor } from "@/modules/bot/commands";
import { rememberReasonMessage } from "@/modules/bot/decisions";
import type { DraftPayload } from "@/modules/bot/draft-card";
import { MockStt } from "@/modules/stt";
import { addCoAssignee } from "@/modules/tasks/co-assignees";
import { requestTaskDeletion } from "@/modules/tasks/delete-service";
import { changeStatus, createTask } from "@/modules/tasks/service";
import { PHRASES, TODAY } from "@/tests/fixtures/phrases";
import { resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";
import { createFixtureTeam } from "@/tests/helpers/team";
import { telegramMock } from "@/tests/helpers/telegram";

const NOW = new Date(`${TODAY}T09:00:00+05:00`);
const CHAT = 9000001n;
const create: InterpretedCommand = { intent: "create_tasks", taskQuery: null, newDueDate: null };

function depsFor(phrase: (typeof PHRASES)[number], command = create): ConversationDeps {
  return { now: NOW, interpret: async () => command, extract: async () => phrase.model };
}

async function latestDraft() {
  const draft = await db.botDraft.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  return { ...draft, payload: draft.payload as unknown as DraftPayload };
}

describe("text → confirmation card (18 phrases: Russian, Uzbek, mixed)", () => {
  beforeEach(resetDb);

  it.each(PHRASES.map((p) => [p.lang, p.text, p] as const))(
    "[%s] %s",
    async (_lang, _text, phrase) => {
      const users = await createFixtureTeam();
      const reply = await handleText(users.owner, CHAT, phrase.text, depsFor(phrase));
      expect(reply.draftId).toBeDefined();
      const { payload } = await latestDraft();
      expect(payload.tasks).toHaveLength(phrase.expect.length);
      phrase.expect.forEach((expected, i) => {
        const task = payload.tasks[i];
        expect(task.unresolved).toBe(false);
        expect(task.assigneeId).toBe(
          expected.assignee === "me" ? null : users[expected.assignee].id,
        );
        expect(task.dueDate).toBe(expected.dueDate);
        if (expected.priority) expect(task.priority).toBe(expected.priority);
        if (expected.project) expect(task.project).toBe(expected.project);
      });
      // The card offers save / cancel.
      expect(reply.buttons?.[0].map((b) => b.data)).toEqual([
        `d:${reply.draftId}:save`,
        `d:${reply.draftId}:cancel`,
      ]);
    },
  );
});

describe("confirmation card actions", () => {
  beforeEach(resetDb);

  it("saves: own task as a team task on oneself (in work at once), others' approved right away by the OWNER", async () => {
    const users = await createFixtureTeam();
    const phrase = PHRASES.find((p) => p.model.length === 3)!;
    const reply = await handleText(users.owner, CHAT, phrase.text, depsFor(phrase));
    const saved = await handleCallback(users.owner, `d:${reply.draftId}:save`, {
      ...depsFor(phrase),
    });
    expect(saved.text).toContain("Сохранено задач: 3");

    const tasks = await db.task.findMany({ orderBy: { createdAt: "asc" } });
    expect(tasks.map((t) => [t.isPersonal, t.status, t.assigneeId === users.owner.id])).toEqual([
      [false, "IN_PROGRESS", true],
      [false, "APPROVED", false],
      [false, "APPROVED", false],
    ]);
    expect(await db.botDraft.count()).toBe(0);
  });

  it("a task asked for as personal stays personal; «Я (личная)» in the card makes one", async () => {
    const users = await createFixtureTeam();
    const phrase = PHRASES.find((p) => p.model.length === 3)!;
    const personal = {
      ...phrase,
      model: phrase.model.map((task, i) => (i === 0 ? { ...task, personal: true } : task)),
    };
    const reply = await handleText(users.aziz, 9000002n, personal.text, depsFor(personal));
    expect(reply.text).toContain("👤 я (личная)");
    expect(reply.text).toContain("↪ личная");
    // The second task (someone else's) the user takes on themselves as a personal one.
    await handleCallback(users.aziz, `d:${reply.draftId}:av:1:mine`);
    await handleCallback(users.aziz, `d:${reply.draftId}:save`);
    const tasks = await db.task.findMany({ orderBy: { createdAt: "asc" } });
    // Personal ones start in work, as from the web form.
    expect(tasks.slice(0, 2).map((t) => [t.isPersonal, t.assigneeId, t.status])).toEqual([
      [true, users.aziz.id, "IN_PROGRESS"],
      [true, users.aziz.id, "IN_PROGRESS"],
    ]);
  });

  it("the card shows each task's route; a task for another team waits for its manager", async () => {
    const users = await createFixtureTeam();
    await db.user.update({ where: { id: users.dilnoza.id }, data: { managerId: users.sardor.id } });
    const phrase = PHRASES[1]; // for Dilnoza
    const reply = await handleText(users.aziz, 9000002n, phrase.text, depsFor(phrase));
    expect(reply.text).toContain("↪ на утверждение: Sardor");
    const saved = await handleCallback(users.aziz, `d:${reply.draftId}:save`);
    expect(saved.text).toContain("Отправлено на утверждение: 1");
    expect(await db.task.findFirstOrThrow()).toMatchObject({
      status: "PENDING_APPROVAL",
      deciderIds: [users.sardor.id],
    });
  });

  it("a task for a colleague in the same team starts right away", async () => {
    const users = await createFixtureTeam();
    const phrase = PHRASES[1]; // for Dilnoza
    const reply = await handleText(users.aziz, 9000002n, phrase.text, depsFor(phrase));
    expect(reply.text).toContain("↪ сразу");
    await handleCallback(users.aziz, `d:${reply.draftId}:save`);
    expect((await db.task.findFirstOrThrow()).status).toBe("APPROVED");
  });

  it("asks with buttons when the name is ambiguous, then saves", async () => {
    const users = await createFixtureTeam();
    await db.user.create({
      data: { firstName: "Азиз", lastName: "Рахимов", telegramId: 9000099n, role: "MEMBER" },
    });
    const reply = await handleText(users.owner, CHAT, "Азизу отчёт", depsFor({ ...PHRASES[0] }));
    expect(reply.text).toContain("❓ «Азиз» — кто это?");
    const choice = reply.buttons!.flat().find((b) => b.text.includes("Каримов"))!;
    // Saving is not possible until the person is chosen.
    expect(reply.buttons!.flat().some((b) => b.data.endsWith(":save"))).toBe(false);
    const after = await handleCallback(users.owner, choice.data);
    expect(after.text).toContain("👤 Азиз Каримов");
    expect(after.buttons![0][0].data).toBe(`d:${reply.draftId}:save`);
  });

  it("edits the title by text, the due date by button, and the assignee", async () => {
    const users = await createFixtureTeam();
    const reply = await handleText(users.owner, CHAT, PHRASES[0].text, depsFor(PHRASES[0]));
    const id = reply.draftId!;

    await handleCallback(users.owner, `d:${id}:t:0`);
    const renamed = await handleText(
      users.owner,
      CHAT,
      "Отчёт по продажам ESSE",
      depsFor(PHRASES[0]),
    );
    expect(renamed.text).toContain("1. Отчёт по продажам ESSE");

    await handleCallback(users.owner, `d:${id}:dv:0:20261009`);
    await handleCallback(users.owner, `d:${id}:av:0:${users.dilnoza.id}`);
    const { payload } = await latestDraft();
    expect(payload.tasks[0]).toMatchObject({
      title: "Отчёт по продажам ESSE",
      dueDate: "2026-10-09",
      assigneeId: users.dilnoza.id,
    });

    await handleCallback(users.owner, `d:${id}:dt:0`);
    expect(
      (await handleText(users.owner, CHAT, "когда-нибудь", depsFor(PHRASES[0]))).text,
    ).toContain("Не понял дату");
    await handleText(users.owner, CHAT, "пятница", depsFor(PHRASES[0]));
    expect((await latestDraft()).payload.tasks[0].dueDate).toBe("2026-10-02");
  });

  it("cancel removes the card; someone else cannot press its buttons", async () => {
    const users = await createFixtureTeam();
    const reply = await handleText(users.owner, CHAT, PHRASES[0].text, depsFor(PHRASES[0]));
    expect((await handleCallback(users.aziz, `d:${reply.draftId}:save`)).text).toContain(
      "устарела",
    );
    expect((await handleCallback(users.owner, `d:${reply.draftId}:cancel`)).text).toBe("Отменено.");
    expect(await db.task.count()).toBe(0);
  });

  it("without AI the message becomes one task the user can edit", async () => {
    const users = await createFixtureTeam();
    const deps: ConversationDeps = {
      now: NOW,
      interpret: async () => {
        throw new AiError("not_configured");
      },
      extract: async () => [],
    };
    const reply = await handleText(users.owner, CHAT, "Проверить цены в Корзинке", deps);
    expect(reply.text).toContain("ИИ сейчас недоступен");
    expect((await latestDraft()).payload.tasks[0].title).toBe("Проверить цены в Корзинке");
  });
});

describe("voice", () => {
  beforeEach(resetDb);

  it("mock speech recognition → the same card, with the recognized text shown", async () => {
    const users = await createFixtureTeam();
    const phrase = PHRASES[3];
    const stt = new MockStt(phrase.text);
    const reply = await handleVoice(
      users.owner,
      CHAT,
      { data: new Uint8Array([1]), fileName: "v.ogg", mimeType: "audio/ogg" },
      5,
      stt,
      depsFor(phrase),
    );
    expect(reply.text).toContain(`🎙 Распознано: «${phrase.text}»`);
    expect((await latestDraft()).payload.tasks[0].assigneeId).toBe(users.sardor.id);
  });

  it("refuses voice messages longer than 5 minutes", async () => {
    const users = await createFixtureTeam();
    const reply = await handleVoice(
      users.owner,
      CHAT,
      { data: new Uint8Array(), fileName: "v", mimeType: "audio/ogg" },
      301,
      new MockStt("x"),
    );
    expect(reply.text).toContain("слишком длинное");
  });
});

describe("commands and natural requests", () => {
  beforeEach(resetDb);

  it("/today, /overdue and /pending with approve buttons", async () => {
    const users = await createFixtureTeam();
    await createTask(
      users.owner,
      taskInput({ title: "Сегодняшняя", isPersonal: true, dueDate: TODAY }),
    );
    await createTask(
      users.owner,
      taskInput({ title: "Старая", isPersonal: true, dueDate: "2026-09-20" }),
    );
    const pending = await createTask(
      users.aziz,
      taskInput({ title: "На утверждение", assigneeId: users.dilnoza.id }),
      "create",
      { needsApproval: true },
    );

    // Numbered, with bold headers; in «🔥 Просрочено» the lines carry no 🔥 of their own.
    const today = await showList(users.owner, "today", NOW);
    expect(today.text).toContain("<b>📋 На сегодня (1)</b>\n1. Сегодняшняя");
    expect(today.text.endsWith("<b>🔥 Просрочено (1)</b>\n2. Старая — 20 сент.")).toBe(true);
    expect(today).toMatchObject({ html: true, open: "/" });
    // «✅ 1», «✅ 2» close a task in one tap; «📅 Перенести срок» asks which one.
    expect(today.buttons!.map((row) => row.map((b) => b.text))).toEqual([
      ["✅ 1", "✅ 2"],
      ["📅 Перенести срок"],
    ]);
    expect((await showList(users.owner, "overdue", NOW)).text).toContain("1. Старая");

    const list = await showList(users.owner, "pending", NOW);
    expect(list.text).toContain("1. На утверждение");
    // Two buttons per task, each with the task's number.
    expect(list.buttons![0]).toEqual([
      { text: "1 ✅ Утвердить", data: `t:${pending.id}:A:l` },
      { text: "1 ↩️ Отклонить", data: `t:${pending.id}:D:l` },
    ]);

    // Under a notice: the result in place of the notice.
    const approved = await handleCallback(users.owner, `t:${pending.id}:A`);
    expect(approved).toMatchObject({ edit: true });
    expect(approved.text).toContain("Утверждена: «На утверждение»");
    expect((await db.task.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(
      "APPROVED",
    );
  });

  it("/pending: a button redraws the list — the decided row goes, the others keep their buttons", async () => {
    const users = await createFixtureTeam();
    const tasks: { id: string }[] = [];
    for (let i = 1; i <= 12; i++)
      tasks.push(
        await createTask(
          users.aziz,
          taskInput({ title: `Запрос ${i}`, assigneeId: users.dilnoza.id }),
          "create",
          { needsApproval: true },
        ),
      );
    const list = await showList(users.owner, "pending", NOW);
    // Every listed item has its buttons (not only the first 8).
    expect(list.buttons).toHaveLength(12);
    const reply = await handleCallback(users.owner, `t:${tasks[0]!.id}:A:l`);
    expect(reply.edit).toBe(true);
    expect(reply.text.split("\n\n")[0]).toBe("Утверждена: «Запрос 1» (Тестовый владелец)");
    expect(reply.text).toContain("Ждут вашего решения (11)");
    expect(reply.buttons).toHaveLength(11);
    expect(reply.buttons!.flat().some((b) => b.data.includes(tasks[0]!.id))).toBe(false);
  });

  it("«✖️» asks «Отменить задачу?» first; «Нет» keeps it, «Да» cancels", async () => {
    const users = await createFixtureTeam();
    const task = await createTask(
      users.aziz,
      taskInput({ title: "Выставка", assigneeId: users.dilnoza.id }),
      "create",
      { needsApproval: true },
    );
    // /pending has no ✖️ any more: cancelling is on the site or under the notice.
    const list = await showList(users.owner, "pending", NOW);
    expect(list.buttons!.flat().some((b) => b.data.endsWith(":C:l"))).toBe(false);
    const statusOf = async () =>
      (await db.task.findUniqueOrThrow({ where: { id: task.id } })).status;
    const ask = await handleCallback(users.owner, `t:${task.id}:C`);
    expect(ask.text).toContain("Отменить задачу «Выставка»?");
    const kept = await handleCallback(users.owner, `tc:${task.id}:n`);
    expect(kept.text).toContain("остаётся");
    expect(await statusOf()).toBe("PENDING_APPROVAL");

    // Under a notice: the question comes as a message of its own.
    const question = await handleCallback(users.owner, `t:${task.id}:C`);
    expect(question.edit).toBeFalsy();
    expect(question.buttons![0]!.map((b) => b.data)).toEqual([
      `tc:${task.id}:y`,
      `tc:${task.id}:n`,
    ]);
    const cancelled = await handleCallback(users.owner, `tc:${task.id}:y`);
    expect(cancelled.text).toContain("Отменена: «Выставка»");
    expect(await statusOf()).toBe("CANCELLED");
  });

  it("declining from /pending asks for the reason and sends it to the author", async () => {
    const users = await createFixtureTeam();
    const pending = await createTask(
      users.aziz,
      taskInput({ title: "Нужна причина", assigneeId: users.dilnoza.id }),
      "create",
      { needsApproval: true },
    );
    const ask = await handleCallback(users.owner, `t:${pending.id}:D`);
    expect(ask.text).toContain("Напишите причину");
    expect((await db.task.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(
      "PENDING_APPROVAL",
    );
    const done = await handleText(
      users.owner,
      CHAT,
      "Сначала закроем прошлую",
      depsFor(PHRASES[0]),
    );
    expect(done.text).toContain("Черновик");
    const notice = await db.notification.findFirst({
      where: { userId: users.aziz.id, title: "Задача отклонена" },
    });
    expect(notice?.body).toContain("Сначала закроем прошлую");
  });

  it("a reason is a reply to the question (or a message within 5 minutes); «Отмена» drops it", async () => {
    const users = await createFixtureTeam();
    const pending = await createTask(
      users.aziz,
      taskInput({ title: "Нужна причина", assigneeId: users.dilnoza.id }),
      "create",
      { needsApproval: true },
    );
    const statusOf = async () =>
      (await db.task.findUniqueOrThrow({ where: { id: pending.id } })).status;
    const ask = await handleCallback(users.owner, `t:${pending.id}:D`);
    expect(ask).toMatchObject({ reasonPrompt: true });
    expect(ask.buttons![0]![0]!.data).toBe("rc");
    await rememberReasonMessage(users.owner.id, 501);

    // Ten minutes later a plain message is just a message (here, a new task), not the reason.
    const key = `bot.reason:${users.owner.id}`;
    const state = JSON.parse((await db.systemState.findUniqueOrThrow({ where: { key } })).value);
    await db.systemState.update({
      where: { key },
      data: { value: JSON.stringify({ ...state, at: Date.now() - 10 * 60_000 }) },
    });
    const card = await handleText(users.owner, CHAT, PHRASES[0].text, depsFor(PHRASES[0]));
    expect(card.draftId).toBeDefined();
    // A reply to some other message is not the reason either.
    await handleCallback(users.owner, `d:${card.draftId}:cancel`);
    const other = await handleText(users.owner, CHAT, "Позже", depsFor(PHRASES[0]), undefined, 777);
    expect(other.draftId).toBeDefined();
    expect(await statusOf()).toBe("PENDING_APPROVAL");
    // A reply to the question is.
    const done = await handleText(
      users.owner,
      CHAT,
      "Не в этом месяце",
      depsFor(PHRASES[0]),
      undefined,
      501,
    );
    expect(done.text).toContain("Черновик");
    expect(await statusOf()).toBe("DRAFT");

    // «Отмена»: nothing waits any more, the next message is handled as usual.
    const again = await createTask(
      users.aziz,
      taskInput({ title: "Ещё одна", assigneeId: users.dilnoza.id }),
      "create",
      { needsApproval: true },
    );
    await handleCallback(users.owner, `t:${again.id}:D`);
    expect((await handleCallback(users.owner, "rc")).text).toBe("Хорошо, ничего не меняем.");
    const next = await handleText(users.owner, CHAT, PHRASES[0].text, depsFor(PHRASES[0]));
    expect(next.draftId).toBeDefined();
    expect((await db.task.findUniqueOrThrow({ where: { id: again.id } })).status).toBe(
      "PENDING_APPROVAL",
    );
  });

  it("notices come with the decision buttons: approve / decline, accept / return, add / decline", async () => {
    const users = await createFixtureTeam();
    telegramMock.mockClear();
    const buttonsFor = (chatId: bigint) =>
      telegramMock.mock.calls
        .filter(([chat]) => chat === chatId)
        .map(([, , buttons]) => buttons?.flat().map((b) => b.data) ?? []);
    const pending = await createTask(
      users.aziz,
      taskInput({ title: "Ждёт", assigneeId: users.dilnoza.id }),
      "create",
      { needsApproval: true },
    );
    expect(buttonsFor(users.owner.botChatId!)).toContainEqual([
      `t:${pending.id}:A`,
      `t:${pending.id}:D`,
    ]);

    const work = await createTask(
      users.aziz,
      taskInput({ title: "Сдать", assigneeId: users.dilnoza.id }),
      "create",
    );
    await changeStatus(users.dilnoza, work.id, "IN_PROGRESS");
    await changeStatus(users.dilnoza, work.id, "IN_REVIEW");
    expect(buttonsFor(users.aziz.botChatId!)).toContainEqual([`t:${work.id}:F`, `t:${work.id}:W`]);
    const accepted = await handleCallback(users.aziz, `t:${work.id}:F`);
    expect(accepted.text).toContain("Выполнена: «Сдать»");

    // Asking to add someone from another team: the request comes with Добавить / Отказать.
    await db.user.update({ where: { id: users.sardor.id }, data: { managerId: users.owner.id } });
    await db.user.update({ where: { id: users.dilnoza.id }, data: { managerId: users.sardor.id } });
    const shared = await createTask(
      users.owner,
      taskInput({ title: "Вместе", assigneeId: users.aziz.id }),
      "create",
    );
    expect(await addCoAssignee(users.aziz, shared.id, users.dilnoza.id)).toBe("requested");
    const request = await db.taskCoAssigneeRequest.findFirstOrThrow();
    expect(buttonsFor(users.sardor.botChatId!)).toContainEqual([
      `ca:${request.id}:y`,
      `ca:${request.id}:n`,
    ]);
    const added = await handleCallback(users.sardor, `ca:${request.id}:y`);
    expect(added.text).toContain("Дильноза Юсупова — соисполнитель задачи «Вместе»");
    expect((await db.task.findUniqueOrThrow({ where: { id: shared.id } })).coAssigneeIds).toEqual([
      users.dilnoza.id,
    ]);
  });

  it("asks to delete come with Delete / Keep buttons in /pending", async () => {
    const users = await createFixtureTeam();
    const task = await createTask(
      users.aziz,
      taskInput({ title: "Лишняя", assigneeId: users.dilnoza.id }),
      "create",
    );
    await changeStatus(users.dilnoza, task.id, "IN_PROGRESS");
    await requestTaskDeletion(users.aziz, task.id, "Дубль");
    const list = await showList(users.owner, "pending", NOW);
    expect(list.text).toContain("1. Лишняя · просят удалить");
    const row = list.buttons!.find((r) => r[0]!.data === `x:${task.id}:y:l`)!;
    expect(row[1]!.data).toBe(`x:${task.id}:n:l`);
    const kept = await handleCallback(users.owner, `x:${task.id}:n:l`);
    expect(kept.text).toContain("осталась");
    expect(kept.text).toContain("Ждут вашего решения (0)");
    expect(await db.task.count({ where: { id: task.id } })).toBe(1);
  });

  it("a refused button says why and who decides, not just «недоступно»", async () => {
    const users = await createFixtureTeam();
    const pending = await createTask(
      users.aziz,
      taskInput({ assigneeId: users.dilnoza.id }),
      "create",
      { needsApproval: true },
    );
    // The author can't approve their own request: the owner decides.
    expect((await handleCallback(users.aziz, `t:${pending.id}:A`)).text).toBe(
      "Это решает: Тестовый владелец.",
    );
    // The assignee doesn't see the task before it is approved.
    expect((await handleCallback(users.dilnoza, `t:${pending.id}:A`)).text).toContain(
      "Задача недоступна",
    );
    // Someone else decided first.
    await changeStatus(users.owner, pending.id, "APPROVED");
    expect((await handleCallback(users.owner, `t:${pending.id}:D`)).text).toBe(
      "Решение уже принято: задача сейчас «Утверждена».",
    );
  });

  it("«перенеси» by the assignee: only the author moves the due date, and the bot names them", async () => {
    const users = await createFixtureTeam();
    await createTask(
      users.owner,
      taskInput({ title: "Отчёт по выкладке", assigneeId: users.aziz.id, dueDate: TODAY }),
      "create",
    );
    const move: InterpretedCommand = {
      intent: "reschedule",
      taskQuery: "отчёт выкладке",
      newDueDate: "2026-10-08",
    };
    const reply = await handleText(users.aziz, 9000002n, "перенеси", depsFor(PHRASES[0], move));
    expect(reply.text).toBe(
      "Срок меняет автор задачи — Тестовый владелец. Попросите его или напишите в комментарии к задаче.",
    );
  });

  it("«закрой» a task already handed in: it says who accepts it", async () => {
    const users = await createFixtureTeam();
    const task = await createTask(
      users.owner,
      taskInput({ title: "Выкладка ESSE", assigneeId: users.aziz.id }),
      "create",
    );
    await changeStatus(users.aziz, task.id, "IN_PROGRESS");
    await changeStatus(users.aziz, task.id, "IN_REVIEW");
    const close: InterpretedCommand = {
      intent: "complete",
      taskQuery: "выкладка",
      newDueDate: null,
    };
    const reply = await handleText(users.aziz, 9000002n, "закрой", depsFor(PHRASES[0], close));
    expect(reply.text).toBe("Задача уже на проверке — работу принимает Тестовый владелец.");
  });

  it("«перенеси отчёт на четверг» and «закрой задачу отчёт»", async () => {
    const users = await createFixtureTeam();
    const task = await createTask(
      users.owner,
      taskInput({ title: "Отчёт по остаткам", isPersonal: true, dueDate: TODAY }),
      "start",
    );
    const move: InterpretedCommand = {
      intent: "reschedule",
      taskQuery: "отчёт",
      newDueDate: "2026-10-08",
    };
    const moved = await handleText(
      users.owner,
      CHAT,
      "перенеси отчёт на четверг",
      depsFor(PHRASES[0], move),
    );
    expect(moved.text).toContain("перенесён на 8 окт.");

    const close: InterpretedCommand = {
      intent: "complete",
      taskQuery: "отчёт остаткам",
      newDueDate: null,
    };
    const closed = await handleText(
      users.owner,
      CHAT,
      "закрой задачу отчёт",
      depsFor(PHRASES[0], close),
    );
    expect(closed.text).toContain("Выполнена");
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("DONE");
  });

  it("the assignee «closing» a team task hands it in for review", async () => {
    const users = await createFixtureTeam();
    const task = await createTask(
      users.owner,
      taskInput({ title: "Выставить дисплей", assigneeId: users.aziz.id }),
      "create",
    );
    const close: InterpretedCommand = {
      intent: "complete",
      taskQuery: "дисплей",
      newDueDate: null,
    };
    const reply = await handleText(
      users.aziz,
      9000002n,
      "дисплей выставил",
      depsFor(PHRASES[0], close),
    );
    expect(reply.text).toContain("На проверке");
    await changeStatus(users.owner, task.id, "DONE");
  });

  it("asks which task when several match", async () => {
    const users = await createFixtureTeam();
    await createTask(users.owner, taskInput({ title: "Отчёт по продажам", isPersonal: true }));
    await createTask(users.owner, taskInput({ title: "Отчёт по остаткам", isPersonal: true }));
    const close: InterpretedCommand = { intent: "complete", taskQuery: "отчёт", newDueDate: null };
    const reply = await handleText(users.owner, CHAT, "закрой отчёт", depsFor(PHRASES[0], close));
    expect(reply.text).toBe("Какую задачу вы имеете в виду?");
    expect(reply.buttons).toHaveLength(2);
  });
});

describe("lists you can act on, the summary's buttons, short answers", () => {
  beforeEach(resetDb);

  it("«✅ 1» closes a task and the list comes back with the result on top", async () => {
    const users = await createFixtureTeam();
    const task = await createTask(
      users.owner,
      taskInput({ title: "Отчёт", isPersonal: true, dueDate: TODAY }),
    );
    const reply = await handleCallback(users.owner, `k:${task.id}:today`, depsFor(PHRASES[0]));
    expect(reply.edit).toBe(true);
    expect(reply.text.split("\n\n")[0]).toContain("Отчёт");
    expect(reply.text).toContain("На сегодня (0)");
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("DONE");
  });

  it("«📅 Перенести срок»: which task, then when", async () => {
    const users = await createFixtureTeam();
    const task = await createTask(
      users.owner,
      taskInput({ title: "Отчёт", isPersonal: true, dueDate: TODAY }),
    );
    const deps = depsFor(PHRASES[0]);
    const which = await handleCallback(users.owner, "rs:today", deps);
    expect(which.buttons).toEqual([[{ text: "📅 1. Отчёт", data: `rd:${task.id}` }]]);
    const when = await handleCallback(users.owner, `rd:${task.id}`, deps);
    const tomorrow = when.buttons![0]![0]!;
    expect(tomorrow.text).toContain("Завтра");
    const moved = await handleCallback(users.owner, tomorrow.data, deps);
    expect(moved.text).toContain("перенесён");
  });

  it("a button in the morning summary answers in a new message: the summary keeps the rest", async () => {
    const users = await createFixtureTeam();
    const pending = await createTask(
      users.aziz,
      taskInput({ title: "Ждёт", assigneeId: users.dilnoza.id }),
      "create",
      { needsApproval: true },
    );
    const reply = await handleCallback(users.owner, `t:${pending.id}:A:s`);
    expect(reply.edit).toBeFalsy();
    expect(reply.text).toContain("Утверждена: «Ждёт»");
  });

  it("anything unknown gets a short answer with the main lists; the menu follows the role", async () => {
    expect(
      unknownReply()
        .buttons!.flat()
        .map((b) => b.data),
    ).toEqual(["l:today", "l:pending", "h"]);
    const users = await createFixtureTeam();
    expect((await handleCallback(users.owner, "l:pending")).text).toContain("Ждут вашего решения");
    expect((await handleCallback(users.owner, "h")).text).toContain("/today");
    const member = {
      role: "MEMBER" as const,
      access: { modules: ["meetings"], taskScope: "own" as const, teamIds: [] },
    };
    const names = commandsFor(member, "ru").map((c) => c.command);
    expect(names).toContain("notes");
    expect(names).not.toContain("content");
  });
});
