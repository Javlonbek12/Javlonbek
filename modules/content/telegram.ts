import { readFile } from "node:fs/promises";

import { db } from "@/lib/db";
import { fromDateString } from "@/lib/dates";
import type { ContentChannel, ContentPost } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import { sendTelegramMessage, sendTelegramPhoto, type TelegramButton } from "@/modules/bot/send";
import type { Actor } from "@/modules/core/permissions";

import { canPlanContent, ContentError, getContentImage, markSent } from "./service";

// Sends approved posts to the user's chat with the Assistant bot, one after another, ready to
// forward into the company bots: a header with "sent to …" buttons, then the visual with the
// Russian text, then the visual with the Uzbek text.

export const CAPTION_LIMIT = 1024;
const CODE: Record<ContentChannel, string> = { PARTNER: "P", CONNECT: "C", RESEARCH: "R" };
const BY_CODE = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k])) as Record<
  string,
  ContentChannel
>;

export type Sender = {
  message: (chatId: bigint, text: string, buttons?: TelegramButton[][]) => Promise<boolean>;
  photo: (chatId: bigint, image: Buffer, caption: string, fileName: string) => Promise<boolean>;
};
const telegram: Sender = { message: sendTelegramMessage, photo: sendTelegramPhoto };

const channelNames = (channels: ContentChannel[]) =>
  channels.map((c) => t(`content.channels.${c}`)).join(", ");

// The header of a delivered post and the buttons for the bots it was not sent to yet.
export function postHeader(post: ContentPost, index?: { n: number; of: number }) {
  const left = post.channels.filter((c) => !post.sentChannels.includes(c));
  const lines = [
    `📌 ${index ? `${index.n}/${index.of} · ` : ""}${post.publishTime ? `${post.publishTime} · ` : ""}${post.title}`,
    `${t("content.channels.label")}: ${channelNames(post.channels)}`,
    left.length ? t("content.telegram.forward") : `✅ ${t("content.telegram.allSent")}`,
  ];
  const buttons: TelegramButton[][] = left.map((c) => [
    {
      text: `✅ ${t("content.actions.markSent", { bot: t(`content.channels.${c}`) })}`,
      data: `cs:${post.id}:${CODE[c]}`,
    },
  ]);
  return { text: lines.join("\n"), buttons };
}

async function deliverOne(
  chatId: bigint,
  actor: Actor,
  post: ContentPost,
  index: { n: number; of: number },
  send: Sender,
) {
  const header = postHeader(post, index);
  if (!(await send.message(chatId, header.text, header.buttons))) return false;
  const image = await getContentImage(actor, post.id);
  const picture = image ? await readFile(image.absolutePath).catch(() => null) : null;
  // Russian first, then Uzbek.
  for (const text of [post.textRu, post.textUz]) {
    if (!text && !picture) continue;
    const body = text ?? "";
    if (picture) {
      // A caption holds 1024 characters; a longer text goes right after the picture.
      const fits = body.length <= CAPTION_LIMIT;
      await send.photo(chatId, picture, fits ? body : "", image!.name);
      if (!fits) await send.message(chatId, body);
    } else {
      await send.message(chatId, body);
    }
  }
  return true;
}

// Approved posts of a day (or one post) to the actor's chat with the bot, in time order.
export async function deliverToTelegram(
  actor: Actor,
  target: { date: string } | { postId: string },
  send: Sender = telegram,
) {
  if (!canPlanContent(actor)) throw new ContentError("forbidden");
  const user = await db.user.findUnique({ where: { id: actor.id } });
  if (!user?.botChatId) throw new ContentError("noBot");
  const posts = await db.contentPost.findMany({
    where:
      "date" in target
        ? { publishDate: fromDateString(target.date), status: "APPROVED" }
        : { id: target.postId, status: { in: ["APPROVED", "SENT"] } },
    orderBy: [{ publishTime: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
  if (!posts.length) throw new ContentError("nothingToday");
  let delivered = 0;
  for (const [i, post] of posts.entries())
    if (await deliverOne(user.botChatId, actor, post, { n: i + 1, of: posts.length }, send))
      delivered += 1;
  return delivered;
}

// The "sent to …" button under a delivered post: marks it and returns the updated header.
export async function handleSentButton(actor: Actor, postId: string, code: string) {
  const channel = BY_CODE[code];
  if (!channel) throw new ContentError("state");
  const post = await db.contentPost.findUnique({ where: { id: postId } });
  if (!post) throw new ContentError("notFound");
  if (post.status === "APPROVED" && !post.sentChannels.includes(channel))
    await markSent(actor, postId, channel);
  return postHeader(await db.contentPost.findUniqueOrThrow({ where: { id: postId } }));
}
