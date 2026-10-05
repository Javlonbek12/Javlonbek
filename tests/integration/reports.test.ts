// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { GET as download } from "@/app/api/reports/[format]/route";
import { db } from "@/lib/db";
import { createSessionToken, SESSION_COOKIE } from "@/modules/core/auth/session";
import { buildReport } from "@/modules/reports/data";
import { reportPdf } from "@/modules/reports/pdf";
import { highlights } from "@/modules/reports/summary";
import { reportXlsx } from "@/modules/reports/xlsx";
import { addDemoData } from "@/modules/tasks/demo";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const SECRET = "test-session-secret-test-session-secret";
const NOW = new Date("2026-10-05T06:00:00Z"); // Monday in Tashkent
const TZ = "Asia/Tashkent";
const day = (value: string) => new Date(`${value}T00:00:00Z`);

const request = (url: string, userId: string) =>
  new Request(url, {
    headers: { cookie: `${SESSION_COOKIE}=${createSessionToken(userId, SECRET)}` },
  });
const route = (format: string) => ({ params: Promise.resolve({ format }) });

describe("management report", () => {
  beforeEach(resetDb);

  it("counts completed, on-time, overdue and leaves personal tasks and drafts out", async () => {
    const owner = await createTestUser("OWNER");
    const a = await createTestUser("MEMBER", { firstName: "Тестовый сотрудник А" });
    const base = {
      creatorId: owner.id,
      assigneeId: a.id,
      approvedAt: new Date("2026-09-20T05:00:00Z"),
    };
    await db.task.createMany({
      data: [
        // Done this period: one on time, one late.
        {
          ...base,
          title: "Вовремя",
          status: "DONE",
          dueDate: day("2026-10-01"),
          completedAt: new Date("2026-09-30T08:00:00Z"),
        },
        {
          ...base,
          title: "Поздно",
          status: "DONE",
          dueDate: day("2026-09-29"),
          completedAt: new Date("2026-10-01T08:00:00Z"),
        },
        // Done the period before.
        {
          ...base,
          title: "Раньше",
          status: "DONE",
          dueDate: day("2026-09-25"),
          completedAt: new Date("2026-09-24T08:00:00Z"),
        },
        // Overdue now, high priority.
        {
          ...base,
          title: "Просрочена",
          status: "IN_PROGRESS",
          priority: "HIGH",
          dueDate: day("2026-10-02"),
          project: "Тестовый проект",
        },
        // Not counted: personal, draft.
        {
          ...base,
          title: "Личная",
          status: "DONE",
          isPersonal: true,
          completedAt: new Date("2026-09-30T08:00:00Z"),
        },
        {
          ...base,
          title: "Черновик",
          status: "DRAFT",
          approvedAt: null,
          dueDate: day("2026-09-01"),
        },
      ],
    });

    const report = await buildReport({ from: "2026-09-28", to: "2026-10-04" }, TZ, NOW);
    expect(report.kpis.completed).toBe(2);
    expect(report.kpis.onTimePercent).toBe(50);
    expect(report.previousKpis.completed).toBe(1);
    expect(report.now).toMatchObject({ active: 1, overdue: 1, overdueHigh: 1 });
    expect(report.overdueTasks[0]).toMatchObject({ title: "Просрочена", daysOverdue: 3 });
    expect(report.people).toEqual([
      expect.objectContaining({
        name: "Тестовый сотрудник А",
        completed: 2,
        overdue: 1,
        onTimePercent: 50,
      }),
    ]);
    expect(report.projects.map((p) => p.name)).toContain("Тестовый проект");
    expect(report.periodTasks.map((t) => t.title)).not.toContain("Личная");
    expect(report.weeks.at(-1)).toMatchObject({ weekStart: "2026-09-28", completed: 2 });
    expect(highlights(report).join(" ")).toContain("Выполнено задач: 2 (+100%");
  });

  it("produces a PDF and an Excel file from the test data", async () => {
    await createTestUser("OWNER");
    await addDemoData(NOW);
    const report = await buildReport({ from: "2026-09-01", to: "2026-10-05" }, TZ, NOW);
    expect(report.people.length).toBeGreaterThan(2);
    const pdf = await reportPdf(report);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const xlsx = await reportXlsx(report);
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
  }, 30_000);

  it("lets owners and managers download, not employees", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const url = "http://localhost/api/reports/pdf?preset=month";
    const ok = await download(request(url, owner.id), route("pdf"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect((await download(request(url, member.id), route("pdf"))).status).toBe(403);
    expect((await download(new Request(url), route("pdf"))).status).toBe(401);
    expect(
      (await download(request("http://localhost/api/reports/doc", owner.id), route("doc"))).status,
    ).toBe(400);
  });
});
