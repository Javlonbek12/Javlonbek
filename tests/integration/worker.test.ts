// @vitest-environment node
import { describe, expect, it } from "vitest";

import { startWorker, TICK_QUEUE } from "@/modules/scheduler/worker";

describe("pg-boss worker", () => {
  it("starts, registers the every-minute schedule and stops", async () => {
    const boss = await startWorker(process.env.DATABASE_URL!);
    const schedules = await boss.getSchedules();
    expect(schedules.map((s) => [s.name, s.cron])).toContainEqual([TICK_QUEUE, "* * * * *"]);
    await boss.stop({ graceful: false });
  }, 30_000);
});
