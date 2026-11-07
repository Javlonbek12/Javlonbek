import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { AiError } from "@/modules/ai/run";
import type { InterpretedCommand } from "@/modules/ai/prompts";
import {
  handleCallback,
  handleText,
  handleVoice,
  showList,
  type ConversationDeps,
} from "@/modules/bot/conversation";
import type { DraftPayload } from "@/modules/bot/draft-card";
import { MockStt } from "@/modules/stt";
import { requestTaskDeletion } from "@/modules/tasks/delete-service";
import { changeStatus, createTask } from "@/modules/tasks/service";
import { PHRASES, TODAY } from "@/tests/fixtures/phrases";
import { resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";
import { createFixtureTeam } from "@/tests/helpers/team";

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

  it("saves: own task as a team task on oneself, others' approved right away by the OWNER", async () => {
    const users = await createFixtureTeam();
    const phrase = PHRASES.find((p) => p.model.length === 3)!;
    const reply = await handleText(users.owner, CHAT, phrase.text, depsFor(phrase));
    const saved = await handleCallback(users.owner, `d:${reply.draftId}:save`, {
      ...depsFor(phrase),
    });
    expect(saved.text).toContain("Сохранено задач: 3");

    const tasks = await db.task.findMany({ orderBy: { createdAt: "asc" } });
    expect(tasks.map((t) => [t.isPersonal, t.status, t.assigneeId === users.owner.id])).toEqual([
      [false, "APPROVED", true],
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
    expect(tasks.slice(0, 2).map((t) => [t.isPersonal, t.assigneeId])).toEqual([
      [true, users.aziz.id],
      [true, users.aziz.id],
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

    const today = await showList(users.owner, "today", NOW);
    expect(today.text).toContain("• Сегодняшняя");
    expect(today.text).toContain("• Старая — 20 сент. 🔥");
    expect((await showList(users.owner, "overdue", NOW)).text).toContain("Старая");

    const list = await showList(users.owner, "pending", NOW);
    expect(list.text).toContain("На утверждение");
    expect(list.buttons![0][0].data).toBe(`t:${pending.id}:A`);

    const approved = await handleCallback(users.owner, `t:${pending.id}:A`);
    expect(approved.text).toContain("Утверждена: «На утверждение»");
    expect((await db.task.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(
      "APPROVED",
    );
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
    expect(list.text).toContain("Просят удалить");
    const row = list.buttons!.find((r) => r[0]!.data === `x:${task.id}:y`)!;
    expect(row[1]!.data).toBe(`x:${task.id}:n`);
    const kept = await handleCallback(users.owner, `x:${task.id}:n`);
    expect(kept.text).toContain("осталась");
    expect(await db.task.count({ where: { id: task.id } })).toBe(1);
  });

  it("a MEMBER pressing an approve button gets a polite refusal", async () => {
    const users = await createFixtureTeam();
    const pending = await createTask(
      users.aziz,
      taskInput({ assigneeId: users.dilnoza.id }),
      "create",
      { needsApproval: true },
    );
    const reply = await handleCallback(users.dilnoza, `t:${pending.id}:A`);
    expect(reply.text).toBe("Это действие вам недоступно.");
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
