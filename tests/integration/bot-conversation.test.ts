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

  it("saves: own task as personal, others' tasks approved right away by the OWNER", async () => {
    const users = await createFixtureTeam();
    const phrase = PHRASES.find((p) => p.model.length === 3)!;
    const reply = await handleText(users.owner, CHAT, phrase.text, depsFor(phrase));
    const saved = await handleCallback(users.owner, `d:${reply.draftId}:save`, {
      ...depsFor(phrase),
    });
    expect(saved.text).toContain("Сохранено задач: 3");

    const tasks = await db.task.findMany({ orderBy: { createdAt: "asc" } });
    expect(tasks.map((t) => [t.isPersonal, t.status])).toEqual([
      [true, "DRAFT"],
      [false, "APPROVED"],
      [false, "APPROVED"],
    ]);
    expect(await db.botDraft.count()).toBe(0);
  });

  it("a MEMBER's task for a colleague goes to approval", async () => {
    const users = await createFixtureTeam();
    const phrase = PHRASES[1]; // for Dilnoza
    const reply = await handleText(users.aziz, 9000002n, phrase.text, depsFor(phrase));
    const saved = await handleCallback(users.aziz, `d:${reply.draftId}:save`);
    expect(saved.text).toContain("Отправлено на утверждение: 1");
    expect((await db.task.findFirstOrThrow()).status).toBe("PENDING_APPROVAL");
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
      taskInput({ title: "На утверждение", assigneeId: users.aziz.id }),
      "submit",
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

  it("a MEMBER pressing an approve button gets a polite refusal", async () => {
    const users = await createFixtureTeam();
    const pending = await createTask(
      users.aziz,
      taskInput({ assigneeId: users.dilnoza.id }),
      "submit",
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
      "approve",
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
