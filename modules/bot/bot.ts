import { Bot } from "grammy";

import { t } from "@/lib/i18n";
import { createRateLimiter } from "@/lib/rate-limit";

import { handleStart } from "./start";

const allowMessage = createRateLimiter({ limit: 20, windowMs: 60_000 });

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // The bot works only in private chats and limits how often one user can write.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.from) return;
    if (!allowMessage(String(ctx.from.id))) {
      await ctx.reply(t("bot.tooManyRequests"));
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

  // Tasks from text and voice arrive in stage 3; until then, show help.
  bot.on("message", (ctx) => ctx.reply(t("bot.help")));

  bot.catch((error) => console.error("Bot error", error.error));

  return bot;
}
