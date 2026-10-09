import path from "node:path";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { fromDateString } from "@/lib/dates";
import type { ContentChannel, ContentPost } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import {
  sendTelegramMedia,
  sendTelegramMessage,
  type MediaItem,
  type TelegramButton,
} from "@/modules/bot/send";
import type { Actor } from "@/modules/core/permissions";

import { listPostFiles } from "./files";
import { canPlanContent, ContentError, markSent } from "./service";

// Sends approved posts to the user's chat with the Assistant bot, one after another, ready to
// forward into the company bots: a header with "sent to …" buttons, then the Russian version
// (photos and videos as an album with the text as its caption, other files as documents), then
// the Uzbek one.

export const CAPTION_LIMIT = 1024;
const CODE: Record<ContentChannel, string> = { PARTNER: "P", CONNECT: "C", RESEARCH: "R" };
const BY_CODE = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k])) as Record<
  string,
  ContentChannel
>;

export type Sender = {
  message: (chatId: bigint, text: string, buttons?: TelegramButton[][]) => Promise<boolean>;
  media: (chatId: bigint, items: MediaItem[], caption: string) => Promise<boolean>;
};
const telegram: Sender = { message: sendTelegramMessage, media: sendTelegramMedia };

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
  post: ContentPost,
  index: { n: number; of: number },
  send: Sender,
) {
  const header = postHeader(post, index);
  if (!(await send.message(chatId, header.text, header.buttons))) return false;
  const root = path.resolve(getEnv().UPLOAD_DIR);
  const files = await listPostFiles(post.id);
  // Russian first, then Uzbek.
  for (const [lang, text] of [
    ["RU", post.textRu],
    ["UZ", post.textUz],
  ] as const) {
    const own = files
      .filter((f) => f.lang === lang)
      .map((f) => ({ kind: f.kind, path: path.join(root, f.path), name: f.name }));
    const album = own.filter((f) => f.kind !== "FILE");
    const documents = own.filter((f) => f.kind === "FILE");
    const body = text ?? "";
    // A caption holds 1024 characters; a longer text goes right after the files.
    const fits = body.length <= CAPTION_LIMIT;
    let captioned = !body;
    for (const group of [album, documents]) {
      if (!group.length) continue;
      await send.media(chatId, group, !captioned && fits ? body : "");
      if (fits) captioned = true;
    }
    if (!captioned) await send.message(chatId, body);
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
    if (await deliverOne(user.botChatId, post, { n: i + 1, of: posts.length }, send))
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
