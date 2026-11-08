import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import {
  exportPlanXlsx,
  importPlanXlsx,
  parseBots,
  parseDate,
  parseTime,
} from "@/modules/content/excel";
import { ContentError, savePlanItem } from "@/modules/content/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";

describe("content plan in Excel", () => {
  beforeEach(resetDb);

  it("reads dates, times and bots the way people write them", () => {
    expect(parseDate("2026-10-08")).toBe("2026-10-08");
    expect(parseDate("8.10.2026")).toBe("2026-10-08");
    expect(parseDate(new Date("2026-10-08T00:00:00Z"))).toBe("2026-10-08");
    expect(parseDate("завтра")).toBeNull();
    expect(parseTime("9:30")).toBe("09:30");
    expect(parseTime(new Date("1899-12-30T14:05:00Z"))).toBe("14:05");
    expect(parseTime("")).toBeNull();
    expect(parseTime("25:00")).toBe("bad");
    expect(parseBots("Partner, research")).toEqual(["PARTNER", "RESEARCH"]);
    expect(parseBots("Коннект бот")).toEqual(["CONNECT"]);
    expect(parseBots("")).toEqual([]);
  });

  it("downloads the plan, then updates rows with an ID and adds rows without one", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const author = await createTestUser("MEMBER", { firstName: "Тестовый Автор" });
    const post = await savePlanItem(owner, null, {
      title: "Тестовая тема",
      channels: ["PARTNER"],
      publishDate: "2026-10-08",
    });

    const file = await exportPlanXlsx(owner, "2026-10-01", "2026-10-31", "https://test.example");
    // Uploading it back unchanged changes nothing.
    expect(await importPlanXlsx(owner, file)).toEqual({
      created: 0,
      updated: 0,
      returned: 0,
      errors: [],
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(file as unknown as ArrayBuffer);
    const ws = book.worksheets[0]!;
    expect(ws.getRow(2).getCell(1).value).toBe(post.id);
    // Edit the existing row and add new ones (one good, two broken).
    ws.getRow(2).getCell(4).value = "Тестовая тема (новая)";
    ws.getRow(2).getCell(9).value = "Тестовый текст";
    ws.addRow([
      "",
      "12.10.2026",
      "10:00",
      "Тестовый новый пост",
      "Connect, Research",
      "Тестовый Автор",
    ]);
    ws.addRow(["", "когда-нибудь", "", "Тестовый без даты", "Partner"]);
    ws.addRow(["", "2026-10-13", "", "Тестовый без ботов", ""]);
    const edited = Buffer.from(await book.xlsx.writeBuffer());

    const result = await importPlanXlsx(owner, edited);
    expect(result).toMatchObject({ created: 1, updated: 1 });
    expect(result.errors).toEqual([
      "Строка 4: неверная или пустая дата",
      "Строка 5: не указаны боты (Partner, Connect, Research)",
    ]);
    expect(await db.contentPost.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({
      title: "Тестовая тема (новая)",
      textRu: "Тестовый текст",
      status: "DRAFT",
    });
    expect(
      await db.contentPost.findFirstOrThrow({ where: { title: "Тестовый новый пост" } }),
    ).toMatchObject({
      channels: ["CONNECT", "RESEARCH"],
      publishTime: "10:00",
      authorId: author.id,
    });
  });

  it("everyone with the section uploads; a file that is not Excel is refused", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const member = await withAccess(await createTestUser("MEMBER"));
    const file = await exportPlanXlsx(owner, "2026-10-01", "2026-10-31", "https://test.example");
    await expect(importPlanXlsx(member, file)).resolves.toMatchObject({ errors: [] });
    await expect(importPlanXlsx(owner, Buffer.from("not excel"))).rejects.toBeInstanceOf(
      ContentError,
    );
  });
});
