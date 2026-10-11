import { z } from "zod";

import { db } from "@/lib/db";
import { todayInTimezone } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import type { ContentBrand } from "@/lib/generated/prisma/enums";
import { isAiConfigured } from "@/modules/ai/client";
import { AiError, runStructured, type ModelCall } from "@/modules/ai/run";

// Topic and brand of content-plan posts, for the analytics. A background job tags new and
// changed posts: by AI when it is configured, otherwise (or if AI fails) by keywords.
// A topic or brand set by hand is never changed automatically.

// The eight built-in sections (their ids); more can be added on the analytics page.
export const BUILT_IN_SECTIONS = [
  "PRICES",
  "NEW_PRODUCTS",
  "PROMO",
  "TRAINING",
  "RESEARCH",
  "MOTIVATION",
  "COMPANY_NEWS",
  "SERVICE",
] as const;

export type Section = { id: string; name: string; description: string | null };

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

const TOPIC_WORDS: [string, RegExp][] = [
  ["PRICES", /цен|прайс|\brsp\b|\bdsp\b|narx|стоимост/i],
  ["NEW_PRODUCTS", /новинк|новый вкус|запуск|launch|yangi mahsulot|новый формат/i],
  ["PROMO", /акци|бонус|скидк|механик|\d+\s*\+\s*\d+|aksiya|chegirma|подар/i],
  ["TRAINING", /обучен|инструкц|ролик|как правильно|памятк|o['‘’`]?quv|qo['‘’`]?llanma/i],
  ["RESEARCH", /опрос|анкет|исследован|so['‘’`]?rov|ответьте/i],
  ["MOTIVATION", /конкурс|мотивац|приз|рейтинг|победител|tanlov|sovrin/i],
  ["SERVICE", /поддержк|сервис|доставк|заказ|обращени|support|yetkazib/i],
  ["COMPANY_NEWS", /поздрав|праздник|новост|компани|bayram|tabrik/i],
];

// Words of a section's name (4+ letters, without endings) to look for in a post.
const nameWords = (name: string) =>
  name
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 4)
    .map((w) => w.slice(0, Math.max(4, w.length - 2)));

// The keyword guess: the first matching brand (or general) and section (built-in words first,
// then the words of the sections' names; otherwise company news, if it exists).
export function tagByKeywords(
  post: PostText,
  sections: Section[] = BUILT_IN_SECTIONS.map((id) => ({ id, name: id, description: null })),
): { topic: string | null; brand: ContentBrand } {
  const text = fullText(post);
  const lower = text.toLowerCase();
  const brands = BRAND_WORDS.filter(([, re]) => re.test(text)).map(([b]) => b);
  const ids = new Set(sections.map((s) => s.id));
  const builtIn = TOPIC_WORDS.find(([id, re]) => ids.has(id) && re.test(text))?.[0];
  const custom = sections.find(
    (s) =>
      !TOPIC_WORDS.some(([id]) => id === s.id) && nameWords(s.name).some((w) => lower.includes(w)),
  )?.id;
  return {
    brand: brands.length === 1 ? brands[0]! : "GENERAL",
    topic:
      custom ?? builtIn ?? (ids.has("COMPANY_NEWS") ? "COMPANY_NEWS" : (sections[0]?.id ?? null)),
  };
}

export async function activeSections(): Promise<Section[]> {
  return db.contentSection.findMany({
    where: { archived: false },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, description: true },
  });
}

// The prompt lists the current sections, so AI uses the ones the team added.
const tagSystem = (
  sections: Section[],
) => `You label posts that a tobacco company (KT&G, Uzbekistan) sends to its partner and field-team Telegram bots. The text may be Russian, Uzbek (Latin) or both.
Return exactly one section (by its id) and one brand.
Sections:
${sections.map((s) => `- ${s.id}: ${s.name}${s.description ? ` — ${s.description}` : ""}`).join("\n")}
Brands: ESSE, BOHEM, PINE, BLOOMING, SIMPLE — the one brand the post is mainly about; GENERAL if it is about several brands or none.`;

export async function tagByAi(
  post: PostText & { createdById: string },
  sections: Section[],
  call?: ModelCall,
) {
  const ids = sections.map((s) => s.id) as [string, ...string[]];
  return runStructured({
    userId: post.createdById,
    fn: "tagContent",
    system: tagSystem(sections),
    prompt: `Post:\n"""\n${fullText(post).slice(0, 6000)}\n"""`,
    schema: z.object({ topic: z.enum(ids), brand: z.enum(BRANDS) }),
    today: todayInTimezone(getEnv().DEFAULT_TIMEZONE),
    call,
  });
}

// Sends posts back for tagging (e.g. after sections changed); hand-set ones stay as they are.
export async function retagPosts(from?: string, to?: string) {
  const { count } = await db.contentPost.updateMany({
    where: {
      tagSource: { not: "manual" },
      ...(from && to
        ? { publishDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }
        : {}),
    },
    data: { tagPending: true },
  });
  return count;
}

// Tags up to `limit` waiting posts (the scheduler calls this every minute).
export async function tagPendingContent(limit = 10, call?: ModelCall) {
  const posts = await db.contentPost.findMany({
    where: { tagPending: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  if (!posts.length) return 0;
  const sections = await activeSections();
  let tagged = 0;
  for (const post of posts) {
    let tag = tagByKeywords(post, sections);
    let source = "keywords";
    if (post.tagSource !== "manual" && sections.length && (call || isAiConfigured())) {
      try {
        tag = await tagByAi(post, sections, call);
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
