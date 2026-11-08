import ExcelJS from "exceljs";

import { db } from "@/lib/db";
import { isDateString, toDateString } from "@/lib/dates";
import type { ContentChannel } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";
import { matchUser } from "@/modules/org/match";

import {
  canPlanContent,
  changeSendsBackToReview,
  CHANNELS,
  ContentError,
  contentRights,
  listPostsBetween,
  saveContent,
  savePlanItem,
} from "./service";

// The content plan as Excel: download it, edit it (or fill the template), upload it back.
// Rows with an ID update that post; rows without one are added to the plan.

const COLUMNS = [
  { key: "id", header: "ID", width: 28 },
  { key: "date", header: "Дата", width: 12 },
  { key: "time", header: "Время", width: 8 },
  { key: "title", header: "Тема", width: 40 },
  { key: "bots", header: "Боты", width: 26 },
  { key: "author", header: "Автор", width: 22 },
  { key: "status", header: "Статус", width: 14 },
  { key: "brief", header: "Задание", width: 40 },
  { key: "textRu", header: "Текст RU", width: 50 },
  { key: "textUz", header: "Текст UZ", width: 50 },
  { key: "image", header: "Файлы", width: 10 },
  { key: "link", header: "Ссылка", width: 40 },
] as const;
type Key = (typeof COLUMNS)[number]["key"];

const BOT_NAMES: Record<ContentChannel, string> = {
  PARTNER: "Partner",
  CONNECT: "Connect",
  RESEARCH: "Research",
};

export async function exportPlanXlsx(
  actor: Actor,
  from: string,
  to: string,
  appUrl: string,
  channel?: ContentChannel,
): Promise<Buffer> {
  const posts = await listPostsBetween(actor, from, to, channel);
  const book = new ExcelJS.Workbook();
  book.creator = t("app.name");
  const ws = book.addWorksheet(t("content.title"));
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const post of posts) {
    ws.addRow({
      id: post.id,
      date: toDateString(post.publishDate),
      time: post.publishTime ?? "",
      title: post.title,
      bots: post.channels.map((c) => BOT_NAMES[c]).join(", "),
      author: post.author ? displayName(post.author) : "",
      status: t(`content.status.${post.status}`),
      brief: post.brief ?? "",
      textRu: post.textRu ?? "",
      textUz: post.textUz ?? "",
      image: post.files.length ? String(post.files.length) : "",
      link: `${appUrl}/content/${post.id}`,
    } satisfies Record<Key, string>);
  }
  for (const key of ["brief", "textRu", "textUz"] as const)
    ws.getColumn(key).alignment = { wrapText: true, vertical: "top" };
  // A hint sheet: how to fill it in.
  const help = book.addWorksheet("Как заполнять");
  help.columns = [{ width: 100 }];
  for (const line of [
    "Дата — ГГГГ-ММ-ДД или ДД.ММ.ГГГГ. Время — ЧЧ:ММ (можно пусто).",
    "Боты — через запятую: Partner, Connect, Research.",
    "Автор — имя, как в приложении, или @username в Telegram (можно пусто).",
    "Строка с ID обновит этот пост; строка без ID добавит новый пост в план.",
    "Статус, Визуал и Ссылка при загрузке не меняются. Визуал загружается на сайте.",
  ])
    help.addRow([line]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value) return String(value.text);
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    return "";
  }
  return String(value).trim();
};

export function parseDate(value: ExcelJS.CellValue): string | null {
  if (value instanceof Date) return toDateString(value);
  const text = cellText(value);
  if (isDateString(text)) return text;
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  if (ru) {
    const iso = `${ru[3]}-${ru[2]!.padStart(2, "0")}-${ru[1]!.padStart(2, "0")}`;
    return isDateString(iso) ? iso : null;
  }
  return null;
}

export function parseTime(value: ExcelJS.CellValue): string | null | "bad" {
  // Excel keeps times as dates on 1899-12-30.
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  const text = cellText(value);
  if (!text) return null;
  const match = /^(\d{1,2})[:.](\d{2})/.exec(text);
  if (!match) return "bad";
  const time = `${match[1]!.padStart(2, "0")}:${match[2]}`;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "bad";
}

export function parseBots(value: string): ContentChannel[] {
  const text = value.toLowerCase();
  return CHANNELS.filter(
    (c) =>
      text.includes(BOT_NAMES[c].toLowerCase()) ||
      (c === "PARTNER" && /партн/.test(text)) ||
      (c === "CONNECT" && /коннект/.test(text)) ||
      (c === "RESEARCH" && /ресерч|рисерч/.test(text)),
  );
}

// returned: approved posts whose texts changed, so they went back to review.
export type ImportResult = { created: number; updated: number; returned: number; errors: string[] };

export async function importPlanXlsx(actor: Actor, data: Buffer): Promise<ImportResult> {
  if (!canPlanContent(actor)) throw new ContentError("forbidden");
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw new ContentError("invalid");
  }
  const ws = book.worksheets[0];
  if (!ws) throw new ContentError("invalid");
  // Columns by their header, wherever they are.
  const index = new Map<Key, number>();
  ws.getRow(1).eachCell((cell, col) => {
    const name = cellText(cell.value).toLowerCase();
    const column = COLUMNS.find((c) => c.header.toLowerCase() === name);
    if (column) index.set(column.key, col);
  });
  if (!index.has("date") || !index.has("title")) throw new ContentError("invalid");

  const users = await db.user.findMany({
    select: { id: true, firstName: true, lastName: true, telegramUsername: true },
  });
  const result: ImportResult = { created: 0, updated: 0, returned: 0, errors: [] };
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw = (key: Key) => (index.has(key) ? row.getCell(index.get(key)!).value : null);
    const text = (key: Key) => cellText(raw(key));
    if (!text("title") && !text("date") && !text("id")) continue;
    const fail = (why: string) => result.errors.push(`Строка ${r}: ${why}`);

    const date = parseDate(raw("date"));
    if (!date) {
      fail("неверная или пустая дата");
      continue;
    }
    const time = parseTime(raw("time"));
    if (time === "bad") {
      fail("неверное время (нужно ЧЧ:ММ)");
      continue;
    }
    const channels = parseBots(text("bots"));
    if (!channels.length) {
      fail("не указаны боты (Partner, Connect, Research)");
      continue;
    }
    let authorId: string | null = null;
    const author = text("author");
    if (author) {
      authorId = author.startsWith("@")
        ? (users.find((u) => u.telegramUsername?.toLowerCase() === author.slice(1).toLowerCase())
            ?.id ?? null)
        : matchUser(author, users);
      if (!authorId) {
        fail(`автор «${author}» не найден в приложении`);
        continue;
      }
    }
    const id = text("id") || null;
    try {
      const existing = id ? await db.contentPost.findUnique({ where: { id } }) : null;
      if (id && !existing) {
        fail("пост с таким ID не найден");
        continue;
      }
      const textRu = index.has("textRu") ? text("textRu") : (existing?.textRu ?? "");
      const textUz = index.has("textUz") ? text("textUz") : (existing?.textUz ?? "");
      const textsChanged =
        textRu !== (existing?.textRu ?? "") || textUz !== (existing?.textUz ?? "");
      // A downloaded row nobody touched: nothing to do.
      if (
        existing &&
        !textsChanged &&
        existing.title === text("title") &&
        (existing.brief ?? "") === text("brief") &&
        toDateString(existing.publishDate) === date &&
        existing.publishTime === time &&
        existing.authorId === authorId &&
        [...existing.channels].sort().join() === [...channels].sort().join()
      )
        continue;
      const post = await savePlanItem(actor, existing?.id ?? null, {
        title: text("title"),
        brief: text("brief"),
        channels,
        publishDate: date,
        publishTime: time,
        authorId,
      });
      if (textsChanged && contentRights(actor, post).editContent) {
        await saveContent(actor, post.id, { textRu, textUz });
        if (changeSendsBackToReview(post.status)) result.returned += 1;
      }
      if (existing) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      if (!(error instanceof ContentError)) throw error;
      fail(error.code === "state" ? "пост уже отправлен или отменён" : "не удалось сохранить");
    }
  }
  return result;
}
