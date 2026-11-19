import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { createBot } from "@/modules/bot/bot";
import { createInvite } from "@/modules/core/invites/service";
import type { ConversationDeps } from "@/modules/bot/conversation";
import { PHRASES, TODAY } from "@/tests/fixtures/phrases";
import { resetDb } from "@/tests/helpers/db";
import { createFixtureTeam } from "@/tests/helpers/team";

type Call = { method: string; payload: Record<string, unknown> };

// A bot whose outgoing Telegram API calls are recorded instead of sent.
function testBot(deps: ConversationDeps) {
  const calls: Call[] = [];
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
const from = (id: bigint) => ({ id: Number(id), is_bot: false, first_name: "Тест" });
const textUpdate = (id: bigint, text: string) => ({
  update_id: updateId++,
  message: {
    message_id: updateId,
    date: 0,
    chat: { id: Number(id), type: "private" as const, first_name: "Тест" },
    from: from(id),
    text,
    ...(text.startsWith("/")
      ? {
          entities: [
            { type: "bot_command" as const, offset: 0, length: text.split(" ")[0].length },
          ],
        }
      : {}),
  },
});
const callbackUpdate = (id: bigint, data: string) => ({
  update_id: updateId++,
  callback_query: {
    id: String(updateId),
    from: from(id),
    chat_instance: "x",
    data,
    message: {
      message_id: 77,
      date: 0,
      chat: { id: Number(id), type: "private" as const, first_name: "Тест" },
      text: "card",
    },
  },
});

const deps: ConversationDeps = {
  now: new Date(`${TODAY}T09:00:00+05:00`),
  interpret: async () => ({ intent: "create_tasks", taskQuery: null, newDueDate: null }),
  extract: async () => PHRASES[0].model,
};

describe("Telegram bot wiring", () => {
  beforeEach(resetDb);

  it("text message → card with inline buttons → Save button creates the task", async () => {
    const users = await createFixtureTeam();
    const { bot, calls } = testBot(deps);
    await bot.handleUpdate(textUpdate(users.owner.telegramId, PHRASES[0].text));

    const card = calls.find((c) => c.method === "sendMessage")!;
    expect(card.payload.text).toContain("1. Задача");
    const keyboard = (
      card.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] }
    ).inline_keyboard;
    const save = keyboard[0][0].callback_data;
    expect((await db.botDraft.findFirstOrThrow()).messageId).toBe(77);

    await bot.handleUpdate(callbackUpdate(users.owner.telegramId, save));
    expect(calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);
    expect(calls.find((c) => c.method === "editMessageText")?.payload.text).toContain(
      "Сохранено задач: 1",
    );
    expect(await db.task.count()).toBe(1);
  });

  it("/today answers with the list; strangers are asked to link the account", async () => {
    const users = await createFixtureTeam();
    const { bot, calls } = testBot(deps);
    await bot.handleUpdate(textUpdate(users.owner.telegramId, "/today"));
    expect(calls.at(-1)?.payload.text).toContain("📋 На сегодня (0)");

    await bot.handleUpdate(textUpdate(123456789n, "привет"));
    expect(calls.at(-1)?.payload.text).toContain("Я вас пока не знаю");
    expect(calls.at(-1)?.payload.text).toContain("ссылку-приглашение");
  });

  it("a stranger who sends the invite link joins with it; the code alone works too", async () => {
    const users = await createFixtureTeam();
    const { bot, calls } = testBot(deps);
    const first = await createInvite(users.owner, "MEMBER");
    await bot.handleUpdate(
      textUpdate(123456789n, `Вот ссылка: https://example.test/invite/${first.code}`),
    );
    expect(calls.at(-1)?.payload.text).toContain("Добро пожаловать в Assistant");
    expect(await db.user.findUnique({ where: { telegramId: 123456789n } })).toMatchObject({
      role: "MEMBER",
      botChatId: 123456789n,
    });

    const second = await createInvite(users.owner, "MEMBER");
    await bot.handleUpdate(textUpdate(123456790n, second.code));
    expect(calls.at(-1)?.payload.text).toContain("Добро пожаловать в Assistant");

    // A used invite says so.
    await bot.handleUpdate(textUpdate(123456791n, `https://example.test/invite/${first.code}`));
    expect(calls.at(-1)?.payload.text).toContain("уже использовано");
    expect(await db.user.findUnique({ where: { telegramId: 123456791n } })).toBeNull();
  });

  it("/start links the chat", async () => {
    const users = await createFixtureTeam();
    await db.user.update({ where: { id: users.aziz.id }, data: { botChatId: null } });
    const { bot, calls } = testBot(deps);
    await bot.handleUpdate(textUpdate(users.aziz.telegramId, "/start"));
    expect(calls.at(-1)?.payload.text).toContain("Бот подключён");
    expect((await db.user.findUniqueOrThrow({ where: { id: users.aziz.id } })).botChatId).toBe(
      users.aziz.telegramId,
    );
  });
});
