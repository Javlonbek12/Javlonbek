import { Bot, type Context } from "grammy";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { getEnv } from "@/lib/env";
import type { User } from "@/lib/generated/prisma/client";
import { t, isLocale } from "@/lib/i18n";
import { createRateLimiter } from "@/lib/rate-limit";
import { MAX_FILE_MB, MAX_FILES_PER_LANG } from "@/modules/content/files";
import { ContentError } from "@/modules/content/service";
import { deliverToTelegram } from "@/modules/content/telegram";
import { getUserToday } from "@/modules/core/settings/service";
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
import { rememberReasonMessage } from "./decisions";
import { inlineKeyboard } from "./keyboard";
import { handleStart } from "./start";
import { withLocale } from "@/lib/i18n/server";

const allowMessage = createRateLimiter({ limit: 20, windowMs: 60_000 });
const MAX_TELEGRAM_TEXT = 4000;

async function currentUser(ctx: Context): Promise<User | null> {
  if (!ctx.from) return null;
  const user = await db.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  // The bot shows the same tasks as the site: role settings attached.
  return user && !user.deactivatedAt ? withAccess(user) : null;
}

// A deactivated person hears once (per deactivation) that their access is off; after that the
// bot stays silent and does nothing for them.
async function deactivatedNotice(ctx: Context) {
  const user = await db.user.findFirst({
    where: { telegramId: BigInt(ctx.from!.id), deactivatedAt: { not: null } },
  });
  if (!user) return false;
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
  const { count } = await db.scheduledSend.createMany({
    data: [{ userId: user.id, kind: "access_off", key: user.deactivatedAt!.toISOString() }],
    skipDuplicates: true,
  });
  if (count) await ctx.reply(t("team.deactivation.botOff"));
  return true;
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
  if (reply.reasonPrompt && ctx.user) await rememberReasonMessage(ctx.user.id, message.message_id);
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

  // Everything the bot says comes in the person's language (Russian for unknown people).
  bot.use(async (ctx, next) => {
    const settings = ctx.from
      ? await db.userSettings.findFirst({
          where: { user: { telegramId: BigInt(ctx.from.id) } },
          select: { locale: true },
        })
      : null;
    await withLocale(isLocale(settings?.locale) ? settings.locale : "ru", () => next());
  });

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

  bot.use(async (ctx, next) => {
    if (!(await deactivatedNotice(ctx))) await next();
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

  // Today's approved content-plan posts, one by one, ready to forward into the company bots.
  bot.command("content", async (ctx) => {
    try {
      await deliverToTelegram(ctx.user!, {
        date: await getUserToday(ctx.user!.id, deps.now ?? new Date()),
      });
    } catch (error) {
      if (!(error instanceof ContentError)) throw error;
      await ctx.reply(
        error.code === "nothingToday"
          ? t("content.telegram.botEmpty")
          : t(`content.errors.${error.code}`, { mb: MAX_FILE_MB, max: MAX_FILES_PER_LANG }),
      );
    }
  });

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
    await send(
      ctx,
      await handleText(
        ctx.user!,
        BigInt(ctx.chat.id),
        ctx.message.text,
        deps,
        undefined,
        ctx.message.reply_to_message?.message_id,
      ),
    );
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
