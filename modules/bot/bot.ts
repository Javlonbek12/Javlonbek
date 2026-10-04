import { Bot, type Context } from "grammy";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { User } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import { createRateLimiter } from "@/lib/rate-limit";
import { createSpeechToText, type SpeechToText } from "@/modules/stt";

import {
  defaultDeps,
  handleCallback,
  handleText,
  handleVoice,
  rememberCardMessage,
  showList,
  showMeetingsForNotes,
  type BotReply,
  type ConversationDeps,
} from "./conversation";
import { inlineKeyboard } from "./keyboard";
import { handleStart } from "./start";

const allowMessage = createRateLimiter({ limit: 20, windowMs: 60_000 });
const MAX_TELEGRAM_TEXT = 4000;

async function currentUser(ctx: Context): Promise<User | null> {
  if (!ctx.from) return null;
  return db.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
}

async function send(ctx: Context, reply: BotReply) {
  const text = reply.text.slice(0, MAX_TELEGRAM_TEXT);
  const options = {
    reply_markup: inlineKeyboard(reply.buttons),
    link_preview_options: { is_disabled: true },
  };
  if (reply.edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, options);
      return;
    } catch {
      // The message may be too old to edit; send a new one instead.
    }
  }
  const message = await ctx.reply(text, options);
  if (reply.draftId) await rememberCardMessage(reply.draftId, message.message_id);
}

async function downloadFile(ctx: Context, token: string) {
  const file = await ctx.getFile();
  if (!file.file_path) throw new Error("Telegram returned no file path");
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!response.ok) throw new Error(`File download failed: HTTP ${response.status}`);
  return {
    data: new Uint8Array(await response.arrayBuffer()),
    fileName: file.file_path.split("/").pop() ?? "voice.ogg",
  };
}

export function createBot(
  token: string,
  deps: ConversationDeps = defaultDeps,
  stt?: SpeechToText,
  // Tests pass botInfo here so the bot does not call Telegram on start.
  config?: ConstructorParameters<typeof Bot>[1],
): Bot {
  const bot = new Bot(token, config);

  // The bot works only in private chats and limits how often one user can write.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.from) return;
    if (!allowMessage(String(ctx.from.id))) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery(t("bot.tooManyRequests"));
      else await ctx.reply(t("bot.tooManyRequests"));
      return;
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    const from = ctx.from!;
    const reply = await handleStart(
      {
        telegramId: BigInt(from.id),
        firstName: from.first_name,
        lastName: from.last_name,
        username: from.username,
      },
      BigInt(ctx.chat.id),
      ctx.match,
    );
    await ctx.reply(reply, { link_preview_options: { is_disabled: true } });
  });

  bot.command("help", (ctx) => ctx.reply(t("bot.help")));

  // Everything below needs a known user.
  bot.use(async (ctx, next) => {
    const user = await currentUser(ctx);
    if (!user) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      await ctx.reply(t("bot.notLinked"));
      return;
    }
    ctx.user = user;
    await next();
  });

  bot.command("notes", async (ctx) => send(ctx, await showMeetingsForNotes(ctx.user!, deps.now)));

  for (const kind of ["today", "week", "overdue", "pending"] as const) {
    bot.command(kind, async (ctx) => send(ctx, await showList(ctx.user!, kind, deps.now)));
  }

  bot.on("callback_query:data", async (ctx) => {
    const chatId = BigInt(ctx.chat?.id ?? ctx.from.id);
    const reply = await handleCallback(ctx.user!, ctx.callbackQuery.data, deps, chatId);
    await ctx.answerCallbackQuery();
    await send(ctx, reply);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return ctx.reply(t("bot.help"));
    await ctx.replyWithChatAction("typing");
    await send(ctx, await handleText(ctx.user!, BigInt(ctx.chat.id), ctx.message.text, deps));
  });

  bot.on(["message:voice", "message:audio"], async (ctx) => {
    const media = ctx.message.voice ?? ctx.message.audio!;
    await ctx.replyWithChatAction("typing");
    let reply: BotReply;
    try {
      const file = await downloadFile(ctx, token);
      reply = await handleVoice(
        ctx.user!,
        BigInt(ctx.chat.id),
        { ...file, mimeType: media.mime_type ?? "audio/ogg" },
        media.duration,
        stt ?? createSpeechToText(getEnv()),
        deps,
      );
    } catch (error) {
      console.error("Voice message failed", error);
      reply = { text: t("bot.voiceFailed") };
    }
    await send(ctx, reply);
  });

  bot.on("message", (ctx) => ctx.reply(t("bot.help")));

  bot.catch((error) => console.error("Bot error", error.error));

  return bot;
}

declare module "grammy" {
  interface Context {
    user?: User;
  }
}
