import { z } from "zod";

import { db } from "@/lib/db";
import { todayInTimezone } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import type { ContentBrand, ContentTopic } from "@/lib/generated/prisma/enums";
import { isAiConfigured } from "@/modules/ai/client";
import { AiError, runStructured, type ModelCall } from "@/modules/ai/run";

// Topic and brand of content-plan posts, for the analytics. A background job tags new and
// changed posts: by AI when it is configured, otherwise (or if AI fails) by keywords.
// A topic or brand set by hand is never changed automatically.

export const TOPICS = [
  "PRICES",
  "NEW_PRODUCTS",
  "PROMO",
  "TRAINING",
  "RESEARCH",
  "MOTIVATION",
  "COMPANY_NEWS",
  "SERVICE",
] as const satisfies ContentTopic[];

export const BRANDS = [
  "ESSE",
  "BOHEM",
  "PINE",
  "BLOOMING",
  "SIMPLE",
  "GENERAL",
] as const satisfies ContentBrand[];

type PostText = {
  title: string;
  brief: string | null;
  textRu: string | null;
  textUz: string | null;
};
const fullText = (p: PostText) => [p.title, p.brief, p.textRu, p.textUz].filter(Boolean).join("\n");

const BRAND_WORDS: [ContentBrand, RegExp][] = [
  ["ESSE", /\besse\b|эссе/i],
  ["BOHEM", /\bbohem|бохем|богем/i],
  ["PINE", /\bpine\b|пайн/i],
  ["BLOOMING", /blooming|блуминг/i],
  ["SIMPLE", /\bsimple\b|симпл/i],
];

const TOPIC_WORDS: [ContentTopic, RegExp][] = [
  ["PRICES", /цен|прайс|\brsp\b|\bdsp\b|narx|стоимост/i],
  ["NEW_PRODUCTS", /новинк|новый вкус|запуск|launch|yangi mahsulot|новый формат/i],
  ["PROMO", /акци|бонус|скидк|механик|\d+\s*\+\s*\d+|aksiya|chegirma|подар/i],
  ["TRAINING", /обучен|инструкц|ролик|как правильно|памятк|o['‘’`]?quv|qo['‘’`]?llanma/i],
  ["RESEARCH", /опрос|анкет|исследован|so['‘’`]?rov|ответьте/i],
  ["MOTIVATION", /конкурс|мотивац|приз|рейтинг|победител|tanlov|sovrin/i],
  ["SERVICE", /поддержк|сервис|доставк|заказ|обращени|support|yetkazib/i],
  ["COMPANY_NEWS", /поздрав|праздник|новост|компани|bayram|tabrik/i],
];

// The keyword guess: the first matching brand (or general) and topic (or company news).
export function tagByKeywords(post: PostText): { topic: ContentTopic; brand: ContentBrand } {
  const text = fullText(post);
  const brands = BRAND_WORDS.filter(([, re]) => re.test(text)).map(([b]) => b);
  return {
    brand: brands.length === 1 ? brands[0]! : "GENERAL",
    topic: TOPIC_WORDS.find(([, re]) => re.test(text))?.[0] ?? "COMPANY_NEWS",
  };
}

const tagSchema = z.object({ topic: z.enum(TOPICS), brand: z.enum(BRANDS) });

const TAG_SYSTEM = `You label posts that a tobacco company (KT&G, Uzbekistan) sends to its partner and field-team Telegram bots. The text may be Russian, Uzbek (Latin) or both.
Return exactly one topic and one brand.
Topics:
- PRICES: new or changed prices, price lists, RSP/DSP.
- NEW_PRODUCTS: launches, new SKUs, new formats or flavours.
- PROMO: trade promotions and mechanics (e.g. 10+1), bonuses, discounts, gifts for buying.
- TRAINING: how-to, instructions, training videos, product knowledge.
- RESEARCH: surveys, questionnaires, requests for feedback or data.
- MOTIVATION: contests, ratings, prizes and motivation for the team or partners.
- COMPANY_NEWS: greetings, holidays, company news and announcements.
- SERVICE: support, ordering, delivery, how to contact, service changes.
Brands: ESSE, BOHEM, PINE, BLOOMING, SIMPLE — the one brand the post is mainly about; GENERAL if it is about several brands or none.`;

export async function tagByAi(post: PostText & { createdById: string }, call?: ModelCall) {
  return runStructured({
    userId: post.createdById,
    fn: "tagContent",
    system: TAG_SYSTEM,
    prompt: `Post:\n"""\n${fullText(post).slice(0, 6000)}\n"""`,
    schema: tagSchema,
    today: todayInTimezone(getEnv().DEFAULT_TIMEZONE),
    call,
  });
}

// Tags up to `limit` waiting posts (the scheduler calls this every minute).
export async function tagPendingContent(limit = 10, call?: ModelCall) {
  const posts = await db.contentPost.findMany({
    where: { tagPending: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  let tagged = 0;
  for (const post of posts) {
    let tag = tagByKeywords(post);
    let source = "keywords";
    if (post.tagSource !== "manual" && (call || isAiConfigured())) {
      try {
        tag = await tagByAi(post, call);
        source = "ai";
      } catch (error) {
        if (!(error instanceof AiError)) throw error;
      }
    }
    await db.contentPost.update({
      where: { id: post.id },
      data:
        post.tagSource === "manual"
          ? { tagPending: false }
          : { topic: tag.topic, brand: tag.brand, tagSource: source, tagPending: false },
    });
    tagged += 1;
  }
  return tagged;
}
