// @vitest-environment node
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { GET as samplesDownload } from "@/app/api/connect/samples/route";
import { db } from "@/lib/db";
import { sampleGuide } from "@/modules/connect/sample-guide";
import { CONNECT_SAMPLES, connectSampleWorkbook, SAMPLE_MARK } from "@/modules/connect/samples";
import { importConnectFiles } from "@/modules/connect/service";
import { withAccess } from "@/modules/core/access/actor";
import { DEFAULT_ROLE_CONFIG, saveRoleConfig } from "@/modules/core/access/config";
import { createSessionToken, SESSION_COOKIE } from "@/modules/core/auth/session";
import { createTestUser, resetDb } from "@/tests/helpers/db";

// The samples file of the upload page: who gets it, what is in it, and that uploading it back
// changes nothing. The samples themselves are synthetic (modules/connect/samples.ts).

const SECRET = "test-session-secret-test-session-secret";
const request = (url: string, userId?: string) =>
  new Request(
    `http://localhost${url}`,
    userId
      ? { headers: { cookie: `${SESSION_COOKIE}=${createSessionToken(userId, SECRET)}` } }
      : undefined,
  );
const sheetsOf = async (response: Response) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await response.arrayBuffer());
  return wb.worksheets;
};
// The samples with the mark taken off: rows a person would put in themselves.
const own = (kinds: string[]) =>
  CONNECT_SAMPLES.map((sample) =>
    kinds.includes(sample.kind)
      ? {
          ...sample,
          rows: sample.rows.map((row) =>
            row.map((cell) =>
              typeof cell === "string" ? cell.replace(SAMPLE_MARK, "").trim() : cell,
            ),
          ),
        }
      : sample,
  );
const stored = async () =>
  Object.fromEntries(
    (await db.connectRecord.groupBy({ by: ["kind"], _count: true })).map((g) => [g.kind, g._count]),
  );

describe("the samples file of the Connect upload page", () => {
  beforeEach(resetDb);

  it("is for those who upload: every kind on a sheet of its own, after a guide", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const named = await createTestUser("MEMBER");
    await saveRoleConfig(owner, { ...DEFAULT_ROLE_CONFIG, connectLeads: [named.id] });

    expect((await samplesDownload(request("/api/connect/samples"))).status).toBe(401);
    expect((await samplesDownload(request("/api/connect/samples", member.id))).status).toBe(403);
    expect(
      (await samplesDownload(request("/api/connect/samples?kind=NOPE", owner.id))).status,
    ).toBe(400);

    // The employee the owner named uploads, so they get the samples too.
    const all = await samplesDownload(request("/api/connect/samples", named.id));
    expect(all.status).toBe(200);
    expect(all.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(decodeURIComponent(all.headers.get("Content-Disposition")!)).toContain(
      "Образцы данных Connect.xlsx",
    );
    const sheets = await sheetsOf(all);
    expect(sheets.map((ws) => ws.name)).toEqual([
      "Что загружать",
      ...CONNECT_SAMPLES.map((s) => s.sheet),
    ]);
    // The guide: a row per kind — what it is, where from, what an upload does, the sheet, the
    // columns it cannot do without — and how to use the file.
    const guide = (sheets[0]!.getSheetValues() as unknown[][])
      .filter(Boolean)
      .map((row) => row.slice(1));
    expect(guide[0]).toEqual([
      "Данные",
      "Что это",
      "Откуда выгрузить",
      "Что происходит при загрузке",
      "Лист с образцом",
      "Без этих колонок файл не загрузится",
    ]);
    expect(guide).toHaveLength(1 + CONNECT_SAMPLES.length + 3);
    const route = guide.find((row) => row[4] === "Анализ маршрута")!;
    expect(route[0]).toBe("Анализ маршрута Smart Up (визиты TSM и DR по дням)");
    expect(route[2]).toBe("Smart Up — «Анализ маршрута» за текущий месяц.");
    expect(route[3]).toBe("заменяет маршруты своего месяца.");
    expect(route[5]).toBe("Рабочая зона, ИД клиента, Итог за неделю");
    expect(String(guide.at(-3)![0])).toContain(SAMPLE_MARK);

    // One kind: its sheet alone, with the guide's row for it.
    const one = await samplesDownload(request("/api/connect/samples?kind=SALE", owner.id));
    expect(decodeURIComponent(one.headers.get("Content-Disposition")!)).toContain(
      "Образец Connect — Продажи (отчёт по продажам).xlsx",
    );
    const single = await sheetsOf(one);
    expect(single.map((ws) => ws.name)).toEqual([
      "Что загружать",
      "Конструктор отчётов по продажам",
    ]);
    expect(single[0]!.getColumn(1).values.filter(Boolean)).toHaveLength(2 + 3);
  });

  it("uploaded as it is changes nothing; with one's own rows only they are loaded", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    // Something of every kind is stored: the samples with the mark taken off.
    const before = await importConnectFiles(owner, [
      {
        name: "own.xlsx",
        buffer: await connectSampleWorkbook({ samples: own(CONNECT_SAMPLES.map((s) => s.kind)) }),
      },
    ]);
    expect(before[0]!.sheets.map((s) => s.kind).sort()).toEqual(
      CONNECT_SAMPLES.map((s) => s.kind).sort(),
    );
    expect(before[0]!.sheets.every((s) => s.created > 0 && s.samples === 0)).toBe(true);
    const was = await stored();
    expect(Object.keys(was)).toHaveLength(CONNECT_SAMPLES.length);

    // The file as downloaded, guide and all: refused, and what replaces on upload (hierarchy,
    // client base, routes, sales, Smart Up visits) is as it was.
    const untouched = await connectSampleWorkbook({ guide: sampleGuide() });
    await expect(
      importConnectFiles(owner, [{ name: "samples.xlsx", buffer: untouched }]),
    ).rejects.toMatchObject({ code: "sample" });
    expect(await stored()).toEqual(was);
    expect(await db.connectImport.count()).toBe(1);

    // Own positions put into the samples file: they are loaded (and replace the hierarchy); the
    // sheets left as samples are passed over, with nothing said about them.
    const mixed = await importConnectFiles(owner, [
      {
        name: "mixed.xlsx",
        buffer: await connectSampleWorkbook({
          guide: sampleGuide(),
          samples: own(["SU_POSITION"]),
        }),
      },
    ]);
    expect(mixed[0]!.sheets.map((s) => s.kind)).toEqual(["SU_POSITION"]);
    expect(mixed[0]!.sheets[0]).toMatchObject({ created: was["SU_POSITION"], samples: 0 });
    expect(await stored()).toEqual(was);

    // A sample row left among one's own is not loaded, and the upload says so.
    const position = CONNECT_SAMPLES.find((s) => s.kind === "SU_POSITION")!;
    const [first, ...rest] = own(["SU_POSITION"]).find((s) => s.kind === "SU_POSITION")!.rows;
    const partly = await importConnectFiles(owner, [
      {
        name: "partly.xlsx",
        buffer: await connectSampleWorkbook({
          kinds: ["SU_POSITION"],
          samples: [{ ...position, rows: [position.rows[0]!, ...rest] }],
        }),
      },
    ]);
    expect(first).toBeDefined();
    expect(partly[0]!.sheets).toMatchObject([
      { kind: "SU_POSITION", created: position.rows.length - 1, samples: 1 },
    ]);
  });
});
